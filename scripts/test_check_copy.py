#!/usr/bin/env python3
"""Prove scripts/check_copy.py's light-theme color rule passes good pages and fails each bad one.

Builds a tiny site in a temporary folder (tempfile, so TMP/TMPDIR decide where), one page per case, and runs
the checker on it with --root. Run: python3 scripts/test_check_copy.py
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CHECKER = Path(__file__).resolve().parent / "check_copy.py"
L = ':root[data-theme="light"] '


def page(css="", body=""):
    return f"<!doctype html><html><head><style>{css}</style></head><body>{body}</body></html>\n"


# (name, page, should pass, text the failure must contain)
CASES = [
    ("good: light override next to the rule", page(".warn{color:#f59e0b;}\n" + L + ".warn{color:#92400e;}"), True, ""),
    ("good: override in a combined light rule", page(".a{color:#f87171;}.b{color:#f87171;}" + L + ".a, " + L + ".b{color:#b91c1c;}"), True, ""),
    ("good: palette colors need no override", page(".ok{color:#92400e;}.ok2{color:#b91c1c;}.ok3{color:#166534;}.ok4{color:#b45309;}"), True, ""),
    ("good: amber background and border only", page(".box{background:rgba(245,158,11,.1);border-color:#f59e0b;}"), True, ""),
    ("good: icon-only rules (icon box, svg)", page(".icon-box.cat-pdf{color:#f59e0b;}.jump-link.cat-pdf svg{color:#f59e0b;}"), True, ""),
    ("good: dark-only rule", page(':root[data-theme="dark"] .x{color:#4ade80;}'), True, ""),
    ("good: inside @media with its override", page("@media (max-width:600px){.m{color:#fbbf24;}}" + L + ".m{color:#92400e;}"), True, ""),
    ("good: a comment naming a bad color", page("/* was #f59e0b */ .c{color:#92400e;}"), True, ""),
    ("bad: #f87171 with no override", page(".error{color:#f87171;}"), False, ".error{color:#f87171} has no light-theme override"),
    ("bad: #4ade80 with no override", page(".ok{color:#4ade80;font-weight:bold;}"), False, ".ok{color:#4ade80}"),
    ("bad: #f59e0b warning text", page(".warn-note{font-size:13px;color:#f59e0b;}"), False, ".warn-note{color:#f59e0b}"),
    ("bad: #d97706 text", page(".hint{color:#d97706;}"), False, ".hint{color:#d97706}"),
    ("bad: #fbbf24 uppercase hex", page(".found{color:#FBBF24;}"), False, ".found{color:#FBBF24}"),
    ("bad: override for another selector only", page(".a{color:#f59e0b;}" + L + ".b{color:#92400e;}"), False, ".a{color:#f59e0b}"),
    ("bad: override that is still a bad color", page(".a{color:#f59e0b;}" + L + ".a{color:#fbbf24;}"), False, ".a{color:#f59e0b}"),
    ("bad: one selector of a list uncovered", page(".a, .b{color:#f87171;}" + L + ".a{color:#b91c1c;}"), False, ".b{color:#f87171}"),
    ("bad: inside @media with no override", page("@media (max-width:600px){.m{color:#fbbf24;}}"), False, ".m{color:#fbbf24}"),
    ("bad: inline style attribute", page(body='<span style="font-weight:bold;color:#f59e0b">x</span>'), False, "inline or script text color #f59e0b"),
    ("bad: inline style, color first", page(body='<div style="color:#d97706">x</div>'), False, "inline or script text color #d97706"),
    ("good: inline background-color only", page(body='<div style="background-color:#f59e0b">x</div>'), True, ""),
    ("bad: script sets style.color", page(body="<script>el.style.color = '#f87171';</script>"), False, "inline or script text color #f87171"),
    ("bad: script sets cssText", page(body="<script>el.style.cssText = 'margin:0;color:#4ade80';</script>"), False, "inline or script text color #4ade80"),
]


def main():
    failures = 0
    with tempfile.TemporaryDirectory(prefix="check_copy_") as tmp:
        root = Path(tmp) / "site"
        for name, html, want_ok, want_text in CASES:
            shutil.rmtree(root, ignore_errors=True)
            (root / "tool").mkdir(parents=True)
            (root / "tool" / "index.html").write_text(html, encoding="utf-8")
            r = subprocess.run([sys.executable, str(CHECKER), "--root", str(root)], capture_output=True, text=True, encoding="utf-8")
            ok = (r.returncode == 0) == want_ok and (want_ok or want_text in r.stdout)
            failures += not ok
            print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" (exit {r.returncode}):\n{r.stdout}"))
    if failures:
        print(f"\n{failures} of {len(CASES)} case(s) failed.")
        return 1
    print(f"\nAll {len(CASES)} check_copy.py light-theme color cases behaved as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
