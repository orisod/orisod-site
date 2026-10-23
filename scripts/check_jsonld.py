#!/usr/bin/env python3
"""Fail if a page's structured data (JSON-LD) is broken, incomplete, or disagrees
with what the page visibly shows.

Every page carries its own inline <script type="application/ld+json"> blocks, so
they can drift when a title, H1, FAQ or URL is edited. The design, per page type
(see "Structured data (JSON-LD)" in CLAUDE.md):

- Homepages (/ and /es/): the full Organization (@id ORG_ID) and WebSite (@id SITE_ID).
- Tool pages: WebApplication + FAQPage (one @graph block) + BreadcrumbList.
- Blog posts: BlogPosting + BreadcrumbList.
- About: AboutPage. Privacy, Support: WebPage.
- /tools, the blog indexes and 404: no JSON-LD at all.

Rules checked on every page with an index.html (same set as check_sitemap.py) plus 404.html:
- every block is valid JSON, and the page has exactly the @types listed above,
  each once (no duplicates)
- no aggregateRating, review or reviewRating anywhere: the site has no real ratings
- no em dashes in JSON-LD text
- every url / mainEntityOfPage equals the page's canonical URL
- required fields per type are present (REQUIRED below), and point at the shared
  Organization / WebSite by @id, as a small stub (@type, @id, name)
- WebApplication: name = the visible H1, description = the meta description,
  applicationCategory follows the tool's section on /tools (image tools
  MultimediaApplication, PDF and utility tools UtilitiesApplication),
  inLanguage = the page language, price "0"
- FAQPage: the questions and answers equal the visible .faq-item text, in order
- BlogPosting: headline = the visible H1, description = the meta description,
  datePublished (YYYY-MM-DD, not in the future) and, if present, dateModified on
  or after it and not in the future
- BreadcrumbList only on pages that show a visible breadcrumb trail, ending at the
  canonical URL (check_breadcrumbs.py checks the trail itself level by level)

Run in CI on every push/PR to main, same as check_sitemap.py.
Usage: check_jsonld.py [--root DIR]   (DIR defaults to the repo; used to test against fixtures)
"""
import datetime
import html
import json
import re
import sys
from pathlib import Path

EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules", "prototypes", "audit", "claude"}
ORG_ID = "https://orisod.com/#organization"
SITE_ID = "https://orisod.com/#website"
SAME_AS = ["https://github.com/orisod/orisod-site", "https://www.saashub.com/orisod"]
OFF_CATALOG = {"hebrew-calendar-generator": "utility"}
EXPECTED_TYPES = {
    "home": {"Organization", "WebSite"},
    "tool": {"WebApplication", "FAQPage", "BreadcrumbList"},
    "post": {"BlogPosting", "BreadcrumbList"},
    "about": {"AboutPage"},
    "privacy": {"WebPage"},
    "support": {"WebPage"},
    "index": set(),
    "404": set(),
}
REQUIRED = {
    "Organization": ["@id", "name", "alternateName", "url", "logo", "sameAs"],
    "WebSite": ["@id", "name", "url", "inLanguage", "publisher"],
    "WebApplication": ["name", "description", "url", "applicationCategory", "operatingSystem",
                       "inLanguage", "isAccessibleForFree", "offers", "publisher"],
    "FAQPage": ["mainEntity"],
    "BlogPosting": ["headline", "description", "url", "inLanguage", "datePublished", "author",
                    "publisher", "mainEntityOfPage"],
    "AboutPage": ["name", "url", "inLanguage", "isPartOf", "about"],
    "WebPage": ["name", "url", "inLanguage", "isPartOf"],
    "BreadcrumbList": ["itemListElement"],
}
FORBIDDEN_KEYS = {"aggregateRating", "review", "reviews", "reviewRating"}
BLOCK = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
FAQ = re.compile(r'<div class="faq-item">\s*<div class="q">(.*?)</div>\s*<div>(.*?)</div>\s*</div>', re.S)
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def text(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s))).strip()


def kind(rel):
    if rel.name == "404.html":
        return "404", "en", None
    p = list(rel.parts[:-1])
    lang = "en"
    if p and p[0] == "es":
        lang, p = "es", p[1:]
    if not p:
        return "home", lang, None
    if p in (["tools"], ["blog"]):
        return "index", lang, None
    if len(p) == 2 and p[0] == "blog":
        return "post", lang, None
    if p[0] in ("about", "privacy", "support"):
        return p[0], lang, None
    return "tool", lang, p[0]


