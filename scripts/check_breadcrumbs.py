#!/usr/bin/env python3
"""Fail if a tool page or blog post is missing its breadcrumb trail, or if the
trail and its BreadcrumbList JSON-LD disagree (Initiative 2, PR B).

Every page carries its own copy of the breadcrumb markup, so this check keeps
every copy correct, in both languages:

- Tool pages:  Home / <Category> / <the page's H1>, where the category link is
  /tools/#image|pdf|utility and must match the tool's section on /tools.
  The one exception is the Hebrew calendar generator, which is deliberately
  not in the /tools catalog: Home / Utility Tools / <Calendar generator's H1> /
  <its H1>, with Calendar generator as a link.
- Blog posts:  Home / Blog / <a short label>, written by hand (at most
  MAX_POST_LABEL characters), not the full post title.
- Every level but the last is a link; the last is the current page,
  <span aria-current="page">, not a link. The trail sits right before the H1.
- Each of those pages has exactly one BreadcrumbList JSON-LD block whose names
  and URLs match the visible trail (absolute https://orisod.com URLs, the last
  one being the page itself).
- No other page has a breadcrumb trail.

Run in CI on every push/PR to main, same as check_nav.py.
"""
import html
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules", "prototypes", "audit", "claude"}
NOT_TOOLS = {"about", "privacy", "support", "tools", "blog"}
DOMAIN = "https://orisod.com"
MAX_POST_LABEL = 40
TEXT = {
    "en": {"home": "Home", "blog": "Blog", "cats": {"image": "Image Tools", "pdf": "PDF Tools", "utility": "Utility Tools"}},
    "es": {"home": "Inicio", "blog": "Blog", "cats": {"image": "Herramientas de imagen", "pdf": "Herramientas PDF", "utility": "Utilidades"}},
}
PREFIX = {"en": "/", "es": "/es/"}
# Tools that are deliberately left out of the /tools catalog, with their parent tool.
OFF_CATALOG = {"hebrew-calendar-generator": ("utility", "calendar-generator")}

CRUMBS = re.compile(r'<nav class="breadcrumbs" aria-label="[^"]+">\s*<ol>(.*?)</ol>\s*</nav>', re.S)
LI = re.compile(r'<li>(?:<a href="([^"]+)">(.*?)</a>|<span aria-current="page">(.*?)</span>)</li>', re.S)


