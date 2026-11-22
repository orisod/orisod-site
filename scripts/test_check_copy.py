#!/usr/bin/env python3
"""Prove scripts/check_copy.py's light- and dark-theme color rules pass good pages and fail each bad one.

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
    # Dark theme (the default)
    ("dark good: links in #60a5fa, light keeps the accent", page(".back-link{color:#60a5fa;}" + L + ".back-link{color:var(--accent);}"), True, ""),
    ("dark good: the accent only in a light rule", page(L + ".x{color:var(--accent);}" + L + ".y{color:#2563eb;}"), True, ""),
    ("dark good: accent as border or background only", page(".btn{background:var(--accent);border-color:#2563eb;color:#ffffff;}"), True, ""),
    ("dark good: icon-only rules", page(".icon-box.cat-image{color:#2563eb;}.category-title svg.cat-utility{color:#8b5cf6;}"), True, ""),
    ("dark good: a listed exception", page(".stat-card .num{font-size:24px;font-weight:bold;color:var(--accent);}"), True, ""),
    ("dark good: inline accent link with the dark rule", page('a[style*="color:var(--accent)"]{color:#60a5fa !important;}', '<p><a href="/x/" style="color:var(--accent);">x</a></p>'), True, ""),
    ("dark good: sample markup inside a textarea", page(body='<textarea><h1 style="color:#2563eb;">Hello</h1></textarea>'), True, ""),
    ("dark bad: link in the accent", page(".back-link{font-size:14px;color:var(--accent);}"), False, ".back-link{color:var(--accent)} is too faint in dark theme"),
    ("dark bad: hover in the accent", page(".footer-col a:hover{opacity:1;color:var(--accent);}"), False, ".footer-col a:hover{color:var(--accent)}"),
    ("dark bad: #2563eb uppercase", page(".hash-label{color:#2563EB;}"), False, ".hash-label{color:#2563EB}"),
    ("dark bad: violet tag text", page(".suggestion-cat.cat-utility{background:rgba(139,92,246,.3);color:#8b5cf6;}"), False, ".suggestion-cat.cat-utility{color:#8b5cf6}"),
    ("dark bad: light-theme ink as the base", page('.stamp-btn[data-preset="draft"]{color:#374151;}' + L + '.stamp-btn[data-preset="draft"]{color:#111827;}'), False, '.stamp-btn[data-preset="draft"]{color:#374151}'),
    ("dark bad: red hover", page(".clear-all-btn:hover{border-color:#dc2626;color:#dc2626;}"), False, ".clear-all-btn:hover{color:#dc2626}"),
    ("dark bad: green ink", page(".ok{color:#15803d;}"), False, ".ok{color:#15803d}"),
    ("dark bad: inline accent link without the dark rule", page(body='<p><a href="/x/" style="color:var(--accent);text-decoration:none;">x</a></p>'), False, "need the dark rule"),
    ("dark bad: inline accent on another element", page(body='<span style="color:#2563eb">x</span>'), False, "inline or script text color #2563eb is too faint in dark theme"),
    ("dark bad: script sets the accent", page(body="<script>el.style.color = 'var(--accent)';</script>"), False, "inline or script text color var(--accent)"),
    # Light-theme leftovers from #244/#245: diagram labels, placeholders, accent on a tint or below full opacity
    ("leftover good: amber label with its light fill rule", page(L + 'svg text[fill="#f59e0b"]{fill:#92400e;}', '<svg><text fill="#f59e0b">1</text></svg>'), True, ""),
    ("leftover good: green label, rule scoped to the figure", page(L + '.theme-figure text[fill="#4ade80"]{fill:#166534;}', '<svg><text fill="#4ade80">ok</text></svg>'), True, ""),
    ("leftover good: label in a palette color", page(body='<svg><text fill="#92400e">1</text><text fill="var(--text)">2</text></svg>'), True, ""),
    ("leftover good: amber shape, not text", page(body='<svg><rect fill="#f59e0b"/><circle fill="#f87171"/></svg>'), True, ""),
    ("leftover good: placeholders in #475569", page("main input::placeholder{color:var(--muted-text);opacity:1;}" + L + "main input::placeholder{color:#475569;opacity:1;}"), True, ""),
    ("leftover good: no placeholder rule at all", page(body='<main><input placeholder="Name"></main>'), True, ""),
    ("leftover good: tinted accent text with #1d4ed8", page(".case-btn.active{color:#60a5fa;}" + L + ".case-btn.active{color:#1d4ed8;}"), True, ""),
    ("leftover good: accent labels at full opacity", page('.theme-figure text[fill="var(--accent)"]{fill:#60a5fa;}' + L + '.theme-figure text[fill="var(--accent)"]{fill:var(--accent);}'), True, ""),
    ("leftover good: accent labels at 0.85 with #1d4ed8", page(L + '.theme-figure text[fill="var(--accent)"]{fill:#1d4ed8;}' + L + '.theme-figure text[fill="var(--accent)"][opacity="0.85"]{opacity:0.85;}'), True, ""),
    ("leftover bad: amber label with no light rule", page(body='<svg><text x="1" fill="#f59e0b">1</text></svg>'), False, 'diagram labels with fill="#f59e0b" have no light-theme rule'),
    ("leftover bad: label rule for another color", page(L + 'svg text[fill="#4ade80"]{fill:#166534;}', '<svg><text fill="#f87171">x</text></svg>'), False, 'fill="#f87171"'),
    ("leftover bad: label rule that is still pale", page(L + 'svg text[fill="#f59e0b"]{fill:#fbbf24;}', '<svg><text fill="#f59e0b">1</text></svg>'), False, 'fill="#f59e0b"'),
    ("leftover bad: placeholder reverted in light", page("main textarea::placeholder{color:var(--muted-text);opacity:1;}" + L + "main textarea::placeholder{color:revert;opacity:revert;}"), False, "{color:revert} gives placeholders the browser default"),
    ("leftover bad: case button active in the accent", page(".case-btn.active{color:#60a5fa;}" + L + ".case-btn.active{color:var(--accent);}"), False, ".case-btn.active needs a light-theme color that isn't the accent"),
    ("leftover bad: page marker without a light rule", page(".diff-line.page-marker{color:#60a5fa;opacity:0.85;}"), False, ".diff-line.page-marker needs a light-theme color"),
    ("leftover good: privacy-note link in #1e40af", page(".privacy-note a{color:#60a5fa;}" + L + ".privacy-note a{color:#1e40af;}"), True, ""),
    ("leftover bad: privacy-note link in the accent", page(".privacy-note a{color:#60a5fa;}" + L + ".privacy-note a{color:var(--accent);}"), False, ".privacy-note a needs a light-theme color that isn't the accent"),
    ("leftover bad: accent labels at 0.85 in the accent", page(L + '.theme-figure text[fill="var(--accent)"]{fill:var(--accent);}' + L + '.theme-figure text[fill="var(--accent)"][opacity="0.85"]{opacity:0.85;}'), False, "accent diagram labels drawn at opacity 0.85"),
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
    print(f"\nAll {len(CASES)} check_copy.py color cases (light and dark theme) behaved as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
