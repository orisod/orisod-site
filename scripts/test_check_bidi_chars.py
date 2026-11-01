#!/usr/bin/env python3
"""Negative tests for check_bidi_chars.py.

Builds a tiny site in a temporary folder, checks that check_bidi_chars.py passes
on it (including legitimate RLM marks in page text and in a vendored library),
then puts a bidi control into code one way at a time and checks that it fails.
The characters are made with chr(), so this file has none of them itself.

  python scripts/test_check_bidi_chars.py   (CI: check-copy)
"""
import subprocess
import sys
import tempfile
from pathlib import Path

CHECK = Path(__file__).resolve().parent / "check_bidi_chars.py"
RLM, RLO, LRI, ALM = chr(0x200F), chr(0x202E), chr(0x2066), chr(0x061C)
HEBREW = "".join(chr(c) for c in (0x05E9, 0x05DC, 0x05D5, 0x05DD))
BS = chr(92)


def site(**changes):
    files = {
        "scripts/tool.js": "const re = /[" + BS + "u200F]/u;\n",
        "scripts/tool.py": "MARK = '" + BS + "u200F'\n",
        "assets/js/site.js": "console.log('ok');\n",
        "assets/data/names.json": '{"name": "' + HEBREW + '"}\n',
        "assets/vendor/lib/1.0/lib.min.js": "var mark='" + RLM + "';\n",  # vendored: not ours, not checked
        "index.html": "<html><body><p>" + HEBREW + RLM + " (page text)</p><script>const x = 1;</script></body></html>\n",
    }
    files.update(changes)
    return files


CASES = [
    ("the clean demo site (RLM only in page text and a vendored library)", site(), None),
    ("RLO in a .js file in scripts/", site(**{"scripts/tool.js": "const s = 'a" + RLO + "b';\n"}), "scripts/tool.js:1: literal U+202E"),
    ("RLM in a .py file", site(**{"scripts/tool.py": "MARK = '" + RLM + "'\n"}), "scripts/tool.py:1: literal U+200F"),
    ("LRI in a .json file in assets/", site(**{"assets/data/names.json": '{"name": "' + LRI + HEBREW + '"}\n'}), "assets/data/names.json:1: literal U+2066"),
    ("ALM in the site's own JS", site(**{"assets/js/site.js": "\n\nconst a = '" + ALM + "';\n"}), "assets/js/site.js:3: literal U+061C"),
    ("RLM in a page's inline script", site(**{"index.html": "<html><body><p>ok</p><script>\nconst t = '" + HEBREW + RLM + "';\n</script></body></html>\n"}),
     "index.html:2: literal U+200F RIGHT-TO-LEFT MARK in an inline <script>"),
]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    failed = 0
    for label, files, want in CASES:
        with tempfile.TemporaryDirectory() as d:
            for rel, text in files.items():
                p = Path(d) / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text, encoding="utf-8")
            r = subprocess.run([sys.executable, str(CHECK), "--root", d], capture_output=True, text=True, encoding="utf-8")
        out = r.stdout + r.stderr
        ok = r.returncode == 0 if want is None else (r.returncode == 1 and want in out)
        failed += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {label}: check_bidi_chars {'passed' if r.returncode == 0 else 'failed'}"
              + ("" if ok else f" (expected {'a pass' if want is None else repr(want)})\n{out}"))
    print(f"{len(CASES) - failed} of {len(CASES)} check_bidi_chars tests passed." if not failed else f"{failed} test(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
