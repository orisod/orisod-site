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
4. Minimal nav (Initiative 1): the two homepages (/ and /es/) use the new
   minimal nav instead of the .site-nav-links bar: logo plus icon buttons, with
   the category links, Blog and EN/ES inside a menu panel
   (<nav class="nav-menu">). Only the pages in MINIMAL_NAV_PAGES may use it, so
   it can't spread to other pages by copy-paste before the site-wide
   migration. Those pages must have no .site-nav-links bar, no statically
   highlighted item, and a menu panel that links to all four /tools
   destinations and the blog. Rule 1 (sticky nav) applies to them too.

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

# Pages on the minimal nav, mapped to the path prefix their menu links use.
MINIMAL_NAV_PAGES = {("index.html",): "/", ("es", "index.html"): "/es/"}
MENU_BLOCK = re.compile(r'<nav class="nav-menu"[^>]*>(.*?)</nav>', re.S)
MENU_TARGETS = ["tools/", "tools/#image", "tools/#pdf", "tools/#utility", "blog/"]


def check_minimal_nav(rel, text, prefix, problems):
    if NAV_BLOCK.search(text):
        problems.append(f"{rel}: minimal-nav page still has a .site-nav-links bar")
    if ACTIVE.search(text):
        problems.append(f"{rel}: minimal-nav page has a statically highlighted nav item")
    menu = MENU_BLOCK.search(text)
    if not menu:
        problems.append(f"{rel}: no <nav class=\"nav-menu\"> menu panel found")
        return
    for target in MENU_TARGETS:
        if f'href="{prefix}{target}"' not in menu.group(1):
            problems.append(f"{rel}: menu panel is missing a link to {prefix}{target}")


def is_blog_index(parts: tuple) -> bool:
    return parts in (("blog",), ("es", "blog"))


def main() -> int:
    problems = []
    pages = [
        f for f in sorted(REPO_ROOT.rglob("index.html"))
        if f.relative_to(REPO_ROOT).parts[0] not in EXCLUDE_TOP_LEVEL
    ]
    # The custom 404 page is a root-level file, not a folder/index.html, but it
    # carries the same nav and must follow the same rules (no highlighted item).
    pages.append(REPO_ROOT / "404.html")
    for f in pages:
        rel = f.relative_to(REPO_ROOT)
        text = f.read_text(encoding="utf-8")

        rule = NAV_RULE.search(text)
        if not rule or "position:sticky" not in rule.group(1).replace(" ", ""):
            problems.append(f"{rel}: .site-nav CSS rule is not position:sticky")
        if HEIGHT_SCRIPT not in text:
            problems.append(f"{rel}: missing the --site-nav-h script after </header>")

        if rel.parts in MINIMAL_NAV_PAGES:
            check_minimal_nav(rel, text, MINIMAL_NAV_PAGES[rel.parts], problems)
            continue
        if MENU_BLOCK.search(text):
            problems.append(f"{rel}: uses the homepage's minimal nav (<nav class=\"nav-menu\">), which is only allowed on the pages in MINIMAL_NAV_PAGES until the site-wide migration")

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

    print(f"OK: all {len(pages)} pages follow the nav-behavior rules (sticky nav, Blog highlighted on the blog index only, no other static highlight; minimal nav only on {len(MINIMAL_NAV_PAGES)} homepages).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
