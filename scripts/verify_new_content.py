#!/usr/bin/env python3
"""Run the pre-merge content checks on new or changed pages, then the site-wide checks.

Step 3 of the audit described in CLAUDE.md ("Shipping a new tool or post").
This is a manual, local runner: it is deliberately not part of CI.

    python scripts/verify_new_content.py              # pages added/changed vs main
    python scripts/verify_new_content.py --all        # every page on the site
    python scripts/verify_new_content.py tools/x/index.html es/tools/x/index.html
    python scripts/verify_new_content.py --a11y       # also run the axe scan (needs node + playwright)

Page checks (on the selected pages):
  em-dash        no em dash in visible text, alt text or SVG labels (<title> and
                 <meta name="description"> are exempt; script strings are check_copy.py's job)
  tag-balance    every element opened is closed, no stray closing tags
  links          every internal href/src points to a file that exists; for a page that
                 already exists on --base, no link was removed
  why-orisod     no "Why Orisod" / "Por qué Orisod" section on a tool page
  guide-link     a new tool page links to its guide (the "Want the full picture?" line) and
                 the guide links back; an existing tool page doesn't lose that link
  parity         the EN and ES versions both exist and have the same structure (h2, h3, list
                 items, FAQ items, figures, images, related cards, CTA box, guide link)
  sentence-case  <title>, meta description, H1 (not tool names), blog card titles and all
                 card blurbs use sentence case; acronyms, product names and tool names are exempt
  card-sync      a related-tools card's icon, title and description match its /tools card exactly
                 (CLAUDE.md: "Related tools card grid"); scripts/sync_related_cards.py --write fixes it
  catalog        a new tool is on /tools and in the homepage TOOLS list; a new post is on the blog index
Site checks: check_sitemap, check_jsonld, check_breadcrumbs, check_nav, check_copy, check_social,
and content_dates (fails if a sitemap or post date still needs `content_dates.py --write`).
"""

import argparse
import html
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_extract import NOT_PAGES, REPO_ROOT, changed_pages, extract_file, page_info, plain, read  # noqa: E402
from sync_related_cards import card_diffs, catalog as sync_catalog  # noqa: E402

SITE_CHECKS = ["check_sitemap.py", "check_jsonld.py", "check_breadcrumbs.py", "check_nav.py",
               "check_copy.py", "check_social.py"]
GUIDE_LINK = re.compile(r"📖[^<]*(Want the full picture\?|¿Quieres saber más\?|Lee nuestra guía)[^<]*<a href=\"([^\"]+)\"")
WHY = re.compile(r"<h[23][^>]*>\s*(why (use )?orisod|por qu[ée] (usar )?orisod)", re.I)

# Words that keep their capital letter mid-sentence. All-caps words (PDF, JPG, A4),
# words with a capital inside (WebP, iPhone, N-Up, Base64-like) and tool names are
# allowed automatically; this list is for the rest.
PROPER = {
    # brands, products, apps
    "Orisod", "Google", "Chrome", "Safari", "Firefox", "Edge", "Windows", "Mac", "Apple", "Microsoft", "Word",
    "Excel", "PowerPoint", "Office", "Adobe", "Acrobat", "Reader", "Photoshop", "Canva", "Gmail", "Outlook",
    "Instagram", "Facebook", "YouTube", "LinkedIn", "Twitter", "Twitter/X", "X", "TikTok", "Pinterest",
    "WhatsApp", "Reddit", "Discord", "Slack", "Linux", "Android", "Markdown", "Unicode", "Stripe", "GitHub",
    "Canvas", "Preview", "Photos", "Base64", "Tesseract", "Lighthouse", "Wi-Fi", "Bluetooth", "Web", "Speech",
    "P@ssw0rd", "Pages", "Keynote", "Numbers", "Docs", "Sheets", "Slides", "Drive", "Dropbox", "OneDrive",
    # paper sizes
    "Letter", "Legal", "Tabloid", "Ledger", "Executive",
    # languages, calendars, holidays, places
    "English", "Spanish", "French", "German", "Hebrew", "Jewish", "Islamic", "Muslim", "Christian", "Catholic",
    "Orthodox", "Hindu", "Chinese", "Gregorian", "Julian", "Easter", "Christmas", "Torah", "Torá", "Tishrei",
    "Elul", "Shabbat", "Havdalah", "Yom", "Tov", "Kippur", "Rosh", "Hashanah", "Pesach", "Passover", "Hanukkah",
    "Diaspora", "Israel", "Jerusalem", "Epifanía", "Pascua", "Navidad", "Ramadan", "Ramadán", "Eid",
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
    "November", "December", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
}
# Multi-word names that are written capitalized on purpose (case styles, app names, page names).
PROPER_PHRASES = ["Title Case", "Sentence case", "Tipo Título", "Tipo oración", "Visor de fotos",
                  "Vista Previa", "Privacy Policy", "Web Speech"]


