"""Prove that check_ranges.py and sync_ranges.py fail on every kind of problem they're meant to catch
(CI: check-ranges).

Builds a tiny synthetic site in a temporary folder (the real helper source, a Split PDF page and its /es/ twin
with a file name block), checks that it passes with no page opted in and with both opted in, then breaks it
one way at a time and checks that each copy fails with the expected message. OPTED_IN_PAGES is empty in the
real check, so the opted-in cases run a copy of the check with the list filled in. It also checks that
sync_ranges.py --check, --write and --add touch only the block and keep each page's line endings.

    python scripts/test_check_ranges.py
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "assets/js/orisod-ranges.js").read_bytes().decode("utf-8").replace("\r\n", "\n")
LF, CRLF = "\n", "\r\n"
START = ("// Orisod page ranges: start. Generated from assets/js/orisod-ranges.js by "
         "scripts/sync_ranges.py; edit that file, not this block.")
END = "// Orisod page ranges: end"
FILENAME = "// Orisod file name: start" + LF + "function orisodFileName() { return 'x'; }" + LF + "// Orisod file name: end" + LF
BLOCK = START + LF + SOURCE + END + LF


def page(body_script, block=True):
    return ("<!DOCTYPE html>" + LF + "<html><head><title>Split</title></head><body>" + LF
            + "<input id=\"rangeInput\">" + LF + "<script src=\"/assets/vendor/x.js\"></script>" + LF
            + "<script>" + LF + FILENAME + (BLOCK if block else "") + body_script + "</script>" + LF
            + "</body></html>" + LF)


USE = "const r = orisodParseRanges(rangeInput.value, 12);" + LF
PLAIN = page(USE.replace("orisodParseRanges", "localParse"), block=False)
WITH = page(USE)
OTHER = "<!DOCTYPE html>" + LF + "<html><body><script>const x = 1;</script></body></html>" + LF
BOTH = '{"split-pdf/index.html", "es/split-pdf/index.html"}'


def build(d, pages, source=SOURCE, opted_in=None):
    root = Path(d)
    (root / "assets/js").mkdir(parents=True, exist_ok=True)
    (root / "assets/js/orisod-ranges.js").write_bytes(source.encode("utf-8"))
    (root / "scripts").mkdir(exist_ok=True)
    shutil.copy(ROOT / "scripts/sync_ranges.py", root / "scripts/sync_ranges.py")
    check = (ROOT / "scripts/check_ranges.py").read_text(encoding="utf-8")
    if opted_in is not None:
        assert "OPTED_IN_PAGES = set()" in check
        check = check.replace("OPTED_IN_PAGES = set()", "OPTED_IN_PAGES = " + opted_in)
    (root / "scripts/check_ranges.py").write_text(check, encoding="utf-8")
    for rel, text in pages.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes((text if rel.endswith(".lf.html") else text.replace(LF, CRLF)).encode("utf-8"))
    return root


def run(root, script, *args):
    r = subprocess.run([sys.executable, str(root / "scripts" / script), "--root", str(root), *args],
                       capture_output=True, text=True, encoding="utf-8")
    return r.returncode, r.stdout + r.stderr


def check(pages, source=SOURCE, opted_in=None):
    with tempfile.TemporaryDirectory() as d:
        return run(build(d, pages, source, opted_in), "check_ranges.py")


def sync(pages, *args):
    with tempfile.TemporaryDirectory() as d:
        root = build(d, pages)
        code, out = run(root, "sync_ranges.py", *args)
        return code, out, {rel: (root / rel).read_bytes().decode("utf-8") for rel in pages}


def twins(en, es=None):
    return {"split-pdf/index.html": en, "es/split-pdf/index.html": en if es is None else es, "about/index.html": OTHER}


def fails(expect, pages, source=SOURCE, opted_in=BOTH):
    return lambda: (lambda c, o: c == 1 and expect in o)(*check(pages, source, opted_in))


def cases():
    yield "no page carries the block: passes", lambda: (lambda c, o: c == 0 and "OK: 0 page(s)" in o)(*check(twins(PLAIN)))
    yield "both twins carry it and are opted in: passes", \
        lambda: (lambda c, o: c == 0 and "OK: 2 page(s)" in o and "(2 opted in)" in o)(*check(twins(WITH), opted_in=BOTH))
    edited = WITH.replace("maxItems: 100000", "maxItems: 100001")
    assert edited != WITH
    yield "an edited block fails", fails("differs from assets/js/orisod-ranges.js", twins(edited, WITH))
    yield "a block with its end marker missing fails", fails("broken markers", twins(WITH.replace(END + LF, ""), WITH))
    yield "an end marker with no start fails", fails("broken markers", twins(WITH.replace(START + LF, ""), WITH))
    yield "two blocks fail", fails("broken markers", twins(WITH.replace(BLOCK, BLOCK + BLOCK), WITH))
    in_src = WITH.replace("<script>" + LF + FILENAME + BLOCK, "<script src=\"/a.js\">" + LF + FILENAME + BLOCK)
    yield "a block in a <script src> fails", fails("isn't inside a single inline <script>", twins(in_src, WITH))
    in_body = WITH.replace("<input id=\"rangeInput\">" + LF, "<input id=\"rangeInput\">" + LF + BLOCK).replace(
        "<script>" + LF + FILENAME + BLOCK, "<script>" + LF + FILENAME)
    yield "a block outside any script fails", fails("isn't inside a single inline <script>", twins(in_body, WITH))
    yield "a page with the block that isn't opted in fails", fails("isn't in OPTED_IN_PAGES", twins(WITH), opted_in=None)
    yield "an opted-in page without the block fails", fails("listed in OPTED_IN_PAGES but doesn't carry", twins(PLAIN, WITH))
    yield "an EN page opted in without its ES twin fails", \
        fails("without its twin es/split-pdf/index.html", twins(WITH, PLAIN), opted_in='{"split-pdf/index.html"}')
    yield "an ES page opted in without its EN twin fails", \
        fails("without its twin split-pdf/index.html", twins(PLAIN, WITH), opted_in='{"es/split-pdf/index.html"}')
    yield "orisodParseRanges() without the block fails", fails("uses orisodParseRanges without", twins(page(USE, block=False)), opted_in=None)
    yield "orisodFormatRanges() without the block fails", \
        fails("uses orisodFormatRanges without", twins(page("x(orisodFormatRanges([1]));" + LF, block=False)), opted_in=None)
    yield "ORISOD_RANGE_KEYWORDS without the block fails", \
        fails("uses ORISOD_RANGE_KEYWORDS without", twins(page("x(ORISOD_RANGE_KEYWORDS);" + LF, block=False)), opted_in=None)
    yield "orisodParseRanges defined again outside the block fails", \
        fails("defines orisodParseRanges outside", twins(page(USE + "function orisodParseRanges(a) { return a; }" + LF), WITH))
    yield "ORISOD_RANGE_KEYWORDS declared again outside the block fails", \
        fails("defines ORISOD_RANGE_KEYWORDS outside", twins(page(USE + "const ORISOD_RANGE_KEYWORDS = {};" + LF), WITH))
    yield "a source with a block marker fails", fails("must not contain the block markers", twins(PLAIN), SOURCE + END + LF, None)
    yield "a source with </script> fails", fails("must not contain the block markers or </script>", twins(PLAIN), SOURCE + "// </script>" + LF, None)
    yield "a source without orisodFormatRanges() fails", \
        fails("doesn't define orisodFormatRanges()", twins(PLAIN), SOURCE.replace("function orisodFormatRanges(", "function other("), None)
    # sync_ranges.py
    yield "sync --check passes on synced pages", lambda: (lambda c, o, a: c == 0 and "All 2 page range blocks match" in o)(*sync(twins(WITH), "--check"))
    yield "sync --check fails on an edited block and writes nothing", \
        lambda: (lambda c, o, a: c == 1 and "would rewrite the block in split-pdf/index.html" in o
                 and a["split-pdf/index.html"] == edited.replace(LF, CRLF))(*sync(twins(edited, WITH), "--check"))
    yield "sync --check fails on broken markers", \
        lambda: (lambda c, o, a: c == 1 and "BROKEN split-pdf/index.html" in o)(*sync(twins(WITH.replace(END + LF, ""), WITH), "--check"))
    yield "sync --write repairs the block and touches nothing else (CRLF kept)", \
        lambda: (lambda c, o, a: c == 0 and a["split-pdf/index.html"] == WITH.replace(LF, CRLF)
                 and a["about/index.html"] == OTHER.replace(LF, CRLF))(*sync(twins(edited, WITH), "--write"))
    yield "sync --write keeps a page's LF line endings", \
        lambda: (lambda c, o, a: c == 0 and a["x/index.lf.html"] == WITH)(*sync({"x/index.lf.html": edited}, "--write"))
    yield "--add puts the block right after the file name block and changes nothing else", \
        lambda: (lambda c, o, a: c == 0 and a["split-pdf/index.html"] == page(USE.replace("orisodParseRanges", "localParse")).replace(LF, CRLF)
                 and a["es/split-pdf/index.html"] == PLAIN.replace(LF, CRLF))(*sync(twins(PLAIN), "--write", "--add", "split-pdf/index.html"))
    yield "--add refuses a page without a file name block", \
        lambda: (lambda c, o, a: c == 1 and "refused about/index.html" in o and a["about/index.html"] == OTHER.replace(LF, CRLF))(
            *sync(twins(PLAIN), "--write", "--add", "about/index.html"))
    yield "--add without --write is refused", \
        lambda: (lambda c, o, a: c == 2 and a["split-pdf/index.html"] == PLAIN.replace(LF, CRLF))(*sync(twins(PLAIN), "--add", "split-pdf/index.html"))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    failed = total = 0
    for label, test in cases():
        total += 1
        try:
            good = test()
        except Exception as e:  # noqa: BLE001
            good = False
            label += f" (raised {e!r})"
        failed += not good
        print(f"  {'PASS' if good else 'FAIL'}  {label}")
    print(f"{total - failed} of {total} check_ranges and sync_ranges tests passed." if not failed else f"{failed} test(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
