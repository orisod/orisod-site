"""Copy the download file name helper into every tool page that uses it.

assets/js/orisod-filename.js is the single source of orisodFileName() and orisodZipName(). Pages stay
self-contained: this script copies the source, byte for byte apart from line endings, into a marked block
in the page's inline tool script:

    // Orisod file name: start. Generated from assets/js/orisod-filename.js by scripts/sync_filename.py; edit that file, not this block.
    ...the source...
    // Orisod file name: end

Only that block is rewritten; the rest of the page stays byte for byte, and the block follows the page's
line endings. Pages without the markers are never touched.

    python scripts/sync_filename.py              dry run: list the pages whose block would change
    python scripts/sync_filename.py --write      rewrite the blocks
    python scripts/sync_filename.py --check      exit 1 if any block differs (changes nothing)
    python scripts/sync_filename.py --write --add PAGE [PAGE ...]
        adopt a page: put the block right after the <script> line of its inline script that downloads
        (the one with ".download =" or "zip.file("), then write it
    --root DIR   work on a copy of the site
"""
import argparse
import re
import sys
from pathlib import Path

SOURCE = Path("assets/js/orisod-filename.js")
START = ("// Orisod file name: start. Generated from assets/js/orisod-filename.js by "
         "scripts/sync_filename.py; edit that file, not this block.")
START_PREFIX = "// Orisod file name: start"
END = "// Orisod file name: end"
SKIP_DIRS = {".git", ".github", ".claude", "assets", "docs", "scripts", "audit", "node_modules", "prototypes"}


def pages(root):
    for p in sorted(root.rglob("*.html")):
        rel = p.relative_to(root)
        if rel.parts[0] in SKIP_DIRS:
            continue
        yield p


def read_source(root):
    text = (root / SOURCE).read_bytes().decode("utf-8").replace("\r\n", "\n")
    if START_PREFIX in text or END in text or "</script" in text.lower():
        raise SystemExit(f"{SOURCE} must not contain the block markers or </script>")
    if not text.endswith("\n"):
        text += "\n"
    return text


def block(source):
    return START + "\n" + source + END


def region(text):
    """(start, end) offsets of the block (start of the START line to the end of the END line), or None."""
    s = text.find(START_PREFIX)
    if s < 0:
        return None
    e = text.find(END, s)
    if e < 0 or text.find(START_PREFIX, s + 1) >= 0 or text.find(END, e + 1) >= 0:
        raise ValueError("broken markers (one missing, or more than one block)")
    line_start = text.rfind("\n", 0, s) + 1
    return line_start, e + len(END)


def synced(text, source):
    """The page text with its block regenerated (text uses \\n line endings)."""
    r = region(text)
    if r is None:
        return None
    return text[:r[0]] + block(source) + text[r[1]:]


SCRIPT_RE = re.compile(r"<script>\n(.*?)</script>", re.S)


def add_block(text, source):
    if region(text) is not None:
        return text
    for m in SCRIPT_RE.finditer(text):
        body = m.group(1)
        if ".download =" in body or "zip.file(" in body:
            at = m.start(1)
            return text[:at] + block(source) + "\n" + text[at:]
    raise ValueError("no inline <script> with \".download =\" or \"zip.file(\" to add the block to")


def load(path):
    raw = path.read_bytes().decode("utf-8")
    crlf = "\r\n" in raw
    return raw, raw.replace("\r\n", "\n"), crlf


def save(path, text, crlf):
    path.write_bytes((text.replace("\n", "\r\n") if crlf else text).encode("utf-8"))


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
    added = set()
    for page in a.add:
        p = root / page
        raw, text, crlf = load(p)
        try:
            new = add_block(text, source)
        except ValueError as e:
            print(f"refused {page}: {e}")
            return 1
        if new != text:
            save(p, new, crlf)
            added.add(p.resolve())
            print(f"added the block to {page}")
    changed, broken = [], []
    for p in pages(root):
        raw, text, crlf = load(p)
        try:
            new = synced(text, source)
        except ValueError as e:
            broken.append(f"{p.relative_to(root).as_posix()}: {e}")
            continue
        if new is None or new == text:
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
        print("All file name blocks match assets/js/orisod-filename.js.")
    if broken or (a.check and changed):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