class Result:
    def __init__(self):
        self.fails, self.notes = {}, []

    def fail(self, check, page, msg):
        self.fails.setdefault(check, []).append(f"{page}: {msg}")


def git(*args):
    return subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8")


def all_pages():
    pages = [p.relative_to(REPO_ROOT).as_posix() for p in REPO_ROOT.rglob("*.html")]
    return sorted(p for p in pages if p.split("/")[0] not in NOT_PAGES)


def counterpart(rel):
    return rel[3:] if rel.startswith("es/") else "es/" + rel


def visible(text):
    """Page text a visitor sees or a screen reader announces (no head, scripts or styles)."""
    t = re.sub(r"<head\b.*?</head>", "", text, flags=re.S)
    return re.sub(r"<(script|style)\b.*?</\1>", "", t, flags=re.S)


# --- catalog data ------------------------------------------------------------
def tools_cards(lang):
    rel = "es/tools/index.html" if lang == "es" else "tools/index.html"
    out = {}
    for m in re.finditer(r'<a class="card tool-card" href="([^"]+)">.*?class="name tool-card-title">(.*?)</div>'
                         r'\s*<div class="desc tool-card-desc">(.*?)</div>', read(rel), re.S):
        out[m.group(1)] = (m.group(2).strip(), m.group(3).strip())
    return out


def blog_cards(lang):
    rel = "es/blog/index.html" if lang == "es" else "blog/index.html"
    out = {}
    for m in re.finditer(r'<a class="blog-card" href="([^"]+)">.*?<h2>(.*?)</h2>\s*<p>(.*?)</p>', read(rel), re.S):
        out[m.group(1)] = (m.group(2).strip(), m.group(3).strip())
    return out


def tool_names():
    names = set()
    for lang in ("en", "es"):
        names |= {html.unescape(n) for n, _ in tools_cards(lang).values()}
    for rel in ("index.html", "es/index.html"):
        names |= {html.unescape(n) for n in re.findall(r'\{n:"([^"]+)"', read(rel))}
    for rel in all_pages():  # off-catalog tools (Hebrew calendar generator) are named by their H1
        if rel.endswith("hebrew-calendar-generator/index.html"):
            m = re.search(r"<h1[^>]*>(.*?)</h1>", read(rel), re.S)
            names.add(plain(m.group(1)))
    return sorted(names, key=len, reverse=True)


# --- sentence case -------------------------------------------------------------
def sentence_case_problems(text, names):
    t = html.unescape(plain(text))
    for phrase in list(names) + PROPER_PHRASES:
        t = t.replace(phrase, "Xname")
    t = re.sub(r"\b\w+(?=\s+\{)", "Xname", t)  # literal templates such as "Page {page} of {pages}"
    bad = []
    for seg in re.split(r"(?:[.?!:;|¿¡]|\s[–—-]\s|\(\s*\")\s*", t):
        words = seg.split()
        for w in words[1:]:
            core = re.sub(r"^[\"'“”‘’(«¿¡]+|[\"'“”‘’),.»;:!?]+$", "", w)
            core = re.sub(r"['’]s$", "", core)
            if not core or not core[0].isupper() or core == "Xname":
                continue
            head = core.split("-")[0]
            if (re.fullmatch(r"[A-Z0-9&@./+]{2,}s?", core) or re.search(r".[A-Z]", core) or len(head) == 1
                    or core in PROPER or head in PROPER or re.fullmatch(r"[A-Z0-9&@./+]{2,}s?", head)):
                continue
            bad.append(core)
    return bad


