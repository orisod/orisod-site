#!/usr/bin/env python3
"""Fail if any page's top nav breaks the site-wide nav rules (Initiative 2).

Orisod has no shared header include: every page carries its own copy of the
nav markup, CSS and JS, and new pages are made by copying an existing one.
This check is the guardrail that keeps every copy consistent:

1. Sticky nav: the `.site-nav` CSS rule is `position:sticky`, and the page has
   the small script after </header> that keeps `--site-nav-h` in sync.
2. Minimal nav everywhere: logo plus icon buttons (Support, Search, the theme
   toggle, Menu), with the category links, Blog and EN/ES inside the menu panel
   (<nav class="nav-menu">). The old .site-nav-links bar, its capsule
   highlight (.active-category), its .site-nav-right group and Support pill
   (.nav-support-pill) are gone from every page, markup, CSS and script alike,
   so a page copied from a pre-2026-10-20 template fails here.
3. Menu panel: links to all four /tools destinations and the blog, with the
   page's language prefix, plus a language row with exactly one current
   language.
4. Current page: marked with aria-current="page" in the menu, never with a
   capsule. Only the blog index marks "Blog", and only /tools marks a tools
   link (statically "All Tools"; its filter pills move the mark). Every other
   page marks nothing.
5. Search icon: on the homepages it scrolls to the hero search, on /tools it
   focuses that page's search box (data-search-target="toolSearch"); on both
   it stays hidden until that box scrolls behind the nav. On
   every other page it opens the nav search box, a form that submits to
   /tools/?search=... in the page's language.
6. Flyouts: the category flyouts (which need the full tool catalog) are only
   allowed on the pages in FLYOUT_PAGES: the homepages (built from their inline
   TOOLS catalog) and /tools (built from its own cards).
7. /tools: each category section has id="image|pdf|utility" (what the menu's
   /tools/#category links jump to), and its cards are sorted by name, since
   the flyouts list them in page order.

Run in CI on every push/PR to main, same as check_sitemap.py.
"""
import html
import re
import sys
import unicodedata
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules", "prototypes", "audit", "claude"}

NAV_RULE = re.compile(r"\n\.site-nav\{([^}]*)\}")
HEIGHT_SCRIPT = "r.style.setProperty('--site-nav-h'"
HEADER = re.compile(r'<header class="site-nav">(.*?)</header>', re.S)
MENU_BLOCK = re.compile(r'<nav class="nav-menu"[^>]*>(.*?)</nav>', re.S)
MENU_TARGETS = ["tools/", "tools/#image", "tools/#pdf", "tools/#utility", "blog/"]
OLD_NAV = re.compile(r"site-nav-links|site-nav-right|nav-support-pill|active-category")
# The script that hides the nav search icon while the page's own search box is on screen.
REVEAL = ["#navSearchBtn.search-reveal-hidden{", "classList.toggle('search-reveal-hidden'", "new IntersectionObserver(update"]
ICONS = ['class="nav-icon-btn support"', 'id="navSearchBtn"', 'id="themeToggle"', 'id="navMenuBtn"']

HOME_PAGES = {("index.html",), ("es", "index.html")}
# Pages whose menu may carry the category flyouts: the homepages (built from their
# inline TOOLS catalog) and /tools (built from its own cards).
FLYOUT_PAGES = HOME_PAGES | {("tools", "index.html"), ("es", "tools", "index.html")}


def sort_key(name):
    """How /tools orders its cards: by name, ignoring accents and case."""
    plain = "".join(c for c in unicodedata.normalize("NFD", name) if not unicodedata.combining(c))
    return (plain.casefold(), name)


