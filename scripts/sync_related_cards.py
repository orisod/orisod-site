#!/usr/bin/env python3
"""Regenerate every Related tools card from its tool's entry on /tools.

CLAUDE.md ("Related tools card grid"): a card's icon, title and description are
copied verbatim from that tool's card in /tools/index.html (/es/tools/index.html
for Spanish pages). This script does that copy, so the cards can't drift:

    python scripts/sync_related_cards.py           # dry run (default): list what would change
    python scripts/sync_related_cards.py --write   # write the changes

Only three things inside each <a class="related-card"> are rewritten: the
icon-box <div>, the title text and the desc text. Nothing else on the page is
touched. A card that links to a page with no /tools entry (Hebrew calendar
generator, which is deliberately unlisted) is reported and left alone.

To change a card's wording, change the /tools entry (and the homepage TOOLS
list in index.html / es/index.html), then run this with --write.
verify_new_content.py's card-sync check uses the same comparison.
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_extract import NOT_PAGES, REPO_ROOT, read  # noqa: E402

TOOLS_PAGES = {"en": "tools/index.html", "es": "es/tools/index.html"}
TOOLS_CARD = re.compile(r'<a class="card tool-card" href="([^"]+)">\s*(<div class="icon-box[^"]*">.*?</div>)\s*'
                        r'<div class="name tool-card-title">(.*?)</div>\s*<div class="desc tool-card-desc">(.*?)</div>', re.S)
RELATED_CARD = re.compile(r'<a class="related-card" href="([^"]+)">\s*(<div class="icon-box[^"]*">.*?</div>)\s*'
                          r'<div class="body">\s*<div class="title">(.*?)</div>\s*<div class="desc">(.*?)</div>', re.S)
FIELDS = ("icon", "title", "desc")


def catalog(lang):
    """href -> {"icon", "title", "desc"} as raw HTML from that language's /tools page."""
    return {m.group(1): dict(zip(FIELDS, (m.group(2), m.group(3).strip(), m.group(4).strip())))
            for m in TOOLS_CARD.finditer(read(TOOLS_PAGES[lang]))}


def pages():
    found = (p.relative_to(REPO_ROOT).as_posix() for p in REPO_ROOT.rglob("*.html"))
    return sorted(p for p in found if p.split("/")[0] not in NOT_PAGES and p not in TOOLS_PAGES.values())


def card_diffs(text, cards):
    """For each related card on a page: (href, {field: (start, end, live, want)} for fields that differ), or
    (href, None) when /tools has no entry for it."""
    out = []
    for m in RELATED_CARD.finditer(text):
        want = cards.get(m.group(1))
        if want is None:
            out.append((m.group(1), None))
            continue
        diffs = {}
        for i, field in enumerate(FIELDS, start=2):
            live = m.group(i)
            s, e = m.start(i), m.end(i)
            if field != "icon":  # the title/desc text is compared and written without its surrounding whitespace
                s, e = s + len(live) - len(live.lstrip()), e - (len(live) - len(live.rstrip()))
                live = live.strip()
            if live != want[field]:
                diffs[field] = (s, e, live, want[field])
        out.append((m.group(1), diffs))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True, help="report only (default)")
    mode.add_argument("--write", action="store_true", help="write the changes to the pages")
    ap.add_argument("files", nargs="*", help="pages to sync (default: every page)")
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    cards = {lang: catalog(lang) for lang in TOOLS_PAGES}
    counts = {"cards": 0, "in sync": 0, "unlisted": 0, **{f: 0 for f in FIELDS}}
    changed_files = 0
    for rel in args.files or pages():
        text = read(rel)
        edits = []
        for href, diffs in card_diffs(text, cards["es" if rel.startswith("es/") else "en"]):
            counts["cards"] += 1
            if diffs is None:
                counts["unlisted"] += 1
                print(f"  skipped  {rel}: {href} is not on /tools")
                continue
            if not diffs:
                counts["in sync"] += 1
                continue
            for field, (s, e, live, want) in diffs.items():
                counts[field] += 1
                edits.append((s, e, want))
                if field != "icon":
                    print(f"  {field:<5} {rel} -> {href}\n        was: {live}\n        now: {want}")
                else:
                    print(f"  icon  {rel} -> {href}")
        if edits:
            changed_files += 1
            if args.write:
                for s, e, new in sorted(edits, reverse=True):
                    text = text[:s] + new + text[e:]
                with open(REPO_ROOT / rel, "w", encoding="utf-8", newline="") as fh:
                    fh.write(text)
    print("{cards} cards: {in sync} in sync, {unlisted} not on /tools; out of sync: "
          "{title} title(s), {desc} description(s), {icon} icon(s)".format(**counts)
          + f", in {changed_files} file(s)")
    if not args.write:
        print("Dry run: nothing written." + (" Run again with --write to apply." if changed_files else ""))
    else:
        print(f"Wrote {changed_files} file(s). Next: python scripts/content_dates.py, then verify_new_content.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