# --- page checks ---------------------------------------------------------------
def check_page(rel, base, res, names, new_pages, catalogs):
    text = read(rel)
    info = page_info(rel)
    ex = extract_file(rel, text=text)
    ptype = ex.info["page_type"]
    is_new = rel in new_pages

    # em-dash
    hidden = [m.span() for m in re.finditer(r"<head\b.*?</head>|<(script|style)\b.*?</\1>", text, re.S)]
    for m in re.finditer("\u2014", text):
        if any(a <= m.start() < b for a, b in hidden):
            continue
        snippet = re.sub(r"\s+", " ", plain(text[max(0, m.start() - 60):m.start() + 30]))
        res.fail("em-dash", rel, f"line {text.count(chr(10), 0, m.start()) + 1}: …{snippet}…")

    # tag-balance
    for e in ex.tree.errors:
        res.fail("tag-balance", rel, e)

    # links
    for href in re.findall(r'(?:href|src)="(/[^"#?]*)', re.sub(r"<(script|style)\b.*?</\1>", "", text, flags=re.S)):
        if href.startswith("//"):
            continue
        target = REPO_ROOT / href.lstrip("/")
        if not (target.is_file() or (target / "index.html").is_file()):
            res.fail("links", rel, f"broken link {href}")
    if not is_new:
        old = git("show", f"{base}:{rel}").stdout
        lost = sorted(set(re.findall(r'(?:href|src)="([^"]+)"', old)) - set(re.findall(r'(?:href|src)="([^"]+)"', text)))
        for h in lost:
            res.fail("links", rel, f"link removed vs {base}: {h}")

    # why-orisod
    if ptype == "tool" and WHY.search(text):
        res.fail("why-orisod", rel, "has a \"Why Orisod\" section (see CLAUDE.md: never re-add)")

    # guide-link
    if ptype == "tool":
        g = GUIDE_LINK.search(text)
        if is_new and not g:
            res.fail("guide-link", rel, "new tool page has no \"Want the full picture? Read our guide\" link")
        if not is_new and not g and GUIDE_LINK.search(git("show", f"{base}:{rel}").stdout):
            res.fail("guide-link", rel, f"lost its guide link (it had one on {base})")
        if g:
            guide = REPO_ROOT / g.group(2).lstrip("/") / "index.html"
            if guide.is_file() and f'href="{info["page_path"]}"' not in guide.read_text(encoding="utf-8"):
                res.fail("guide-link", rel, f"its guide {g.group(2)} doesn't link back to {info['page_path']}")

    # parity (checked from the EN side, or from ES when only ES is in scope)
    other = counterpart(rel)
    if rel != "404.html":
        if not (REPO_ROOT / other).is_file():
            res.fail("parity", rel, f"no {('Spanish' if info['lang'] == 'en' else 'English')} version ({other})")
        elif info["lang"] == "en" or other not in catalogs["scope"]:
            a, b = structure(text), structure(read(other))
            diff = [f"{k} {a[k]} vs {b[k]}" for k in a if a[k] != b[k]]
            if diff:
                res.fail("parity", rel, f"differs from {other}: " + ", ".join(diff))

    # sentence-case (tool names are exempt: tool H1s and tool card titles)
    for blk in ex.blocks:
        ft, bid = blk["field_type"], blk["block_id"]
        blog_card = ft == "card_title" and ".blog." in bid
        if ft in ("title", "meta_description", "card_desc") or (bid == "h1" and ptype != "tool") or blog_card:
            src = blk["source_html"]
            if ft == "title":
                src = re.split(r"\s+\|\s+", src)[0]
            bad = sentence_case_problems(src, names)
            if bad:
                res.fail("sentence-case", rel, f"{bid}: \"{plain(src)[:70]}\" (capitalized: {', '.join(dict.fromkeys(bad))})")

    # card-sync
    tcards, bcards = catalogs[info["lang"]]
    for href, diffs in card_diffs(text, catalogs["sync"][info["lang"]]):
        for field, (_, _, live, want) in (diffs or {}).items():
            shown = "" if field == "icon" else f": \"{live}\", /tools has \"{want}\""
            res.fail("card-sync", rel, f"related card {href} {field} differs from /tools{shown} "
                                       "(fix: python scripts/sync_related_cards.py --write)")

    # catalog
    if is_new and ptype == "tool":
        if info["page_path"] not in tcards:
            res.fail("catalog", rel, f"not on {'/es' if info['lang'] == 'es' else ''}/tools/")
        home = "es/index.html" if info["lang"] == "es" else "index.html"
        if f'h:"{info["page_path"]}"' not in read(home):
            res.fail("catalog", rel, f"not in the homepage TOOLS list ({home})")
    if is_new and ptype == "guide" and info["page_path"] not in bcards:
        res.fail("catalog", rel, "not on the blog index")