def catalog(root, lang):
    f = root / ("tools/index.html" if lang == "en" else "es/tools/index.html")
    out = dict(OFF_CATALOG)
    if f.exists():
        t = f.read_text(encoding="utf-8")
        for sec in re.finditer(r'<section class="category-section"[^>]*data-category="(\w+)">(.*?)</section>', t, re.S):
            for h in re.findall(r'<a class="card tool-card" href="([^"]+)"', sec.group(2)):
                out[h.strip("/").split("/")[-1]] = sec.group(1)
    return out


def keys_in(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from keys_in(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from keys_in(v)


def is_stub(ref, typ, id_):
    return isinstance(ref, dict) and ref.get("@type") == typ and ref.get("@id") == id_ and ref.get("name") == "Orisod"


def check_page(root, f, cats, today, problems):
    rel = f.relative_to(root)
    k, lang, slug = kind(rel)
    t = f.read_text(encoding="utf-8")
    say = lambda msg: problems.append(f"{rel}: {msg}")

    def find(pattern):
        m = re.search(pattern, t, re.S)
        return m.group(1) if m else None
    canon = find(r'<link rel="canonical" href="([^"]+)"')
    meta = find(r'<meta name="description" content="([^"]*)"')
    meta = html.unescape(meta) if meta is not None else None
    hs = t.find("</header>", t.find('<header class="site-nav">'))
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", t[max(hs, 0):], re.S)
    h1 = text(h1.group(1)) if h1 else None
    has_crumbs = '<nav class="breadcrumbs"' in t

    if len(re.findall(r"<script[^>]*ld\+json", t)) != len(BLOCK.findall(t)):
        say('every JSON-LD block must be written exactly as <script type="application/ld+json">')
    items = []
    for i, block in enumerate(BLOCK.findall(t), 1):
        try:
            data = json.loads(block)
        except ValueError as e:
            say(f"JSON-LD block {i} is not valid JSON ({e})")
            continue
        if not isinstance(data, dict) or data.get("@context") != "https://schema.org":
            say(f'JSON-LD block {i} must be an object with "@context": "https://schema.org"')
            continue
        items.extend(data["@graph"] if isinstance(data.get("@graph"), list) else [data])
        bad = FORBIDDEN_KEYS.intersection(keys_in(data))
        if bad:
            say(f"JSON-LD has {', '.join(sorted(bad))}: never add ratings or reviews, the site has none")
        if "—" in block or "\\u2014" in block:
            say("JSON-LD contains an em dash")

    types = [it.get("@type") for it in items]
    for typ in sorted({str(x) for x in types}):
        if types.count(typ) > 1:
            say(f"duplicate {typ} JSON-LD ({types.count(typ)} found, expected one)")
    want = EXPECTED_TYPES[k]
    if set(map(str, types)) != want:
        say(f"JSON-LD types are {sorted(map(str, set(types))) or 'none'}, expected {sorted(want) or 'none'} for this kind of page")
    if "BreadcrumbList" in types and not has_crumbs:
        say("has BreadcrumbList JSON-LD but no visible breadcrumb trail")

    for it in items:
        typ = it.get("@type")
        for field in REQUIRED.get(typ, []):
            if field not in it or it[field] in ("", [], None):
                say(f"{typ} is missing {field}")
        for field in ("url",):
            if typ not in ("Organization", "WebSite") and field in it and it[field] != canon:
                say(f"{typ}.url is {it[field]!r}, but the canonical URL is {canon!r}")
        for field in ("publisher", "author", "about"):
            if field in it and not is_stub(it[field], "Organization", ORG_ID):
                say(f'{typ}.{field} must be the Organization stub {{"@type": "Organization", "@id": "{ORG_ID}", "name": "Orisod"}}')
        if "isPartOf" in it and not is_stub(it["isPartOf"], "WebSite", SITE_ID):
            say(f'{typ}.isPartOf must be the WebSite stub {{"@type": "WebSite", "@id": "{SITE_ID}", "name": "Orisod"}}')
        if "inLanguage" in it and typ != "WebSite" and it["inLanguage"] != lang:
            say(f"{typ}.inLanguage is {it['inLanguage']!r}, expected {lang!r}")

        if typ == "Organization":
            if it.get("@id") != ORG_ID or it.get("url") != "https://orisod.com/" or it.get("name") != "Orisod":
                say(f'Organization must have @id "{ORG_ID}", name "Orisod" and url "https://orisod.com/"')
            if it.get("sameAs") != SAME_AS:
                say(f"Organization.sameAs must be exactly {SAME_AS} (only profiles that really exist)")
        elif typ == "WebSite":
            if it.get("@id") != SITE_ID or it.get("url") != "https://orisod.com/":
                say(f'WebSite must have @id "{SITE_ID}" and url "https://orisod.com/"')
        elif typ == "WebApplication":
            if it.get("name") != h1:
                say(f"WebApplication.name {it.get('name')!r} must equal the visible H1 {h1!r}")
            if it.get("description") != meta:
                say("WebApplication.description must equal the meta description")
            cat = cats[lang].get(slug)
            want_cat = "MultimediaApplication" if cat == "image" else "UtilitiesApplication"
            if cat is None:
                say(f"tool isn't in the /tools catalog, so its applicationCategory can't be checked")
            elif it.get("applicationCategory") != want_cat:
                say(f"WebApplication.applicationCategory must be {want_cat} for a {cat} tool")
            offers = it.get("offers") or {}
            if offers.get("@type") != "Offer" or offers.get("price") != "0" or offers.get("priceCurrency") != "USD":
                say('WebApplication.offers must be {"@type": "Offer", "price": "0", "priceCurrency": "USD"}')
            if it.get("isAccessibleForFree") is not True:
                say("WebApplication.isAccessibleForFree must be true")
        elif typ == "FAQPage":
            visible = [(text(q), text(a)) for q, a in FAQ.findall(t)]
            ld = []
            for q in it.get("mainEntity", []):
                ans = q.get("acceptedAnswer") or {}
                ld.append((q.get("name"), ans.get("text")))
                if q.get("@type") != "Question" or ans.get("@type") != "Answer":
                    say("every FAQPage entry must be a Question with an acceptedAnswer of type Answer")
            if not visible:
                say("has FAQPage JSON-LD but no visible .faq-item questions")
            elif ld != visible:
                diffs = [i + 1 for i, pair in enumerate(ld) if i >= len(visible) or pair != visible[i]]
                say(f"FAQPage JSON-LD doesn't match the visible FAQ text ({len(ld)} vs {len(visible)} entries; "
                    f"first mismatch at entry {diffs[0] if diffs else len(ld) + 1}). Copy the visible wording exactly")
        elif typ == "BlogPosting":
            if it.get("headline") != h1:
                say(f"BlogPosting.headline {it.get('headline')!r} must equal the visible H1 {h1!r}")
            if it.get("description") != meta:
                say("BlogPosting.description must equal the meta description")
            mep = it.get("mainEntityOfPage")
            if (mep.get("@id") if isinstance(mep, dict) else mep) != canon:
                say("BlogPosting.mainEntityOfPage must point at the canonical URL")
            pub, mod = it.get("datePublished"), it.get("dateModified")
            if not (isinstance(pub, str) and DATE.match(pub)) or pub > today:
                say(f"BlogPosting.datePublished {pub!r} must be a real YYYY-MM-DD date, not in the future")
            elif mod is not None and (not (isinstance(mod, str) and DATE.match(mod)) or mod < pub or mod > today):
                say(f"BlogPosting.dateModified {mod!r} must be YYYY-MM-DD, on or after datePublished and not in the future")
        elif typ == "BreadcrumbList":
            els = it.get("itemListElement") or []
            if [e.get("position") for e in els] != list(range(1, len(els) + 1)):
                say("BreadcrumbList positions must run 1, 2, 3...")
            if any(not str(e.get("item", "")).startswith("https://orisod.com/") for e in els):
                say("every BreadcrumbList item must be an absolute https://orisod.com/ URL")
            if els and els[-1].get("item") != canon:
                say(f"the last BreadcrumbList item must be the canonical URL {canon!r}")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    root = Path(args[args.index("--root") + 1]).resolve() if "--root" in args else Path(__file__).resolve().parent.parent
    today = datetime.date.today().isoformat()
    cats = {"en": catalog(root, "en"), "es": catalog(root, "es")}
    pages = [f for f in sorted(root.rglob("index.html")) if f.relative_to(root).parts[0] not in EXCLUDE_TOP_LEVEL]
    if (root / "404.html").exists():
        pages.append(root / "404.html")
    problems = []
    for f in pages:
        check_page(root, f, cats, today, problems)
    if problems:
        print("Structured data (JSON-LD) problems found:")
        for p in problems:
            print(f"  - {p}")
        print(f"\n{len(problems)} problem(s) across {len(pages)} pages. See \"Structured data (JSON-LD)\" in CLAUDE.md, "
              "and copy the JSON-LD from a page of the same kind and language.")
        return 1
    print(f"OK: JSON-LD on all {len(pages)} pages is valid and matches each page")
    return 0


if __name__ == "__main__":
    sys.exit(main())
