#!/usr/bin/env python3
"""Fail if any page's top nav breaks the site-wide nav-behavior rules (Phase 11.5).

Orisod has no shared header include: every page carries its own copy of the
nav markup and CSS, and new pages are made by copying an existing one. This
check is the guardrail that keeps every copy consistent:

1. Sticky nav: the `.site-nav` CSS rule is `position:sticky`, and the page has
   the small script after </header> that keeps `--site-nav-h` in sync.
2. Blog: only the blog index pages (/blog/ and /es/blog/) highlight "Blog"
   in the nav, and nothing else. Individual posts highlight nothing: "Blog" is
   a normal link back to the index, the same way tool pages treat their
   category.
3. Categories: no other page statically highlights a nav item. Tool pages
   show every category as a normal link back to /tools/#<category>; only
   /tools itself highlights a category, at runtime, from its filter JS.

Run in CI on every push/PR to main, same as check_sitemap.py.
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules", "prototypes"}

NAV_RULE = re.compile(r"\n\.site-nav\{([^}]*)\}")
NAV_BLOCK = re.compile(r'<nav class="site-nav-links">(.*?)</nav>', re.S)
ACTIVE = re.compile(r'class="active-category"[^>]*>([^<]*)<')
HEIGHT_SCRIPT = "r.style.setProperty('--site-nav-h'"


def is_blog_index(parts: tuple) -> bool:
    return parts in (("blog",), ("es", "blog"))


def main() -> int:
    problems = []
    pages = [
        f for f in sorted(REPO_ROOT.rglob("index.html"))
        if f.relative_to(REPO_ROOT).parts[0] not in EXCLUDE_TOP_LEVEL
    ]
    for f in pages:
        rel = f.relative_to(REPO_ROOT)
        text = f.read_text(encoding="utf-8")

        rule = NAV_RULE.search(text)
        if not rule or "position:sticky" not in rule.group(1).replace(" ", ""):
            problems.append(f"{rel}: .site-nav CSS rule is not position:sticky")
        if HEIGHT_SCRIPT not in text:
            problems.append(f"{rel}: missing the --site-nav-h script after </header>")

        nav = NAV_BLOCK.search(text)
        if not nav:
            problems.append(f"{rel}: no <nav class=\"site-nav-links\"> found")
            continue
        active = [a.strip() for a in ACTIVE.findall(nav.group(1))]
        if is_blog_index(rel.parts[:-1]):
            if active != ["Blog"]:
                problems.append(f"{rel}: the blog index must highlight only \"Blog\" in the nav (found {active})")
        elif active:
            problems.append(f"{rel}: nav item(s) {active} are highlighted in the markup; only the blog index may statically highlight a nav item (\"Blog\")")

    if problems:
        print("Nav-behavior problems found:")
        for p in problems:
            print(f"  - {p}")
        print(f"\n{len(problems)} problem(s) across {len(pages)} pages checked")
        return 1

    print(f"OK: all {len(pages)} pages follow the nav-behavior rules (sticky nav, Blog highlighted on the blog index only, no other static highlight).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
