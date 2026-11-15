#!/usr/bin/env python3
"""Tests for sync_loader.py: --check fails on a block that differs from assets/js/orisod-loader.js or on broken
markers, --write repairs only the block (line endings kept), --add puts it in the right place, and pages
without the block are never touched.

Builds a tiny site in a temporary folder with the real source. Run after changing sync_loader.py:

  python scripts/test_sync_loader.py   (CI: check-vendor)
"""
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SYNC = REPO / "scripts" / "sync_loader.py"
SOURCE = (REPO / "assets/js/orisod-loader.js").read_bytes().decode("utf-8").replace(chr(13) + chr(10), chr(10))
LF, CRLF = chr(10), chr(13) + chr(10)
START = ("// Orisod loader: start. Generated from assets/js/orisod-loader.js by scripts/sync_loader.py; "
         "edit that file, not this block.")
END = "// Orisod loader: end"
FILENAME_END = "// Orisod file name: end"
DECL = 'const ORISOD_LIBS = {"pdflib": {"src": "/assets/vendor/pdf-lib/1.17.1/pdf-lib.min.js", "global": "PDFLib", "timeoutMs": 60000, "blocks": true}};'
HEAD = "<!doctype html><html><head><title>m</title></head><body><main>m</main>" + LF + "<script>" + LF
TAIL = 'orisodLoad("pdflib");' + LF + "</script></body></html>" + LF
SYNCED = HEAD + "// Orisod file name: start" + LF + "function orisodFileName() {}" + LF + FILENAME_END + LF \
    + START + LF + SOURCE + END + LF + "// What the page loads." + LF + DECL + LF + TAIL
UNADOPTED = HEAD + "// Orisod file name: start" + LF + "function orisodFileName() {}" + LF + FILENAME_END + LF \
    + "// What the page loads." + LF + DECL + LF + TAIL
OTHER = "<!doctype html><html><body><script>const x = 1;</script></body></html>" + LF


def run(pages, *args):
    """Write the pages (CRLF unless the name ends in .lf.html), run sync_loader.py, return (code, output, pages after)."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "assets/js").mkdir(parents=True)
        (root / "assets/js/orisod-loader.js").write_text(SOURCE, encoding="utf-8")
        for rel, text in pages.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_bytes((text if rel.endswith(".lf.html") else text.replace(LF, CRLF)).encode("utf-8"))
        r = subprocess.run([sys.executable, str(SYNC), "--root", d, *args], capture_output=True, text=True, encoding="utf-8")
        after = {rel: (root / rel).read_bytes().decode("utf-8") for rel in pages}
        return r.returncode, r.stdout + r.stderr, after


def crlf(text):
    return text.replace(LF, CRLF)


def test_cases():
    edited = SYNCED.replace("script.src = lib.src;", "script.src = lib.src || '/assets/js/x.js';")
    assert edited != SYNCED
    two = SYNCED.replace(END + LF, END + LF + START + LF + SOURCE + END + LF, 1)
    yield "a synced page passes --check", (lambda: run({"merge-pdf/index.html": SYNCED, "es/merge-pdf/index.html": SYNCED}, "--check")), \
        lambda c, o, a: c == 0 and "All 2 loader blocks match" in o
    yield "a page whose block differs from the source fails --check", (lambda: run({"merge-pdf/index.html": edited}, "--check")), \
        lambda c, o, a: c == 1 and "would rewrite the block in merge-pdf/index.html" in o and a["merge-pdf/index.html"] == crlf(edited)
    yield "a block with its end marker missing fails --check", (lambda: run({"merge-pdf/index.html": SYNCED.replace(END + LF, "")}, "--check")), \
        lambda c, o, a: c == 1 and "BROKEN merge-pdf/index.html" in o
    yield "two blocks in one page fail --check", (lambda: run({"merge-pdf/index.html": two}, "--check")), \
        lambda c, o, a: c == 1 and "BROKEN merge-pdf/index.html" in o
    yield "a dry run reports the change and writes nothing", (lambda: run({"merge-pdf/index.html": edited})), \
        lambda c, o, a: c == 0 and "would rewrite" in o and a["merge-pdf/index.html"] == crlf(edited)
    yield "--write restores the block and touches nothing else (CRLF kept)", (lambda: run({"merge-pdf/index.html": edited, "split-pdf/index.html": OTHER}, "--write")), \
        lambda c, o, a: c == 0 and a["merge-pdf/index.html"] == crlf(SYNCED) and a["split-pdf/index.html"] == crlf(OTHER)
    yield "--write keeps a page's LF line endings", (lambda: run({"x/index.lf.html": edited}, "--write")), \
        lambda c, o, a: c == 0 and a["x/index.lf.html"] == SYNCED
    yield "--add puts the block above the declaration's comment, after the file name block", \
        (lambda: run({"merge-pdf/index.html": UNADOPTED}, "--write", "--add", "merge-pdf/index.html")), \
        lambda c, o, a: c == 0 and a["merge-pdf/index.html"] == crlf(SYNCED)
    yield "--add refuses a page without a const ORISOD_LIBS line", (lambda: run({"merge-pdf/index.html": OTHER}, "--write", "--add", "merge-pdf/index.html")), \
        lambda c, o, a: c == 1 and "refused merge-pdf/index.html" in o and a["merge-pdf/index.html"] == crlf(OTHER)
    yield "--add without --write is refused", (lambda: run({"merge-pdf/index.html": UNADOPTED}, "--add", "merge-pdf/index.html")), \
        lambda c, o, a: c == 2 and a["merge-pdf/index.html"] == crlf(UNADOPTED)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    failed = total = 0
    for label, act, ok in test_cases():
        total += 1
        code, out, after = act()
        good = ok(code, out, after)
        failed += not good
        print(f"  {'PASS' if good else 'FAIL'}  {label}" + ("" if good else f" (exit {code})" + LF + out))
    print(f"{total - failed} of {total} sync_loader tests passed." if not failed else f"{failed} test(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
