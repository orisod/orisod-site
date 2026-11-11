#!/usr/bin/env python3
"""Negative tests for check_nav_sync.py and sync_nav.py (the generated site menu).

Builds a small site in a temporary folder from the real assets/nav/ sources, two
tiny /tools catalogs (EN and ES) and a few pages that carry the three site-nav
regions, checks that check_nav_sync.py passes on it, then breaks it one way at a
time and checks that it fails with the expected message. Then it checks that
sync_nav.py --write repairs stale regions without touching a byte outside them
(CRLF kept) and leaves pages without markers alone, and that --add, given real
pages (Compress Image, a Spanish page with the old theme label, the 404 page)
turned back into their hand-copied nav (scripts/fixtures/nav-initiative-2.*),
gives back exactly the pages in this checkout, and refuses a page whose header
isn't the standard copy. Run after changing either script:

  python scripts/test_check_nav_sync.py   (CI: check-nav-sync)
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CHECK = HERE / "check_nav_sync.py"
SYNC = HERE / "sync_nav.py"
sys.path.insert(0, str(HERE))
import sync_nav as sn  # noqa: E402

NL = chr(10)
SOURCES = ("assets/nav/site-nav.css", "assets/nav/site-nav.js", "assets/nav/site-nav.html", "assets/nav/strings.json")


def catalog(cards):
    """A tiny /tools page: one section per category, each with the given (href, name) cards."""
    out = ["<!doctype html><html><head><title>t</title></head><body><main>"]
    for cat in sn.CATS:
        out.append(f'<section class="category-section" id="{cat}" data-category="{cat}">')
        for href, name in cards[cat]:
            out.append(f'<a class="card tool-card" href="{href}"><div class="icon-box"></div>'
                       f'<div class="name tool-card-title">{name}</div><div class="desc tool-card-desc">d</div></a>')
        out.append("</section>")
    out.append("</main></body></html>")
    return NL.join(out) + NL


EN_CARDS = {"image": [("/crop-image/", "Crop Image"), ("/resize-image/", "Resize Image")],
            "pdf": [("/merge-pdf/", "Merge PDF")], "utility": [("/json-formatter/", "JSON Formatter")]}
ES_CARDS = {"image": [("/es/crop-image/", "Recortar imagen")], "pdf": [("/es/merge-pdf/", "Unir PDF")],
            "utility": [("/es/json-formatter/", "Formateador JSON")]}


def page(nl=NL, css=True, html=True, js=True, extra_head="", body="<main>t</main>"):
    """A page carrying the three regions (empty: sync_nav.py --write fills them)."""
    parts = ["<!doctype html><html><head><title>p</title>" + extra_head, "<style>", ".mine{color:red;}"]
    if css:
        parts += [sn.CSS_START, sn.CSS_END]
    parts += [".after{color:blue;}", "</style></head><body>"]
    if html:
        parts += [sn.HTML_START, sn.HTML_END]
    parts += [body]
    if js:
        parts += [sn.JS_START, sn.JS_END]
    parts += ["</body></html>", ""]
    return nl.join(parts)


PLAIN = "<!doctype html><html><head><style>.x{}</style></head><body><p>no menu here</p></body></html>" + NL


def build(root, pages=None, sources=None, en_cards=EN_CARDS, sync=True):
    for rel in SOURCES:
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO / rel, root / rel)
    for rel, text in (sources or {}).items():
        (root / rel).write_bytes(text.encode("utf-8"))
    files = {"tools/index.html": catalog(EN_CARDS), "es/tools/index.html": catalog(ES_CARDS),
             "a-tool/index.html": page(), "es/a-tool/index.html": page(nl="\r\n"), "plain/index.html": PLAIN}
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(text.encode("utf-8"))
    if sync:
        r = subprocess.run([sys.executable, str(SYNC), "--root", str(root), "--write"], capture_output=True, text=True, encoding="utf-8")
        assert r.returncode == 0, r.stdout
    # Changes applied after the sync (what each case breaks).
    if en_cards is not EN_CARDS:
        (root / "tools/index.html").write_bytes(catalog(en_cards).encode("utf-8"))
    for rel, text in (pages or {}).items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes((text(root / rel) if callable(text) else text).encode("utf-8"))


def edit(old, new):
    """A page change applied to the synced file: replace old with new (exactly once)."""
    def apply(path):
        t = path.read_bytes().decode("utf-8")
        assert t.count(old) == 1, (old, t.count(old))
        return t.replace(old, new)
    return apply


def check(**kw):
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        pages, sources = kw.pop("pages", None), kw.pop("sources", None)
        broken_sources = kw.pop("broken_sources", None)
        build(root, pages=pages, sources=sources, **kw)
        for rel, text in (broken_sources or {}).items():
            (root / rel).write_bytes(text.encode("utf-8"))
        r = subprocess.run([sys.executable, str(CHECK), "--root", d], capture_output=True, text=True, encoding="utf-8")
        return r.returncode, r.stdout + r.stderr


SRC_JS = (REPO / "assets/nav/site-nav.js").read_text(encoding="utf-8")
SRC_CSS = (REPO / "assets/nav/site-nav.css").read_text(encoding="utf-8")
SRC_TEMPLATE = (REPO / "assets/nav/site-nav.html").read_text(encoding="utf-8")
SRC_STRINGS = (REPO / "assets/nav/strings.json").read_text(encoding="utf-8")

CASES = [
    # (label, kwargs, expected text in the failure; None means it must pass)
    ("the valid demo site (LF and CRLF pages, a page without markers)", {}, None),
    ("a flyout link edited by hand on a page", {"pages": {"a-tool/index.html": edit(">Crop Image</a></li>", ">Crop images</a></li>")}},
     "out of date: a-tool/index.html"),
    ("a tool added to /tools without syncing", {"en_cards": {**EN_CARDS, "pdf": EN_CARDS["pdf"] + [("/split-pdf/", "Split PDF")]}},
     "out of date: a-tool/index.html"),
    ("a tool renamed on /tools without syncing", {"en_cards": {**EN_CARDS, "utility": [("/json-formatter/", "JSON formatter")]}},
     "out of date: a-tool/index.html"),
    ("the CSS source edited without syncing", {"broken_sources": {"assets/nav/site-nav.css": SRC_CSS + ".new{}" + NL}},
     "2 out of date"),
    ("the script source edited without syncing", {"broken_sources": {"assets/nav/site-nav.js": SRC_JS + "var added = 1;" + NL}},
     "2 out of date"),
    # Comments stay in the sources and are stripped from the copies, so editing one changes no page.
    ("only a comment edited in the sources", {"broken_sources": {"assets/nav/site-nav.js": SRC_JS + "// a new note" + NL,
                                                                "assets/nav/site-nav.css": SRC_CSS + "/* a new note */" + NL}},
     None),
    ("a script comment after code", {"broken_sources": {"assets/nav/site-nav.js": SRC_JS + "var added = 1; // why" + NL}},
     "has a comment after code"),
    ("a page with only the header and script regions", {"pages": {"x/index.html": page(css=False)}},
     "x/index.html: has only the html, js site-nav region(s)"),
    ("a page with two header regions", {"pages": {"x/index.html": page(body="<main>t</main>" + NL + sn.HTML_START + NL + sn.HTML_END)}},
     "x/index.html: has 2 site-nav html start marker(s) and 2 end marker(s)"),
    ("a page with its script region above its header", {"pages": {"x/index.html": page(html=False, body=sn.HTML_START + NL + sn.HTML_END).replace(
        sn.JS_START + NL + sn.JS_END, "@@").replace("</style></head><body>", "</style></head><body>" + NL + sn.JS_START + NL + sn.JS_END).replace("@@", "")}},
     "x/index.html: has its site-nav.js region before its header region"),
    ("a CSS region outside any <style>", {"pages": {"x/index.html": page().replace("<style>", "<!-- -->").replace("</style>", "")}},
     "x/index.html: has its site-nav.css region outside a single <style> element"),
    ("a header region inside a <script>", {"pages": {"x/index.html": page().replace(sn.HTML_START, "<script>" + NL + sn.HTML_START).replace(sn.HTML_END, sn.HTML_END + NL + "</script>")}},
     "x/index.html: has its site-nav html region inside a <script> element"),
    ("a script source with </script> in it", {"broken_sources": {"assets/nav/site-nav.js": SRC_JS + "// </script>" + NL}},
     "contains </script> or <!--"),
    ("a CSS source with </style> in it", {"broken_sources": {"assets/nav/site-nav.css": SRC_CSS + "/* </style> */" + NL}},
     "contains a </style> tag"),
    ("strings.json with a key missing in one language", {"broken_sources": {"assets/nav/strings.json": SRC_STRINGS.replace('"language": "Idioma"', '"idioma": "Idioma"')}},
     "must hold the same keys for en and es"),
    ("a template without its flyout section", {"broken_sources": {"assets/nav/site-nav.html": SRC_TEMPLATE.replace("<!-- @flyout -->", "<!-- @flyouts -->")}},
     "has no @flyout section"),
    ("a template placeholder with no value", {"broken_sources": {"assets/nav/site-nav.html": SRC_TEMPLATE.replace("{{site_menu}}", "{{site_menus}}")}},
     "no value for {{site_menus}}"),
    ("a category on /tools with no cards", {"en_cards": {**EN_CARDS, "image": []}},
     "no tool cards found in the image section"),
    ("a homepage whose search box isn't on the page", {"pages": {"index.html": page()}},
     "index.html: its search icon targets #homeSearch, which isn't on the page"),
    ("a 404 page whose menu was given flyouts by hand", {"pages": {"404.html": lambda path: (path.parent / "a-tool/index.html").read_bytes().decode("utf-8")}},
     "out of date: 404.html"),
    ("a Spanish copy of the 404 page", {"pages": {"es/404.html": page()}},
     "there is no es/404.html"),
]


def sync(root, *args):
    return subprocess.run([sys.executable, str(SYNC), "--root", str(root), *args], capture_output=True, text=True, encoding="utf-8")


def strip_regions(text):
    """The page with every site-nav region (markers included) cut out."""
    for _, start, end in sn.REGIONS:
        if start in text:
            a, b = text.index(start), text.index(end) + len(end)
            b += 2 if text.startswith("\r\n", b) else 1 if text.startswith("\n", b) else 0
            text = text[:a] + text[b:]
    return text


def write_mode_checks():
    bad = []
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        build(root)
        for rel in ("a-tool/index.html", "es/a-tool/index.html"):
            t = (root / rel).read_bytes().decode("utf-8")
            (root / rel).write_bytes(t.replace("Orisod</a>", "Orisod!</a>", 1).encode("utf-8"))
        before = {rel: (root / rel).read_bytes().decode("utf-8") for rel in ("a-tool/index.html", "es/a-tool/index.html", "plain/index.html")}
        if sync(root).returncode != 0 or any((root / r).read_bytes().decode("utf-8") != t for r, t in before.items()):
            bad.append("the dry run changed a page or failed")
        r = sync(root, "--write")
        if r.returncode != 0:
            bad.append("--write failed: " + r.stdout)
        for rel in ("a-tool/index.html", "es/a-tool/index.html"):
            now = (root / rel).read_bytes().decode("utf-8")
            if strip_regions(now) != strip_regions(before[rel]):
                bad.append(f"--write changed {rel} outside its regions")
            if "Orisod!</a>" in now:
                bad.append(f"--write didn't repair {rel}'s header region")
        if "\r\n" not in (root / "es/a-tool/index.html").read_bytes().decode("utf-8"):
            bad.append("--write didn't keep the CRLF page's line endings")
        if (root / "plain/index.html").read_bytes().decode("utf-8") != before["plain/index.html"]:
            bad.append("--write touched a page without markers")
        # --add on real pages turned back into their hand-copied nav (the "Minimal nav (Initiative 2)" CSS block and
        # script saved in scripts/fixtures, and the header without flyouts): adopting them must give back exactly
        # the page in this checkout, so nothing but the nav changes. The Spanish page gets the old theme label,
        # which --add accepts and replaces (OLD_STRINGS).
        legacy_css = sn.lf((HERE / "fixtures/nav-initiative-2.css").read_bytes().decode("utf-8"))
        legacy_js = sn.lf((HERE / "fixtures/nav-initiative-2.js.txt").read_bytes().decode("utf-8"))
        if sn.sha(legacy_css) != sn.ADOPT_CSS_SHA256 or sn.sha(legacy_js.rstrip(NL)) != sn.ADOPT_JS_SHA256:
            bad.append("scripts/fixtures/nav-initiative-2.* no longer match ADOPT_CSS_SHA256 / ADOPT_JS_SHA256")
        source = sn.Source(REPO)
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        for rel in SOURCES + tuple(sn.CATALOG.values()):
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / rel, root / rel)
        real = {}
        for rel in ("compress-image/index.html", "es/json-formatter/index.html", "404.html"):
            current = (REPO / rel).read_bytes().decode("utf-8")
            real[rel] = current
            t = sn.lf(current)
            header = source.header(rel, flyouts=False)
            if rel.startswith("es/"):
                header = header.replace('aria-label="' + source.strings["es"]["theme"] + '"', 'aria-label="Cambiar tema claro/oscuro"')
            for (kind, start, end), old in zip(sn.REGIONS, (legacy_css, header, legacy_js)):
                a, b = t.index(start), t.index(end) + len(end) + 1
                t = t[:a] + old + t[b:]
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_bytes(t.replace(NL, sn.newline_of(current)).encode("utf-8"))
        r = sync(root, "--write", "--add", *real)
        for rel, current in real.items():
            if (root / rel).read_bytes().decode("utf-8") != current:
                bad.append(f"--add of {rel}'s hand-copied nav didn't give back exactly the page in this checkout: " + r.stdout[-500:])
        if r.returncode != 0:
            bad.append("--add failed: " + r.stdout[-500:])
        elif subprocess.run([sys.executable, str(CHECK), "--root", d], capture_output=True).returncode != 0:
            bad.append("check_nav_sync failed right after --add")
        nf = real["404.html"]
        nf_header = nf[nf.index(sn.HTML_START):nf.index(sn.HTML_END)]
        if "menu-flyout" in nf_header or "data-flyout" in nf_header or 'href="/tools/#image"' not in nf_header:
            bad.append("the 404 page's generated menu has flyouts")
        # A page whose header isn't the standard copy is refused, and left alone.
        odd = sn.lf((root / "compress-image/index.html").read_bytes().decode("utf-8"))
        a, b = odd.index(sn.HTML_START), odd.index(sn.HTML_END) + len(sn.HTML_END)
        odd = odd[:a] + source.header("odd/index.html", flyouts=False).replace('aria-label="Toggle light/dark theme"', 'aria-label="Switch theme"').rstrip(NL) + odd[b:]
        a, b = odd.index(sn.CSS_START), odd.index(sn.CSS_END) + len(sn.CSS_END) + 1
        odd = odd[:a] + legacy_css + odd[b:]
        a, b = odd.index(sn.JS_START), odd.index(sn.JS_END) + len(sn.JS_END) + 1
        odd = odd[:a] + legacy_js + odd[b:]
        (root / "odd").mkdir()
        (root / "odd/index.html").write_bytes(odd.encode("utf-8"))
        r = sync(root, "--write", "--add", "odd/index.html")
        if r.returncode == 0 or "differs from the generated one" not in r.stdout or (root / "odd/index.html").read_bytes().decode("utf-8") != odd:
            bad.append("--add adopted (or changed) a page whose header isn't the standard copy")
    return bad


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    failed = 0
    for label, kw, want in CASES:
        code, out = check(**kw)
        ok = code == 0 if want is None else (code == 1 and want in out)
        failed += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {label}: check_nav_sync {'passed' if code == 0 else 'failed'}"
              + ("" if ok else f" (expected {'a pass' if want is None else repr(want)})" + NL + out))
    bad = write_mode_checks()
    print(f"  {'FAIL' if bad else 'PASS'}  sync_nav --write and --add touch only the nav" + "".join(NL + "        " + b for b in bad))
    failed += bool(bad)
    total = len(CASES) + 1
    print(f"{total - failed} of {total} check_nav_sync tests passed." if not failed else f"{failed} test(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
