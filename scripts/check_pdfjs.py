#!/usr/bin/env python3
"""Fail if any page opens a PDF with PDF.js without turning off its eval path.

The site loads PDF.js 3.11.174, which is affected by CVE-2024-4367: with the
default isEvalSupported: true, a crafted PDF can make PDF.js run arbitrary
JavaScript on orisod.com while it draws the PDF's fonts. Upstream's workaround
for versions before 4.2.67 is to pass isEvalSupported: false to every
pdfjsLib.getDocument() call, which costs nothing visible. Every page carries its
own copy of the tool code, so this check keeps every copy (and every new PDF
tool copied from one) safe.

Run in CI on every push/PR to main, same as check_sitemap.py.
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules", "prototypes", "audit", "claude"}

# The argument of each getDocument(...) call, up to the closing "})".
CALL = re.compile(r"getDocument\((.*?)\)\s*\.promise", re.S)


def main() -> int:
    problems = []
    pages = calls = 0
    for f in sorted(REPO_ROOT.rglob("*.html")):
        rel = f.relative_to(REPO_ROOT)
        if rel.parts[0] in EXCLUDE_TOP_LEVEL:
            continue
        text = f.read_text(encoding="utf-8")
        if "getDocument(" not in text:
            continue
        pages += 1
        found = CALL.findall(text)
        if len(found) != text.count("getDocument("):
            problems.append(f"{rel}: a getDocument() call isn't in the form getDocument({{...}}).promise, so it can't be checked")
        for arg in found:
            calls += 1
            if not re.search(r"isEvalSupported\s*:\s*false", arg):
                problems.append(f"{rel}: getDocument({arg.strip()[:60]}) must pass isEvalSupported: false (CVE-2024-4367)")

    if problems:
        print("PDF.js problems found:")
        for p in problems:
            print(f"  - {p}")
        print(f"\n{len(problems)} problem(s) across {pages} pages that open PDFs")
        return 1
    print(f"OK: all {calls} PDF.js getDocument() calls on {pages} pages pass isEvalSupported: false.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
