#!/usr/bin/env python3
"""Fail if a literal bidi control character appears in the site's own code.

Bidi controls (the Arabic letter mark, LRM and RLM, the embeddings and overrides
U+202A to U+202E, and the isolates U+2066 to U+2069) are invisible, and inside
code they can make a line read differently from what it does ("Trojan Source").
Where code needs one (a regex, a string), write it as an escape, like \\u200F.

Checked: every .js, .mjs, .py and .json file in scripts/ and in assets/ outside
assets/vendor (the vendored libraries stay byte-identical to upstream), and the
inline <script> blocks of every page. Page text outside scripts is content and is
not checked: an RLM in a Hebrew sentence is legitimate there.

Usage: python scripts/check_bidi_chars.py [--root DIR]   (CI: check-copy)
"""
import argparse
import re
import sys
from pathlib import Path

# Code points, never the characters themselves, so this file stays clean too.
BIDI = {0x061C: "ARABIC LETTER MARK", 0x200E: "LEFT-TO-RIGHT MARK", 0x200F: "RIGHT-TO-LEFT MARK",
        0x202A: "LEFT-TO-RIGHT EMBEDDING", 0x202B: "RIGHT-TO-LEFT EMBEDDING", 0x202C: "POP DIRECTIONAL FORMATTING",
        0x202D: "LEFT-TO-RIGHT OVERRIDE", 0x202E: "RIGHT-TO-LEFT OVERRIDE", 0x2066: "LEFT-TO-RIGHT ISOLATE",
        0x2067: "RIGHT-TO-LEFT ISOLATE", 0x2068: "FIRST STRONG ISOLATE", 0x2069: "POP DIRECTIONAL ISOLATE"}
CODE_SUFFIXES = (".js", ".mjs", ".py", ".json")
EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules", "prototypes", "audit", "claude"}
SCRIPT = re.compile(r"<script\b[^>]*>(.*?)</script>", re.S | re.I)


def hits(text, start=0, end=None):
    """(offset, code point) of every bidi control in text[start:end]."""
    end = len(text) if end is None else end
    return [(i, ord(text[i])) for i in range(start, end) if ord(text[i]) in BIDI]


def report(problems, rel, text, found, where):
    for i, cp in found:
        line = text.count("\n", 0, i) + 1
        problems.append(f"{rel}:{line}: literal U+{cp:04X} {BIDI[cp]} {where}; write it as an escape (\\u{cp:04X})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent), help="site folder to check")
    root = Path(ap.parse_args().root)
    sys.stdout.reconfigure(encoding="utf-8")
    problems, files, pages = [], 0, 0
    for top in ("scripts", "assets"):
        for f in sorted((root / top).rglob("*")):
            rel = f.relative_to(root).as_posix()
            if not f.is_file() or not rel.endswith(CODE_SUFFIXES) or rel.startswith("assets/vendor/"):
                continue
            files += 1
            text = f.read_text(encoding="utf-8")
            report(problems, rel, text, hits(text), "in code")
    for f in sorted(root.rglob("*.html")):
        rel = f.relative_to(root)
        if rel.parts[0] in EXCLUDE_TOP_LEVEL:
            continue
        pages += 1
        text = f.read_text(encoding="utf-8")
        for m in SCRIPT.finditer(text):
            report(problems, rel.as_posix(), text, hits(text, m.start(1), m.end(1)), "in an inline <script>")
    if problems:
        print("Literal bidi control characters in code:")
        for p in problems:
            print(f"  - {p}")
        print(f"\n{len(problems)} problem(s)")
        return 1
    print(f"OK: no literal bidi control characters in {files} code files (scripts/, the site's own assets) "
          f"or in the inline scripts of {pages} pages.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
