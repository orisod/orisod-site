#!/usr/bin/env python3
"""Fail if a page's link-preview tags are missing or out of step with the page.

Every page carries Open Graph tags (plus twitter:card) so a shared link shows a
proper title, description and image in WhatsApp, Facebook, X, Slack and the
rest. They repeat the page's own <title>, meta description and canonical URL,
so they can drift when one of those is edited; this keeps them in step.

Rules, for every page with an index.html (same set as check_sitemap.py):
- exactly one og:type, og:site_name, og:locale, og:title, og:description,
  og:url, og:image, og:image:width, og:image:height, og:image:alt and
  twitter:card
- og:title / og:description / og:url equal the <title>, meta description and
  canonical URL
- English pages use /assets/og-image.jpg and en_US, Spanish pages
  /assets/og-image-es.jpg and es_ES
- blog posts are og:type "article", every other page "website"

Run in CI on every push/PR to main, same as check_sitemap.py.
"""
import html
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules", "prototypes", "audit", "claude"}
TAGS = ["og:type", "og:site_name", "og:locale", "og:title", "og:description", "og:url", "og:image",
        "og:image:width", "og:image:height", "og:image:alt"]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    problems = []
    pages = 0
    for f in sorted(REPO_ROOT.rglob("index.html")):
        rel = f.relative_to(REPO_ROOT)
        if rel.parts[0] in EXCLUDE_TOP_LEVEL:
            continue
        pages += 1
        head = f.read_text(encoding="utf-8").split("</head>", 1)[0]
        es = rel.parts[0] == "es"
        parts = rel.parts[1:] if es else rel.parts
        is_post = len(parts) == 3 and parts[0] == "blog"

        og = {}
        for tag in TAGS:
            found = re.findall(r'<meta property="%s" content="([^"]*)">' % re.escape(tag), head)
            if len(found) != 1:
                problems.append(f"{rel}: needs exactly one {tag} (found {len(found)})")
            else:
                og[tag] = html.unescape(found[0])
        if len(re.findall(r'<meta name="twitter:card" content="summary_large_image">', head)) != 1:
            problems.append(f"{rel}: needs exactly one twitter:card summary_large_image")

        title = re.search(r"<title>(.*?)</title>", head, re.S)
        desc = re.search(r'<meta name="description" content="([^"]*)">', head)
        canon = re.search(r'<link rel="canonical" href="([^"]+)">', head)
        expect = {
            "og:title": html.unescape(title.group(1).strip()) if title else None,
            "og:description": html.unescape(desc.group(1)) if desc else None,
            "og:url": canon.group(1) if canon else None,
            "og:image": "https://orisod.com/assets/og-image%s.jpg" % ("-es" if es else ""),
            "og:locale": "es_ES" if es else "en_US",
            "og:type": "article" if is_post else "website",
            "og:site_name": "Orisod",
            "og:image:width": "1200",
            "og:image:height": "630",
        }
        for tag, want in expect.items():
            if tag in og and og[tag] != want:
                problems.append(f'{rel}: {tag} is "{og[tag][:60]}" but should be "{(want or "")[:60]}"')

    if problems:
        print("Link-preview tag problems found:")
        for p in problems:
            print(f"  - {p}")
        print(f"\n{len(problems)} problem(s) across {pages} pages. Copy the block under \"Link previews\" from a page "
              "of the same kind and language, then match og:title, og:description and og:url to the page's own "
              "<title>, meta description and canonical link.")
        return 1
    print(f"OK: all {pages} pages have link-preview tags matching their title, description and URL.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
