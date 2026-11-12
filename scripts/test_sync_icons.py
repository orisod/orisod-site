#!/usr/bin/env python3
"""Tests for sync_icons.py (Lucide icons written into page content).

Builds a tiny site in a temporary folder (a manifest with a "lucide" entry, two of the real
vendored icons, a page naming them and a page that doesn't), then checks that:
--check fails on an unwritten icon; --write writes it and touches nothing else on the page (CRLF
kept); --check then passes and a second --write changes nothing; and that it fails on an icon that
isn't vendored, an icon element with another attribute, a vendored file that isn't a plain Lucide
SVG, and an icon edited by hand. A page without icons is never touched. Run after changing the script:

  python scripts/test_sync_icons.py   (CI: check-styles)
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SYNC = HERE / "sync_icons.py"
NL = chr(10)
CR = chr(13)
VENDOR = "assets/vendor/lucide/1.72.0/icons"
PAGE = ("<!doctype html><html><body>" + NL + '<p class="x"><svg class="o-icon" data-lucide="lock"></svg>Kept text</p>' + NL
        + '<button><svg data-lucide="x"></svg></button>' + NL + "</body></html>" + NL)
PLAIN = "<!doctype html><html><body><p>No icons here</p></body></html>" + NL


def build(root, page=PAGE):
    (root / VENDOR).mkdir(parents=True)
    for name in ("lock", "x"):
        shutil.copyfile(REPO / VENDOR / f"{name}.svg", root / VENDOR / f"{name}.svg")
    manifest = {"libraries": [{"name": "lucide", "version": "1.72.0"}]}
    (root / "assets/vendor/manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    for rel, text in {"index.html": page.replace(NL, CR + NL), "plain/index.html": PLAIN}.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(text.encode("utf-8"))


def run(root, *args):
    r = subprocess.run([sys.executable, str(SYNC), "--root", str(root), *args], capture_output=True, text=True, encoding="utf-8")
    return r.returncode, r.stdout + r.stderr


def main():
    results = []

    def case(name, ok, detail=""):
        results.append(ok)
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else ": " + detail))

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        build(root)
        plain_before = (root / "plain/index.html").read_bytes()
        code, out = run(root, "--check")
        case("--check fails on an icon that isn't written yet", code == 1 and "out of date: index.html" in out, out)
        code, out = run(root, "--write")
        text = (root / "index.html").read_bytes().decode("utf-8")
        lock = (REPO / VENDOR / "lock.svg").read_text(encoding="utf-8")
        case("--write writes the vendored drawing, with aria-hidden and the class kept",
             code == 0 and '<svg class="o-icon" data-lucide="lock" xmlns="http://www.w3.org/2000/svg"' in text and 'aria-hidden="true"' in text
             and "<rect" in text and "<rect" in lock and "<!--" not in text and 'width="24"' not in text, text)
        strip = lambda s: re.sub(r"<svg\b.*?</svg>", "", s, flags=re.S)
        case("--write keeps everything outside the icons, CRLF included", strip(text) == strip(PAGE.replace(NL, CR + NL)), text)
        case("a page without icons isn't touched", (root / "plain/index.html").read_bytes() == plain_before)
        code, out = run(root, "--check")
        case("--check passes once written", code == 0, out)
        before = (root / "index.html").read_bytes()
        run(root, "--write")
        case("a second --write changes nothing", (root / "index.html").read_bytes() == before)
        (root / "index.html").write_bytes(before.replace(b"<rect", b"<rect data-edited=\"1\"", 1))
        code, out = run(root, "--check")
        case("--check fails on an icon edited by hand", code == 1 and "out of date" in out, out)

    for name, page, vendored, want in [
        ("an icon that isn't vendored", PAGE.replace('data-lucide="x"', 'data-lucide="rocket"'), None, 'names the icon "rocket", which isn\'t vendored'),
        ("an icon with another attribute", PAGE.replace('<svg data-lucide="x">', '<svg data-lucide="x" onclick="go()">'), None, "attributes other than class and data-lucide"),
        ("a vendored file that isn't a plain Lucide SVG", PAGE, b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>x()</script></svg>', "uses x.svg, which"),
    ]:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build(root, page)
            if vendored:
                (root / VENDOR / "x.svg").write_bytes(vendored)
            before = (root / "index.html").read_bytes()
            code, out = run(root, "--write")
            case(f"fails on {name}", code == 1 and want in out and (root / "index.html").read_bytes() == before, out)

    print(f"{sum(results)} of {len(results)} sync_icons tests passed.")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
