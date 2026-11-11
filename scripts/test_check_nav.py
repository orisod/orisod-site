#!/usr/bin/env python3
"""Negative tests for check_nav.py's flyout rule (rule 6, Orisod 2.0).

Copies a few real pages into a temporary folder (the WhatsApp link generator,
/tools, Compress Image and the 404 page, which has the English flyouts plus the
Spanish ones in a <template>), checks that check_nav.py passes on them, then breaks one page at a time and checks
that it fails with the expected message. Run after changing check_nav.py:

  python scripts/test_check_nav.py   (CI: check-nav)
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CHECK = HERE / "check_nav.py"
NL = chr(10)
PAGES = ["whatsapp-link-generator/index.html", "es/whatsapp-link-generator/index.html", "tools/index.html",
         "es/tools/index.html", "compress-image/index.html", "es/compress-image/index.html", "404.html"]
WA = "whatsapp-link-generator/index.html"
PLAIN = "compress-image/index.html"
NOT_FOUND = "404.html"
TEMPLATE = r'<template id="menuFlyouts-es">.*?</template>'


def sub(pattern, repl, count=1):
    """A change to one page: a regex replacement that must match."""
    def apply(text):
        new, n = re.subn(pattern, repl, text, count=count, flags=re.S)
        assert n, pattern
        return new
    return apply


def run(changes):
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        for rel in PAGES:
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            text = (REPO / rel).read_bytes().decode("utf-8")
            if rel in changes:
                text = changes[rel](text)
            (root / rel).write_bytes(text.encode("utf-8"))
        r = subprocess.run([sys.executable, str(CHECK), "--root", d], capture_output=True, text=True, encoding="utf-8")
        return r.returncode, r.stdout + r.stderr


CASES = [
    # (label, {page: change}, expected text in the failure; None means it must pass)
    ("the real pages", {}, None),
    ("a generated menu missing its PDF flyout", {WA: sub(r'\n    <div class="menu-flyout" id="menuFlyout-pdf".*?</div>', "")},
     "the menu has no pdf flyout (#menuFlyout-pdf)"),
    ("a category link that doesn't name its flyout", {WA: sub(r' data-flyout="menuFlyout-image"', "")},
     "the image menu link doesn't name its flyout"),
    ("a flyout that isn't hidden", {WA: sub(r'(id="menuFlyout-utility" role="group" aria-label="[^"]*") hidden>', r"\1>")},
     "the utility flyout must be a hidden role=\"group\" panel"),
    ("a flyout with no tools", {WA: sub(r'(id="menuFlyout-image"[^>]*><p class="menu-flyout-label">[^<]*</p><ul>).*?(</ul>)', r"\1\2")},
     "the image flyout lists no tools"),
    ("a flyout moved away from its link", {WA: sub(r'(\n    <div class="menu-flyout" id="menuFlyout-image".*?</div>)(.*?)(\n    <hr>)', r"\2\1\3")},
     "the image flyout isn't right after its menu link"),
    ("a page building flyouts at runtime", {PLAIN: sub(r"</body>", "<script>var f = document.createElement('div'); f.className = 'menu-flyout';</script>" + NL + "</body>")},
     "compress-image" + chr(92 if sys.platform == "win32" else 47) + "index.html: has menu-flyout outside the generated site-nav regions"),
    ("a hand-made flyout copy outside the regions", {WA: sub(r"</body>", '<div class="menu-flyout" hidden></div>' + NL + "</body>")},
     "has menu-flyout outside the generated site-nav regions"),
    ("a page with only some of the regions", {WA: sub(r"<!-- site-nav\.js: start\..*?<!-- site-nav\.js: end -->\n?", "")},
     "has only the css, html site-nav region(s)"),
    ("a page without the generated menu (rollout complete)",
     # only the six marker lines go: the nav stays, but it's no longer the generated menu
     {PLAIN: sub(r"(?:<!-- site-nav(?:\.js)?: (?:start\.[^\n]*?|end) -->|/\* site-nav\.css: (?:start\.[^\n]*?|end) \*/)\r?\n", "", count=0)},
     "doesn't carry the generated site menu"),
    ("the 404 page without its flyouts (the old exception)",
     {NOT_FOUND: lambda t: sub(r' data-flyout="menuFlyout-\w+"', "", count=0)(sub(r'\n    <div class="menu-flyout".*?</div>', "", count=0)(t))},
     "404.html: the image menu link doesn't name its flyout"),
    ("the 404 page without its English PDF flyout",
     {NOT_FOUND: sub(r'(</a>)\r?\n    <div class="menu-flyout" id="menuFlyout-pdf".*?</div>', r"\1")},
     "404.html: the menu has no pdf flyout (#menuFlyout-pdf)"),
    ("the 404 page without its Spanish flyouts", {NOT_FOUND: sub(r"\r?\n  " + TEMPLATE, "")},
     "404.html: the menu needs the es flyouts too"),
    ("the 404 page's Spanish template missing its utility flyout",
     {NOT_FOUND: sub(r'(<template id="menuFlyouts-es">.*?)\r?\n    <div class="menu-flyout" id="menuFlyout-utility".*?</div>', r"\1")},
     "404.html: the es menu has no utility flyout"),
    ("the 404 page's Spanish template linking to an English page",
     {NOT_FOUND: sub(r'(<template id="menuFlyouts-es">.*?<li><a href=")/es/', r"\1/")},
     "404.html: the es image flyout links to a page outside /es/"),
    ("the 404 page's Spanish panel not hidden",
     {NOT_FOUND: sub(r'(<template id="menuFlyouts-es">.*?id="menuFlyout-pdf" role="group" aria-label="[^"]*") hidden>', r"\1>")},
     "404.html: the es pdf flyout must be a hidden role=\"group\" panel"),
    ("a tool page with a translated flyouts template",
     {WA: sub(r"(\r?\n</header>)", lambda m: "\n  " + __import__("re").search(TEMPLATE, (REPO / NOT_FOUND).read_bytes().decode("utf-8"), __import__("re").S).group(0) + m.group(1))},
     "has a translated flyouts <template>; only 404.html carries one"),
    ("the theme button back to an emoji", {PLAIN: sub(r'(id="themeToggle"[^>]*>).*?(</button>)', r"\1" + chr(0x1F319) + r"\2")},
     "the theme button must hold the moon and sun icons"),
    ("a theme script still writing the emoji", {PLAIN: sub(r"(var btn = document\.getElementById\('themeToggle'\);)", r"\1" + NL + "  btn.textContent = document.documentElement.getAttribute('data-theme')==='light' ? 'x' : 'y';")},
     "a script still writes the theme button's emoji"),
    ("a tool page whose menu lost every flyout, like the 404 page's",
     {WA: lambda t: sub(r' data-flyout="menuFlyout-\w+"', "", count=0)(sub(r'\n    <div class="menu-flyout".*?</div>', "", count=0)(t))},
     "the menu has no image flyout"),
]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    failed = 0
    for label, changes, want in CASES:
        code, out = run(changes)
        ok = code == 0 if want is None else (code == 1 and want in out)
        failed += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {label}: check_nav {'passed' if code == 0 else 'failed'}"
              + ("" if ok else f" (expected {'a pass' if want is None else repr(want)})" + NL + out))
    print(f"{len(CASES) - failed} of {len(CASES)} check_nav flyout tests passed." if not failed else f"{failed} test(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