def check_page(rel, text, problems):
    parts = rel.parts
    lang_prefix = "/es/" if parts[0] == "es" else "/"
    page = parts[1:] if parts[0] == "es" else parts  # path within its language
    is_home = parts in HOME_PAGES
    is_tools = page == ("tools", "index.html")
    is_blog_index = page == ("blog", "index.html")

    rule = NAV_RULE.search(text)
    if not rule or "position:sticky" not in rule.group(1).replace(" ", ""):
        problems.append(f"{rel}: .site-nav CSS rule is not position:sticky")
    if HEIGHT_SCRIPT not in text:
        problems.append(f"{rel}: missing the --site-nav-h script after </header>")

    header = HEADER.search(text)
    if not header:
        problems.append(f"{rel}: no <header class=\"site-nav\"> found")
        return
    header = header.group(1)
    if 'class="site-nav-links"' in header:
        problems.append(f"{rel}: still has the old .site-nav-links bar")
    if 'class="active-category"' in text:
        problems.append(f"{rel}: has a capsule-highlighted nav item (.active-category); use aria-current=\"page\" in the menu instead")
    old = sorted(set(OLD_NAV.findall(text)))
    if old:
        problems.append(f"{rel}: still has old-nav CSS/script ({', '.join(old)}); the minimal nav doesn't use it")
    for icon in ICONS:
        if icon not in header:
            problems.append(f"{rel}: nav is missing {icon}")

    menu = MENU_BLOCK.search(header)
    if not menu:
        problems.append(f"{rel}: no <nav class=\"nav-menu\"> menu panel found")
        return
    menu = menu.group(1)
    for target in MENU_TARGETS:
        if f'href="{lang_prefix}{target}"' not in menu:
            problems.append(f"{rel}: menu panel is missing a link to {lang_prefix}{target}")
    if 'class="menu-lang"' not in menu or menu.count('class="lang-flag active"') != 1:
        problems.append(f"{rel}: menu panel needs a language row with exactly one current language")

    current = re.findall(r'<a [^>]*aria-current="page"[^>]*>', menu)
    if is_blog_index:
        want = [f'href="{lang_prefix}blog/"']
    elif is_tools:
        want = [f'href="{lang_prefix}tools/"']
    else:
        want = []
    if len(current) != len(want) or any(w not in c for w, c in zip(want, current)):
        problems.append(f"{rel}: menu aria-current is {current or 'none'}; expected {want or 'none'} on this page")

    if is_home:
        # The homepage search icon scrolls to the hero search box, and is hidden while that box shows.
        if not all(r in text for r in REVEAL):
            problems.append(f"{rel}: the nav search icon must stay hidden while the hero search box is visible")
    elif is_tools:
        if 'data-search-target="toolSearch"' not in header:
            problems.append(f"{rel}: /tools search icon must focus the page's own box (data-search-target=\"toolSearch\")")
        if not all(r in text for r in REVEAL):
            problems.append(f"{rel}: the nav search icon must stay hidden while the page's own search box is "
                            f"visible (the search-reveal CSS and script, copied from the homepage)")
        # The menu's /tools/#category links jump to these sections, and its
        # flyouts list each section's cards in page order, which is by name.
        for cat in ("image", "pdf", "utility"):
            sec = re.search(rf'<section class="category-section" id="{cat}" data-category="{cat}">(.*?)</section>', text, re.S)
            if not sec:
                problems.append(f"{rel}: missing <section class=\"category-section\" id=\"{cat}\" data-category=\"{cat}\"> (the jump target for {lang_prefix}tools/#{cat})")
                continue
            names = [html.unescape(n) for n in re.findall(r'class="name tool-card-title">([^<]+)<', sec.group(1))]
            if names != sorted(names, key=sort_key):
                problems.append(f"{rel}: the {cat} cards aren't sorted by name (accents and case ignored); "
                                f"put each new tool in its alphabetical place")
    else:
        form = re.search(r'<form class="nav-search"[^>]*>', header)
        if not form or f'action="{lang_prefix}tools/"' not in form.group(0) or 'name="search"' not in header:
            problems.append(f"{rel}: nav search box missing, or it doesn't submit ?search= to {lang_prefix}tools/")

    if parts not in FLYOUT_PAGES and "menu-flyout" in text:
        problems.append(f"{rel}: has menu flyouts, which are only allowed on the pages in FLYOUT_PAGES")


def main() -> int:
    problems = []
    pages = [
        f for f in sorted(REPO_ROOT.rglob("index.html"))
        if f.relative_to(REPO_ROOT).parts[0] not in EXCLUDE_TOP_LEVEL
    ]
    # The custom 404 page is a root-level file, not a folder/index.html, but it
    # carries the same nav and must follow the same rules.
    pages.append(REPO_ROOT / "404.html")
    for f in pages:
        check_page(f.relative_to(REPO_ROOT), f.read_text(encoding="utf-8"), problems)

    if problems:
        print("Nav problems found:")
        for p in problems:
            print(f"  - {p}")
        print(f"\n{len(problems)} problem(s) across {len(pages)} pages checked")
        return 1

    print(f"OK: all {len(pages)} pages use the minimal nav (sticky, menu links and language row present, "
          f"aria-current only on the blog index and /tools, nav search wired up, flyouts only on the {len(FLYOUT_PAGES)} homepage and /tools pages).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
