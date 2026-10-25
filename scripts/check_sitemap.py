#!/usr/bin/env python3
"""Fail if any page (folder with an index.html) is missing from sitemap.xml, or
if a <lastmod> date is wrong.

Orisod has no build step and no content registry — sitemap.xml is a plain,
hand-maintained file. This script is the safety net: every tool page and
every blog post (EN + ES) must have a matching <loc> entry, regardless of
category. Run in CI on every push/PR to main.

<lastmod> dates come from scripts/content_dates.py (the day the page's content
last changed). This checks every one is a real YYYY-MM-DD date, not in the
future, and that each blog post's equals its BlogPosting JSON-LD dateModified,
since both come from the same measurement. (CI checks out shallow history, so it
can't re-measure the dates themselves; run content_dates.py for that.)

Usage: check_sitemap.py [--root DIR]   (DIR defaults to the repo; used to test against fixtures)
"""
import datetime
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if "--root" in sys.argv:
    REPO_ROOT = Path(sys.argv[sys.argv.index("--root") + 1]).resolve()
SITE_ORIGIN = "https://orisod.com"
EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules"}
POST = re.compile(r"(es/)?blog/[^/]+/")


def page_url(index_html: Path) -> str:
    parts = index_html.relative_to(REPO_ROOT).parts[:-1]  # drop "index.html"
    return f"{SITE_ORIGIN}/" + "/".join(parts) + ("/" if parts else "")


def date_problems(sitemap_text):
    problems = []
    today = datetime.date.today()
    for loc, lastmod in re.findall(r"<loc>([^<]+)</loc>(?:<lastmod>([^<]*)</lastmod>)?", sitemap_text):
        if not lastmod:
            continue
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", lastmod):
                raise ValueError
            day = datetime.date.fromisoformat(lastmod)
        except ValueError:
            problems.append(f"{loc}: <lastmod>{lastmod}</lastmod> isn't a real YYYY-MM-DD date")
            continue
        if day > today:
            problems.append(f"{loc}: <lastmod>{lastmod}</lastmod> is in the future")
        rel = loc[len(SITE_ORIGIN) + 1:]
        page = REPO_ROOT / rel / "index.html"
        if POST.fullmatch(rel) and page.exists():
            modified = None
            for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page.read_text(encoding="utf-8"), re.S):
                try:
                    data = json.loads(block)
                except ValueError:
                    continue
                if isinstance(data, dict) and data.get("@type") == "BlogPosting":
                    modified = data.get("dateModified")
            if modified != lastmod:
                problems.append(f"{loc}: <lastmod>{lastmod}</lastmod> differs from the post's JSON-LD dateModified "
                                f"({modified}); run python scripts/content_dates.py --write")
    return problems


def main() -> int:
    sitemap_text = (REPO_ROOT / "sitemap.xml").read_text(encoding="utf-8")
    sitemap_urls = set(re.findall(r"<loc>([^<]+)</loc>", sitemap_text))

    pages = [
        f for f in REPO_ROOT.rglob("index.html")
        if f.relative_to(REPO_ROOT).parts[0] not in EXCLUDE_TOP_LEVEL
    ]

    missing = sorted(page_url(f) for f in pages if page_url(f) not in sitemap_urls)
    bad_dates = date_problems(sitemap_text)

    if missing:
        print("The following pages exist but are missing from sitemap.xml:")
        for url in missing:
            print(f"  - {url}")
        print(f"\n{len(missing)} missing / {len(pages)} pages checked / {len(sitemap_urls)} URLs in sitemap.xml")
    if bad_dates:
        print("sitemap.xml <lastmod> problems:")
        for p in bad_dates:
            print(f"  - {p}")
    if missing or bad_dates:
        return 1

    print(f"OK: all {len(pages)} pages are present in sitemap.xml ({len(sitemap_urls)} total URLs), "
          "and every <lastmod> is a valid, non-future date matching the blog posts' JSON-LD dateModified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
