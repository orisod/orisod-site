#!/usr/bin/env python3
"""Set every tool page's "Read our guide" link text to its guide's H1.

Each tool page has one guide line under its FAQ ("📖 Want the full picture?
Read our guide: <a ...>...</a>", "📖 ¿Quieres profundizar? Lee nuestra guía:
<a ...>...</a>" in Spanish). The link text is a copy of the guide post's H1, so
it can drift when a post's H1 is edited. This script does that copy:

    python scripts/sync_guide_links.py           # dry run (default): list what would change
    python scripts/sync_guide_links.py --write   # write the changes
    python scripts/sync_guide_links.py --check   # exit 1 if any link text differs

Only the text inside each guide link's <a> is rewritten; the lead-in, the href
and the styling are not touched. A link to a page with no H1 is reported and
left alone. To change a link's wording, change the guide's H1, then run this
with --write. verify_new_content.py's guide-sync check uses the same comparison.
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_extract import NOT_PAGES, REPO_ROOT, read  # noqa: E402

GUIDE_LINK = re.compile(r'📖[^<]*(?:Read our guide|Lee nuestra guía):\s*<a href="([^"]+)"[^>]*>(.*?)</a>', re.S)
H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)


def guide_h1(href, cache={}):
    """The guide's H1 (raw HTML, stripped), or None if the page or its H1 is missing."""
    if href not in cache:
        path = REPO_ROOT / href.strip("/") / "index.html"
        text = path.read_text(encoding="utf-8") if path.is_file() else ""
        main = text.find("<main")
        m = H1.search(text, max(main, 0))
        cache[href] = m.group(1).strip() if m else None
    return cache[href]


def link_diffs(text):
    """For each guide link on a page: (href, start, end, live, want); want is None when the guide has no H1."""
    out = []
    for m in GUIDE_LINK.finditer(text):
        live = m.group(2)
        s = m.start(2) + len(live) - len(live.lstrip())
        e = m.end(2) - (len(live) - len(live.rstrip()))
        out.append((m.group(1), s, e, live.strip(), guide_h1(m.group(1))))
    return out


def pages():
    found = (p.relative_to(REPO_ROOT).as_posix() for p in REPO_ROOT.rglob("*.html"))
    return sorted(p for p in found if p.split("/")[0] not in NOT_PAGES)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="write the changes to the pages")
    mode.add_argument("--check", action="store_true", help="exit 1 if any link text differs from its guide's H1")
    ap.add_argument("files", nargs="*", help="pages to sync (default: every page)")
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    links = in_sync = no_h1 = changed = changed_files = 0
    for rel in args.files or pages():
        text = read(rel)
        edits = []
        for href, s, e, live, want in link_diffs(text):
            links += 1
            if want is None:
                no_h1 += 1
                print(f"  skipped  {rel}: {href} has no H1")
            elif live == want:
                in_sync += 1
            else:
                changed += 1
                edits.append((s, e, want))
                print(f"  {rel} -> {href}\n        was: {live}\n        now: {want}")
        if edits:
            changed_files += 1
            if args.write:
                for s, e, new in sorted(edits, reverse=True):
                    text = text[:s] + new + text[e:]
                with open(REPO_ROOT / rel, "w", encoding="utf-8", newline="") as fh:
                    fh.write(text)
    print(f"{links} guide links: {in_sync} in sync, {changed} out of sync in {changed_files} file(s), "
          f"{no_h1} without a guide H1")
    if args.write:
        print(f"Wrote {changed_files} file(s). Next: python scripts/content_dates.py, then verify_new_content.py")
    elif args.check:
        return 1 if changed or no_h1 else 0
    else:
        print("Dry run: nothing written." + (" Run again with --write to apply." if changed_files else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