def structure(text):
    main = re.search(r"<main\b.*?</main>", text, re.S)
    t = main.group(0) if main else text
    t = re.sub(r'<nav class="breadcrumbs".*?</nav>', "", t, flags=re.S)
    t = re.sub(r"<(script|style)\b.*?</\1>", "", t, flags=re.S)
    return {
        "h2": len(re.findall(r"<h2\b", t)), "h3": len(re.findall(r"<h3\b", t)),
        "list items": len(re.findall(r"<li\b", t)), "FAQ items": t.count('class="faq-item"'),
        "figures": len(re.findall(r"<figure\b", t)), "images": len(re.findall(r"<img\b", t)),
        "related cards": len(re.findall(r'class="(?:related-card|blog-card)"', t)),
        "CTA box": t.count('class="cta-box"'), "guide link": len(GUIDE_LINK.findall(t)),
    }


# --- site checks ---------------------------------------------------------------
def site_checks(res, a11y):
    for script in SITE_CHECKS:
        p = subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / script)], cwd=REPO_ROOT,
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        last = (p.stdout.strip().splitlines() or p.stderr.strip().splitlines() or [""])[-1]
        status = "ok  " if p.returncode == 0 else "FAIL"
        print(f"  {status} {script:<22} {last[:110]}")
        if p.returncode:
            res.fail("site", script, (p.stdout + p.stderr).strip()[-1500:])
    p = subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "content_dates.py")], cwd=REPO_ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    pending = re.findall(r"Would update (\d+)", p.stdout)
    if p.returncode or any(int(n) for n in pending):
        print(f"  FAIL content_dates.py       dates need updating: run python scripts/content_dates.py --write")
        res.fail("site", "content_dates.py", p.stdout.strip()[-800:])
    else:
        print("  ok   content_dates.py       sitemap and post dates are up to date")
    if a11y:
        p = subprocess.run(["node", str(REPO_ROOT / "scripts" / "check_a11y.js")], cwd=REPO_ROOT,
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        last = (p.stdout.strip().splitlines() or [""])[-1]
        print(f"  {'ok  ' if p.returncode == 0 else 'FAIL'} check_a11y.js          {last[:110]}")
        if p.returncode:
            res.fail("site", "check_a11y.js", (p.stdout + p.stderr).strip()[-1500:])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("files", nargs="*", help="pages to check (default: HTML pages added/changed vs --base)")
    ap.add_argument("--base", default="main", help="branch to compare against (default: main)")
    ap.add_argument("--all", action="store_true", help="check every page on the site")
    ap.add_argument("--a11y", action="store_true", help="also run scripts/check_a11y.js (several minutes)")
    ap.add_argument("--no-site", action="store_true", help="skip the site-wide check scripts")
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    files = all_pages() if args.all else ([f.replace("\\", "/") for f in args.files] or changed_pages(args.base))
    base_files = set(git("ls-tree", "-r", "--name-only", args.base).stdout.split())
    new_pages = {f for f in files if f not in base_files}
    res = Result()

    if files:
        print(f"Checking {len(files)} page(s) ({len(new_pages)} new vs {args.base})")
        names = tool_names()
        catalogs = {"en": (tools_cards("en"), blog_cards("en")), "es": (tools_cards("es"), blog_cards("es")),
                    "scope": set(files), "sync": {"en": sync_catalog("en"), "es": sync_catalog("es")}}
        for rel in files:
            check_page(rel, args.base, res, names, new_pages, catalogs)
        checks = ["em-dash", "tag-balance", "links", "why-orisod", "guide-link", "parity", "sentence-case",
                  "card-sync", "catalog"]
        for c in checks:
            items = res.fails.get(c, [])
            print(f"  {'ok  ' if not items else 'FAIL'} {c:<14} {'' if not items else f'{len(items)} problem(s)'}")
    else:
        print(f"No HTML pages added or changed vs {args.base}: page checks skipped (use --all or pass files).")

    if not args.no_site:
        print("Site checks:")
        site_checks(res, args.a11y)

    if res.fails:
        print("\nProblems:")
        for c, items in res.fails.items():
            for i in items:
                print(f"  [{c}] {i}")
        print(f"\nFAILED: {sum(len(v) for v in res.fails.values())} problem(s).")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
