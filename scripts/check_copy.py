#!/usr/bin/env python3
"""Fail if a page's scripts put an em dash or a "file(s)"-style plural on screen.

Editorial rule #1 in CLAUDE.md (no em dashes in visible content) used to stop
at <script> blocks, so the messages tools show while they work (dropzone,
progress, warnings, errors) collected 88 em dashes on 61 pages, and 8 tools
said "1 file(s) selected". Those were rewritten on 2026-10-22; this keeps them
out. It checks string literals in every page's own scripts (not JSON-LD, not
comments), so code that merely mentions an em dash has to be listed in ALLOWED.

It also fails on text colors that are too faint in light theme (added 2026-11-21, after #236, #238
and the per-tool fixes): a CSS `color:` set to one of LIGHT_BAD_TEXT (pale red, green and amber, all
under 4.5:1 on white) fails unless every selector of that rule has a light-theme override with a good
color (`:root[data-theme="light"] <same selector>{color:...}`), and an inline style or a script's
style.color/cssText with one of them always fails. Rules scoped to the light or dark theme, and rules that
only color an icon (an .icon-box or an svg, always next to a text label), are not text and are skipped.

Run in CI on every push/PR to main, same as check_sitemap.py. --root DIR checks another copy of the site
(scripts/test_check_copy.py uses it).
"""
import argparse
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

# Text colors under 4.5:1 on white (measured 2026-11-21): use #b91c1c, #166534 or #92400e in light theme.
# #b45309 isn't listed: it reaches 5.02:1 on white and 4.65:1 on the light amber tint (#fef5e7).
LIGHT_BAD_TEXT = {
    "#f87171": 2.77, "#4ade80": 1.74, "#f59e0b": 2.15, "#fbbf24": 1.67, "#d97706": 3.19, "#fcd34d": 1.44,
}
BAD = "|".join(c.lstrip("#") for c in LIGHT_BAD_TEXT)
STYLE_BLOCK = re.compile(r"<style[^>]*>(.*?)</style>", re.S | re.I)
RULE = re.compile(r"([^{}]+)\{([^{}]*)\}")
TEXT_COLOR = re.compile(r"(?:^|;)\s*color\s*:\s*([^;!]+)", re.I)
BAD_COLOR = re.compile(rf"#({BAD})\b", re.I)
INLINE_BAD = re.compile(rf"""style\s*=\s*["'](?:[^"']*[;\s])?color\s*:\s*#({BAD})\b"""
                        rf"""|\.style\.color\s*=\s*["']#({BAD})\b|cssText[^;\n]*?(?:^|[;"'`\s])color\s*:\s*#({BAD})\b""", re.I)
LIGHT_PREFIX = re.compile(r"""^(?::root|html)?\[data-theme=["']?light["']?\]\s+""")
DARK_ONLY = re.compile(r"""\[data-theme=["']?dark["']?\]|:not\(\[data-theme=["']?light["']?\]\)""")
ICON_ONLY = re.compile(r"(?:\.icon-box[\w.-]*|\bsvg[\w.-]*)$")


def norm(selector):
    return re.sub(r"\s+", " ", selector).strip()


def light_color_problems(rel, text):
    """Bad text colors without a light-theme override in this page (CSS, inline styles, scripts)."""
    css = "\n".join(STYLE_BLOCK.findall(text))
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    rules = [(norm(sel), decls) for sel, decls in RULE.findall(css)]
    overridden = set()
    for sel, decls in rules:
        m = TEXT_COLOR.search(decls)
        if not m or BAD_COLOR.search(m.group(1)):
            continue
        for s in sel.split(","):
            s = norm(s)
            if LIGHT_PREFIX.search(s):
                overridden.add(LIGHT_PREFIX.sub("", s))
    problems = []
    for sel, decls in rules:
        m = TEXT_COLOR.search(decls)
        bad = m and BAD_COLOR.search(m.group(1))
        if not bad:
            continue
        for s in sel.split(","):
            s = norm(s)
            if not s or s.startswith("@") or LIGHT_PREFIX.search(s) or DARK_ONLY.search(s) or ICON_ONLY.search(s):
                continue
            if s not in overridden:
                problems.append(f"{rel}: {s}{{color:{bad.group(0)}}} has no light-theme override "
                                f"({LIGHT_BAD_TEXT[bad.group(0).lower()]}:1 on white)")
    for m in INLINE_BAD.finditer(text):
        color = "#" + next(g for g in m.groups() if g)
        problems.append(f"{rel}: inline or script text color {color} can't follow the theme: {m.group(0)[:80]}")
    return problems


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # the report quotes em dashes
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", default=str(REPO_ROOT), help="the site folder to check")
    root = Path(ap.parse_args().root).resolve()
    problems = []
    color_problems = []
    pages = 0
    files = sorted(root.rglob("index.html")) + ([root / "404.html"] if (root / "404.html").exists() else [])
    for f in files:
        rel = f.relative_to(root)
        if rel.parts[0] in EXCLUDE_TOP_LEVEL:
            continue
        text = f.read_text(encoding="utf-8")
        color_problems += light_color_problems(rel, text)
        if f.name != "index.html":
            continue
        pages += 1
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
    if color_problems:
        print("Text colors too faint in light theme:")
        for p in color_problems:
            print(f"  - {p}")
        print(f"\n{len(color_problems)} problem(s). Add a light-only rule next to it, e.g. "
              ":root[data-theme=\"light\"] <selector>{color:#92400e;} (amber), #b91c1c (red) or #166534 (green).")
    if problems or color_problems:
        return 1
    print(f"OK: no em dashes or \"(s)\" plurals in the script messages of {pages} pages, and no pale red, "
          f"green or amber text color ({', '.join(LIGHT_BAD_TEXT)}) without a light-theme override.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
