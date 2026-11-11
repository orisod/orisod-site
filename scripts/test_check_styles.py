#!/usr/bin/env python3
"""Negative tests for check_styles.py and sync_styles.py (the shared stylesheet region).

Builds a tiny site in a temporary folder (assets/css/orisod.css, two pages that carry
its region, one that doesn't), checks that check_styles.py passes on it, then breaks it
one way at a time and checks that it fails with the expected message. Then it checks
that sync_styles.py --write repairs a stale region without touching a single byte
outside it (CRLF kept), leaves a page without markers alone, and that --add puts the
region right after the page's first <style>. Run after changing either script:

  python scripts/test_check_styles.py   (CI: check-styles)
"""
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHECK = HERE / "check_styles.py"
SYNC = HERE / "sync_styles.py"
sys.path.insert(0, str(HERE))
from sync_styles import END, START  # noqa: E402

NL = chr(10)
CSS = ":root{--o-demo:#123456;}" + NL + "/* a second line */" + NL


def page(region=CSS, before=".before{color:red;}", after=".after{color:blue;}", nl=NL):
    text = ("<!doctype html><html><head><title>t</title>" + NL + "<style>" + NL + START + NL + region + END + NL
            + before + NL + after + NL + "</style></head><body><main>t</main></body></html>" + NL)
    return text.replace(NL, nl)


PLAIN = "<!doctype html><html><head><style>" + NL + ".mine{color:green;}" + NL + "</style></head><body></body></html>" + NL


def build(root, css=CSS, pages=None):
    pages = pages if pages is not None else {}
    files = {"index.html": page(), "es/index.html": page(nl="\r\n"), "plain/index.html": PLAIN, **pages}
    (root / "assets/css").mkdir(parents=True)
    (root / "assets/css/orisod.css").write_bytes(css.encode("utf-8"))
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(text.encode("utf-8"))


def check(**kw):
    with tempfile.TemporaryDirectory() as d:
        build(Path(d), **kw)
        r = subprocess.run([sys.executable, str(CHECK), "--root", d], capture_output=True, text=True, encoding="utf-8")
        return r.returncode, r.stdout + r.stderr


CASES = [
    # (label, kwargs, expected text in the failure; None means it must pass)
    ("the valid demo site (LF and CRLF pages, a page without markers)", {}, None),
    ("a page whose region was edited by hand", {"pages": {"index.html": page(region=CSS.replace("123456", "654321"))}},
     "out of date: index.html"),
    ("the source edited without syncing", {"css": CSS + ".new{}" + NL}, "2 out of date"),
    ("a page with only the start marker", {"pages": {"index.html": page().replace(END, "")}},
     "index.html: has 1 start marker(s) and 0 end marker(s)"),
    ("a page with two regions", {"pages": {"index.html": page().replace("</style>", START + NL + CSS + END + NL + "</style>")}},
     "index.html: has 2 start marker(s) and 2 end marker(s)"),
    ("a page with the end marker first", {"pages": {"index.html": page().replace(START, "@@").replace(END, START).replace("@@", END)}},
     "index.html: has its end marker before its start marker"),
    ("a region outside any <style>", {"pages": {"index.html": page().replace("<style>", "<!-- -->").replace("</style>", "")}},
     "index.html: has its region outside any <style> element"),
    ("a region that runs past its </style>", {"pages": {"index.html": page().replace(END, "</style><style>" + END)}},
     "index.html: has its region outside a single <style> element"),
    ("a source with a </style> tag", {"css": CSS + "/* </style> */" + NL}, "contains a </style> tag"),
    ("a source with a marker in it", {"css": CSS + END + NL}, "contains a region marker itself"),
]


def sync(root, *args):
    return subprocess.run([sys.executable, str(SYNC), "--root", str(root), *args], capture_output=True, text=True, encoding="utf-8")


def write_mode_checks():
    """--write repairs only the region; --add places a new region after the first <style>. Returns failures."""
    bad = []
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        stale = CSS.replace("123456", "000000")
        build(root, pages={"index.html": page(region=stale), "es/index.html": page(region=stale, nl="\r\n")})
        before_plain = (root / "plain/index.html").read_bytes()
        dry = sync(root)
        if dry.returncode != 0 or (root / "index.html").read_bytes() != page(region=stale).encode("utf-8"):
            bad.append("the dry run changed a page or failed")
        r = sync(root, "--write")
        if r.returncode != 0:
            bad.append("--write failed: " + r.stdout)
        if (root / "index.html").read_bytes() != page().encode("utf-8"):
            bad.append("--write didn't give the LF page exactly the source region with everything else unchanged")
        if (root / "es/index.html").read_bytes() != page(nl="\r\n").encode("utf-8"):
            bad.append("--write didn't keep the CRLF page's line endings, or changed bytes outside the region")
        if (root / "plain/index.html").read_bytes() != before_plain:
            bad.append("--write touched a page without markers")
        if subprocess.run([sys.executable, str(CHECK), "--root", d], capture_output=True).returncode != 0:
            bad.append("check_styles failed right after --write")
        r = sync(root, "--write", "--add", "plain/index.html")
        text = (root / "plain/index.html").read_text(encoding="utf-8")
        want = "<style>" + NL + START + NL + CSS + END + NL + ".mine{color:green;}"
        if r.returncode != 0 or want not in text or text.replace(START + NL + CSS + END + NL, "") != PLAIN:
            bad.append("--add didn't put exactly the region right after the first <style>")
    return bad


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    failed = 0
    for label, kw, want in CASES:
        code, out = check(**kw)
        ok = code == 0 if want is None else (code == 1 and want in out)
        failed += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {label}: check_styles {'passed' if code == 0 else 'failed'}"
              + ("" if ok else f" (expected {'a pass' if want is None else repr(want)})" + NL + out))
    bad = write_mode_checks()
    print(f"  {'FAIL' if bad else 'PASS'}  sync_styles --write and --add touch only the region" + ("".join(NL + "        " + b for b in bad)))
    failed += bool(bad)
    total = len(CASES) + 1
    print(f"{total - failed} of {total} check_styles tests passed." if not failed else f"{failed} test(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
