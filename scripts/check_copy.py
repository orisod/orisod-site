#!/usr/bin/env python3
"""Fail if a page's scripts put an em dash or a "file(s)"-style plural on screen.

Editorial rule #1 in CLAUDE.md (no em dashes in visible content) used to stop
at <script> blocks, so the messages tools show while they work (dropzone,
progress, warnings, errors) collected 88 em dashes on 61 pages, and 8 tools
said "1 file(s) selected". Those were rewritten on 2026-10-22; this keeps them
out. It checks string literals in every page's own scripts (not JSON-LD, not
comments), so code that merely mentions an em dash has to be listed in ALLOWED.

Run in CI on every push/PR to main, same as check_sitemap.py.
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules", "prototypes", "audit", "claude"}

SCRIPT = re.compile(r"<script(?![^>]*application/ld\+json)[^>]*>(.*?)</script>", re.S)
# '...', "..." or `...` on one line (escaped quotes allowed)
STRING = re.compile(r"""'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`""")
PLURAL = re.compile(r"\b(?:file|page|image|photo|item|word|line|row|sheet|archivo|página|imagen|foto)\(s\)", re.I)
# AI Writing Checker counts em dashes in the visitor's text, so it has to name one.
ALLOWED = {"'—'"}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # the report quotes em dashes
    problems = []
    pages = 0
    for f in sorted(REPO_ROOT.rglob("index.html")):
        rel = f.relative_to(REPO_ROOT)
        if rel.parts[0] in EXCLUDE_TOP_LEVEL:
            continue
        pages += 1
        text = f.read_text(encoding="utf-8")
        for block in SCRIPT.finditer(text):
            code = re.sub(r"(?m)^\s*//.*$", "", block.group(1))
            code = re.sub(r"/\*.*?\*/", "", code, flags=re.S)
            for s in STRING.findall(code):
                if s in ALLOWED:
                    continue
                if "—" in s:
                    problems.append(f"{rel}: em dash in a script message: {s[:90]}")
                if PLURAL.search(s):
                    problems.append(f"{rel}: \"(s)\" plural in a script message: {s[:90]}")

    if problems:
        print("Copy problems found in script messages:")
        for p in problems:
            print(f"  - {p}")
        print(f"\n{len(problems)} problem(s). Use a colon, comma, period or parentheses instead of an em dash, "
              "and pick singular/plural with the count instead of \"(s)\".")
        return 1
    print(f"OK: no em dashes or \"(s)\" plurals in the script messages of {pages} pages.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
