#!/usr/bin/env python3
"""Fail if any page (folder with an index.html) is missing from sitemap.xml.

Orisod has no build step and no content registry — sitemap.xml is a plain,
hand-maintained file. This script is the safety net: every tool page and
every blog post (EN + ES) must have a matching <loc> entry, regardless of
category. Run in CI on every push/PR to main.
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE_ORIGIN = "https://orisod.com"
EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules"}


def page_url(index_html: Path) -> str:
    parts = index_html.relative_to(REPO_ROOT).parts[:-1]  # drop "index.html"
    return f"{SITE_ORIGIN}/" + "/".join(parts) + ("/" if parts else "")


def main() -> int:
    sitemap_text = (REPO_ROOT / "sitemap.xml").read_text(encoding="utf-8")
    sitemap_urls = set(re.findall(r"<loc>([^<]+)</loc>", sitemap_text))

    pages = [
        f for f in REPO_ROOT.rglob("index.html")
        if f.relative_to(REPO_ROOT).parts[0] not in EXCLUDE_TOP_LEVEL
    ]

    missing = sorted(page_url(f) for f in pages if page_url(f) not in sitemap_urls)

    if missing:
        print("The following pages exist but are missing from sitemap.xml:")
        for url in missing:
            print(f"  - {url}")
        print(f"\n{len(missing)} missing / {len(pages)} pages checked / {len(sitemap_urls)} URLs in sitemap.xml")
        return 1

    print(f"OK: all {len(pages)} pages are present in sitemap.xml ({len(sitemap_urls)} total URLs).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
