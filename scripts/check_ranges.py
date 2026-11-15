"""Check the page range helper and the pages that carry it (CI: check-ranges).

Fails when:
- assets/js/orisod-ranges.js contains a block marker or </script>, or doesn't define orisodParseRanges()
  and orisodFormatRanges()
- a page's "Orisod page ranges" block is broken (a marker missing, two blocks, outside a single inline
  <script>) or differs from the source (line endings aside); fix with python scripts/sync_ranges.py --write
- a page uses orisodParseRanges(), orisodFormatRanges() or ORISOD_RANGE_KEYWORDS without the block, or
  defines one of the helper's names again outside it
- a page carries the block but isn't in OPTED_IN_PAGES, or is listed but doesn't carry it (the list starts
  empty: adopting the helper is a deliberate change, page by page), or is listed without its EN or ES twin

    python scripts/check_ranges.py [--root DIR]
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sync_ranges as sr  # noqa: E402

# Pages that use the helper, EN and ES together. Empty until a tool adopts it.
OPTED_IN_PAGES = set()
USES = ("orisodParseRanges(", "orisodFormatRanges(", "ORISOD_RANGE_KEYWORDS")
NAMES = ("orisodParseRanges", "orisodFormatRanges", "orisodRangeChar", "ORISOD_RANGE_KEYWORDS", "ORISOD_RANGE_DEFAULTS")
DEFINES = re.compile(r"\b(?:function\s*\*?\s*|(?:const|let|var)\s+)(" + "|".join(NAMES) + r")\b")
SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S | re.I)


def twin(rel):
    return rel[3:] if rel.startswith("es/") else "es/" + rel


def line_of(text, off):
    return text.count("\n", 0, off) + 1


def check_page(rel, text, source, errors, opted_in):
    try:
        r = sr.region(text)
    except ValueError as e:
        errors.append(f"{rel}: {e}")
        return False
    outside = text if r is None else text[:r[0]] + "\n" * text.count("\n", r[0], r[1]) + text[r[1]:]
    if r is None:
        if rel in opted_in:
            errors.append(f"{rel}: listed in OPTED_IN_PAGES but doesn't carry the \"Orisod page ranges\" block "
                          f"(python scripts/sync_ranges.py --write --add {rel})")
        used = [u for u in USES if u in text]
        if used:
            errors.append(f"{rel}: uses {used[0].rstrip('(')} without the \"Orisod page ranges\" block "
                          f"(python scripts/sync_ranges.py --write --add {rel})")
        return False
    ok = True
    if rel not in opted_in:
        errors.append(f"{rel}: carries the \"Orisod page ranges\" block but isn't in OPTED_IN_PAGES in scripts/check_ranges.py")
        ok = False
    holder = [m for m in SCRIPT_RE.finditer(text) if m.start(2) <= r[0] and r[1] <= m.end(2)]
    if not holder or holder[0].group(1).strip():
        errors.append(f"{rel}: the \"Orisod page ranges\" block isn't inside a single inline <script>")
        ok = False
    if text[r[0]:r[1]] != sr.block(source):
        errors.append(f"{rel}:{line_of(text, r[0])}: the \"Orisod page ranges\" block differs from {sr.SOURCE.as_posix()} "
                      f"(python scripts/sync_ranges.py --write)")
        ok = False
    for m in DEFINES.finditer(outside):
        errors.append(f"{rel}:{line_of(outside, m.start())}: defines {m.group(1)} outside the \"Orisod page ranges\" block")
        ok = False
    return ok


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    root = Path(a.root)
    errors = []
    try:
        source = sr.read_source(root)
    except SystemExit as e:
        print(f"FAIL {e}")
        return 1
    for name in ("orisodParseRanges", "orisodFormatRanges"):
        if not re.search(r"\bfunction " + name + r"\(", source):
            errors.append(f"{sr.SOURCE.as_posix()}: doesn't define {name}()")
    for rel in sorted(OPTED_IN_PAGES):
        if twin(rel) not in OPTED_IN_PAGES:
            errors.append(f"OPTED_IN_PAGES lists {rel} without its twin {twin(rel)}")
    count = 0
    for p in sr.pages(root):
        rel = p.relative_to(root).as_posix()
        text = p.read_bytes().decode("utf-8").replace("\r\n", "\n")
        count += check_page(rel, text, source, errors, OPTED_IN_PAGES)
    for e in errors:
        print(f"FAIL {e}")
    if errors:
        print(f"{len(errors)} problem(s) with the page range helper.")
        return 1
    print(f"OK: {count} page(s) carry the page range helper, identical to {sr.SOURCE.as_posix()} "
          f"({len(OPTED_IN_PAGES)} opted in); no page uses it without the block.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
