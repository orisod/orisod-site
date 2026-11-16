"""Copy the page range helper into every tool page that has opted in.

assets/js/orisod-ranges.js is the single source of orisodParseRanges() and orisodFormatRanges(). Pages stay
self-contained: this script copies the source, byte for byte apart from line endings, into a marked block
in the page's inline tool script:

    // Orisod page ranges: start. Generated from assets/js/orisod-ranges.js by scripts/sync_ranges.py; edit that file, not this block.
    ...the source...
    // Orisod page ranges: end

Only that block is rewritten; the rest of the page stays byte for byte, and the block follows the page's
line endings. Pages without the markers are never touched. Opting in is deliberate: a page with the block
must also be listed in OPTED_IN_PAGES in scripts/check_ranges.py (which starts empty).

    python scripts/sync_ranges.py              dry run: list the pages whose block would change
    python scripts/sync_ranges.py --write      rewrite the blocks
    python scripts/sync_ranges.py --check      exit 1 if any block differs or is broken (changes nothing)
    python scripts/sync_ranges.py --write --add PAGE [PAGE ...]
        adopt a page: put the block right after its "Orisod file name" block (every page that takes page
        ranges carries one), then write it; a page without that block is refused
    --root DIR   work on a copy of the site
"""
import argparse
import sys
from pathlib import Path

SOURCE = Path("assets/js/orisod-ranges.js")
START = ("// Orisod page ranges: start. Generated from assets/js/orisod-ranges.js by "
         "scripts/sync_ranges.py; edit that file, not this block.")
START_PREFIX = "// Orisod page ranges: start"
END = "// Orisod page ranges: end"
FILENAME_END = "// Orisod file name: end"
SKIP_DIRS = {".git", ".github", ".claude", "assets", "docs", "scripts", "audit", "node_modules", "prototypes"}
LF, CRLF = "\n", "\r\n"


def pages(root):
    for p in sorted(root.rglob("*.html")):
        rel = p.relative_to(root)
        if rel.parts[0] in SKIP_DIRS:
            continue
        yield p


def read_source(root):
    text = (root / SOURCE).read_bytes().decode("utf-8").replace(CRLF, LF)
    if START_PREFIX in text or END in text or "</script" in text.lower():
        raise SystemExit(f"{SOURCE} must not contain the block markers or </script>")
    if not text.endswith(LF):
        text += LF
    return text


def block(source):
    return START + LF + source + END


def region(text):
    """(start, end) offsets of the block (start of the START line to the end of the END line), or None."""
    s = text.find(START_PREFIX)
    if s < 0:
        if text.find(END) >= 0:
            raise ValueError("broken markers (an end marker without a start)")
        return None
    e = text.find(END, s)
    if e < 0 or text.find(START_PREFIX, s + 1) >= 0 or text.find(END, e + 1) >= 0 or text.find(END, 0, s) >= 0:
        raise ValueError("broken markers (one missing, or more than one block)")
    line_start = text.rfind(LF, 0, s) + 1
    return line_start, e + len(END)


def synced(text, source):
    """The page text with its block regenerated (text uses LF line endings), or None without a block."""
    r = region(text)
    if r is None:
        return None
    return text[:r[0]] + block(source) + text[r[1]:]


def add_block(text, source):
    if region(text) is not None:
        return text
    at = text.find(FILENAME_END)
    if at < 0 or text.find(FILENAME_END, at + 1) >= 0:
        raise ValueError("needs exactly one \"Orisod file name\" block to put the page range block after")
    at = text.find(LF, at)
    if at < 0:
        raise ValueError("the \"Orisod file name\" block has no line after it")
    return text[:at + 1] + block(source) + LF + text[at + 1:]


def load(path):
    raw = path.read_bytes().decode("utf-8")
    return raw.replace(CRLF, LF), CRLF in raw


def save(path, text, crlf):
    path.write_bytes((text.replace(LF, CRLF) if crlf else text).encode("utf-8"))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--add", nargs="+", default=[], metavar="PAGE")
    ap.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    root = Path(a.root)
    source = read_source(root)
    if a.add and not a.write:
        print("--add needs --write")
        return 2
    for page in a.add:
        p = root / page
        text, crlf = load(p)
        try:
            new = add_block(text, source)
        except ValueError as e:
            print(f"refused {page}: {e}")
            return 1
        if new != text:
            save(p, new, crlf)
            print(f"added the block to {page}")
    changed, broken, count = [], [], 0
    for p in pages(root):
        text, crlf = load(p)
        try:
            new = synced(text, source)
        except ValueError as e:
            broken.append(f"{p.relative_to(root).as_posix()}: {e}")
            continue
        if new is None:
            continue
        count += 1
        if new == text:
            continue
        changed.append(p.relative_to(root).as_posix())
        if a.write:
            save(p, new, crlf)
    for b in broken:
        print(f"BROKEN {b}")
    verb = "rewrote" if a.write else "would rewrite"
    for c in changed:
        print(f"{verb} the block in {c}")
    if not changed and not broken:
        print(f"All {count} page range blocks match {SOURCE.as_posix()}.")
    if broken or (a.check and changed):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