def text(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def body_h1(t):
    start = t.find("</header>", t.find('<header class="site-nav">'))
    m = re.search(r"<h1[^>]*>(.*?)</h1>", t[start:], re.S)
    return text(m.group(1)) if m else None


def catalog(lang):
    t = (REPO_ROOT / ("tools/index.html" if lang == "en" else "es/tools/index.html")).read_text(encoding="utf-8")
    out = {}
    for sec in re.finditer(r'<section class="category-section"[^>]*data-category="(\w+)">(.*?)</section>', t, re.S):
        for h in re.findall(r'<a class="card tool-card" href="([^"]+)"', sec.group(2)):
            out[h.strip("/").split("/")[-1]] = sec.group(1)
    return out


def expected(rel, lang, t, cats, problems):
    """The trail this page should have: [(name, href or None)], or None if it shouldn't have one."""
    parts = rel.parts[:-1]
    if lang == "es":
        parts = parts[1:]
    T, pre = TEXT[lang], PREFIX[lang]
    home = (T["home"], pre)
    if len(parts) == 2 and parts[0] == "blog":
        return "post", [home, (T["blog"], pre + "blog/")]
    if len(parts) != 1 or parts[0] in NOT_TOOLS:
        return None, None
    slug, h1 = parts[0], body_h1(t)
    if slug in OFF_CATALOG:
        cat, parent = OFF_CATALOG[slug]
        parent_h1 = body_h1((REPO_ROOT / pre.lstrip("/") / parent / "index.html").read_text(encoding="utf-8"))
        return "tool", [home, (T["cats"][cat], f"{pre}tools/#{cat}"), (parent_h1, f"{pre}{parent}/"), (h1, None)]
    if slug not in cats:
        problems.append(f"{rel}: tool isn't listed on {pre}tools/, so its breadcrumb category is unknown (add it there, or to OFF_CATALOG if that's deliberate)")
        return "tool", None
    return "tool", [home, (T["cats"][cats[slug]], f"{pre}tools/#{cats[slug]}"), (h1, None)]


def main() -> int:
    problems = []
    cats = {"en": catalog("en"), "es": catalog("es")}
    pages = [f for f in sorted(REPO_ROOT.rglob("index.html")) if f.relative_to(REPO_ROOT).parts[0] not in EXCLUDE_TOP_LEVEL]
    pages.append(REPO_ROOT / "404.html")
    counts = {"tool": 0, "post": 0}
    for f in pages:
        rel = f.relative_to(REPO_ROOT)
        lang = "es" if rel.parts[0] == "es" else "en"
        t = f.read_text(encoding="utf-8")
        kind, want = expected(rel, lang, t, cats[lang], problems)
        navs = CRUMBS.findall(t)
        if not kind:
            if navs or 'class="breadcrumbs"' in t:
                problems.append(f"{rel}: only tool pages and blog posts have a breadcrumb trail")
            continue
        counts[kind] += 1
        if len(navs) != 1:
            problems.append(f"{rel}: expected one breadcrumb trail (<nav class=\"breadcrumbs\"><ol>...), found {len(navs)}")
            continue
        items = LI.findall(navs[0])
        got = [(text(a_name), href) if href else (text(cur), None) for href, a_name, cur in items]
        if not items or any(h is None for _, h in got[:-1]) or got[-1][1] is not None:
            problems.append(f"{rel}: every breadcrumb level but the last must be a link, and the last must be <span aria-current=\"page\">")
            continue
        if kind == "post":
            label = got[-1][0]
            if not label or len(label) > MAX_POST_LABEL:
                problems.append(f"{rel}: blog breadcrumb label must be a short hand-written label (1-{MAX_POST_LABEL} characters), got {label!r}")
            if want:
                want = want + [(label, None)]
        if want and got != want:
            problems.append(f"{rel}: breadcrumb is {got}, expected {want}")
        crumb_pos, h1_pos = t.find('<nav class="breadcrumbs"'), t.find("<h1", t.find("</header>", t.find('<header class="site-nav">')))
        if not (0 < crumb_pos < h1_pos):
            problems.append(f"{rel}: the breadcrumb trail must come before the page's H1")
        if ".breadcrumbs li + li::before" not in t:
            problems.append(f"{rel}: missing the breadcrumb CSS block")

        lds = []
        for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', t, re.S):
            try:
                data = json.loads(block)
            except ValueError:
                continue
            if isinstance(data, dict) and data.get("@type") == "BreadcrumbList":
                lds.append(data)
        if len(lds) != 1:
            problems.append(f"{rel}: expected one BreadcrumbList JSON-LD block, found {len(lds)}")
            continue
        own_url = "/" + "/".join(rel.parts[:-1]) + "/"
        want_ld = [(i + 1, name, DOMAIN + (href or own_url)) for i, (name, href) in enumerate(got)]
        got_ld = [(e.get("position"), e.get("name"), e.get("item")) for e in lds[0].get("itemListElement", [])]
        if got_ld != want_ld:
            problems.append(f"{rel}: BreadcrumbList JSON-LD {got_ld} doesn't match the visible trail {want_ld}")

    if problems:
        print("Breadcrumb problems found:")
        for p in problems:
            print(f"  - {p}")
        print(f"\n{len(problems)} problem(s) across {len(pages)} pages checked")
        return 1
    print(f"OK: {counts['tool']} tool pages and {counts['post']} blog posts have a correct breadcrumb trail "
          f"and matching BreadcrumbList JSON-LD; no other page has one ({len(pages)} pages checked).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
