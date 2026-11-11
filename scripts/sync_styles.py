#!/usr/bin/env python3
"""Copy the shared Orisod 2.0 stylesheet into the marked region of each adopting page.

assets/css/orisod.css is the single source of the shared styles (for now, only the
design tokens and the Inter @font-face rules). Pages stay self-contained: each page that
adopts it carries a copy inside its own inline <style>, between two marker comments:

    /* orisod.css: start. Generated from assets/css/orisod.css by scripts/sync_styles.py; edit that file, not this region. */
    ...a byte-for-byte copy of assets/css/orisod.css...
    /* orisod.css: end */

    python scripts/sync_styles.py                 # dry run (default): list the pages whose region is out of date
    python scripts/sync_styles.py --write         # rewrite every out-of-date region
    python scripts/sync_styles.py --check         # exit 1 if any region differs or a page's markers are broken
    python scripts/sync_styles.py --add PAGE...   # give pages an (empty) region right after their first <style>, then sync

Only the text between the two markers is ever rewritten; the page's own styles, before
and after the region, are left byte for byte as they are. A page without the markers is
not an adopting page and is never touched (unless named with --add). Line endings are
compared loosely (CRLF and LF are the same), and the copy is written with the page's own
line endings. A page's markers are broken when it has only one of them, more than one of
either, the end before the start, or a region that isn't inside a single <style> element.

check_styles.py (CI: check-styles) runs the --check comparison; --root DIR works on a
copy of the site.
"""

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = "assets/css/orisod.css"
START = "/* orisod.css: start. Generated from assets/css/orisod.css by scripts/sync_styles.py; edit that file, not this region. */"
END = "/* orisod.css: end */"
NOT_PAGES = {".git", ".github", ".claude", "assets", "docs", "scripts", "audit", "node_modules", "prototypes", "claude"}
STYLE_OPEN = re.compile(r"<style\b[^>]*>", re.I)
STYLE_CLOSE = re.compile(r"</style\s*>", re.I)


def read(path):
    with open(path, encoding="utf-8", newline="") as fh:
        return fh.read()


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def lf(text):
    return text.replace("\r\n", "\n")


def source_css(root):
    """The source stylesheet with LF line endings, ending in exactly one newline."""
    css = lf(read(root / SOURCE)).rstrip("\n") + "\n"
    problems = []
    if START in css or END in css:
        problems.append(f"{SOURCE} contains a region marker itself")
    if STYLE_CLOSE.search(css):
        problems.append(f"{SOURCE} contains a </style> tag, which would end the <style> element of every page it's copied into")
    return css, problems


def pages(root):
    for f in sorted(root.rglob("*.html")):
        rel = f.relative_to(root)
        if rel.parts[0] not in NOT_PAGES:
            yield rel.as_posix()


def find_region(text):
    """(start, end, problem): start/end are the offsets of the region's content (after the start marker's line,
    up to the end marker). (None, None, None) when the page has no markers; (None, None, problem) when broken."""
    starts, ends = text.count(START), text.count(END)
    if not starts and not ends:
        return None, None, None
    if starts != 1 or ends != 1:
        return None, None, f"has {starts} start marker(s) and {ends} end marker(s); it needs exactly one of each"
    s, e = text.index(START), text.index(END)
    if e < s:
        return None, None, "has its end marker before its start marker"
    opens = [m for m in STYLE_OPEN.finditer(text) if m.end() <= s]
    if not opens:
        return None, None, "has its region outside any <style> element"
    close = STYLE_CLOSE.search(text, opens[-1].end())
    if not close or close.start() < e + len(END):
        return None, None, "has its region outside a single <style> element"
    content_start = s + len(START)
    if text.startswith("\r\n", content_start):
        content_start += 2
    elif text.startswith("\n", content_start):
        content_start += 1
    return content_start, e, None


def newline_of(text):
    return "\r\n" if "\r\n" in text else "\n"


def add_region(text):
    """Insert empty markers right after the first <style> opening tag."""
    m = STYLE_OPEN.search(text)
    if not m:
        return None
    nl = newline_of(text)
    return text[:m.end()] + nl + START + nl + END + text[m.end():]


def sync_page(text, css):
    """(new_text or None when already in sync, problem or None)."""
    s, e, problem = find_region(text)
    if problem:
        return None, problem
    if s is None:
        return None, None
    if lf(text[s:e]) == css:
        return None, None
    nl = newline_of(text)
    return text[:s] + css.replace("\n", nl) + text[e:], None


def run(root, write_changes=False, check=False, add=()):
    """Returns (exit code, report lines)."""
    lines = []
    css, problems = source_css(root)
    for rel in add:
        text = read(root / rel)
        if find_region(text) != (None, None, None):
            lines.append(f"  already has a region: {rel}")
            continue
        new = add_region(text)
        if new is None:
            problems.append(f"{rel}: has no <style> element to hold the region")
            continue
        if write_changes:
            write(root / rel, new)
        lines.append(f"  {'added' if write_changes else 'would add'} region: {rel}")
    adopting, changed = 0, []
    for rel in pages(root):
        text = read(root / rel)
        if write_changes is False and rel in add and find_region(text) == (None, None, None):
            text = add_region(text) or text
        new, problem = sync_page(text, css)
        if problem:
            problems.append(f"{rel}: {problem}")
            continue
        if find_region(text)[0] is not None:
            adopting += 1
        if new is not None:
            changed.append(rel)
            if write_changes:
                write(root / rel, new)
    for rel in changed:
        lines.append(f"  {'synced' if write_changes else 'out of date'}: {rel}")
    for p in problems:
        lines.append(f"  - {p}")
    lines.append(f"{adopting} page(s) carry the {SOURCE} region: {adopting - len(changed)} in sync, "
                 f"{len(changed)} {'rewritten' if write_changes else 'out of date'}; {len(problems)} problem(s)")
    if problems:
        return 1, lines
    if check and changed:
        lines.append(f"Run: python scripts/sync_styles.py --write")
        return 1, lines
    if not write_changes and not check:
        lines.append("Dry run: nothing written." + (" Run again with --write to apply." if changed or add else ""))
    return 0, lines


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="rewrite out-of-date regions (and add the --add regions)")
    mode.add_argument("--check", action="store_true", help="exit 1 if any region differs from the source or is broken")
    ap.add_argument("--add", nargs="+", default=(), metavar="PAGE", help="give these pages a region (with --write, or as a dry run)")
    ap.add_argument("--root", default=str(REPO_ROOT), help="site root (default: this repo)")
    args = ap.parse_args()
    if args.check and args.add:
        ap.error("--add can't be combined with --check")
    code, lines = run(Path(args.root), write_changes=args.write, check=args.check, add=tuple(args.add))
    print("\n".join(lines))
    return code


if __name__ == "__main__":
    sys.exit(main())
