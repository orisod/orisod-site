#!/usr/bin/env python3
"""Negative tests for check_nav.py's flyout rule (rule 6, Orisod 2.0).

Copies a few real pages into a temporary folder (the WhatsApp link generator and
/tools, which carry the generated menu, and Compress Image, which doesn't yet),
checks that check_nav.py passes on them, then breaks one page at a time and checks
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
         "es/tools/index.html", "compress-image/index.html", "es/compress-image/index.html"]
WA = "whatsapp-link-generator/index.html"
PLAIN = "compress-image/index.html"


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
