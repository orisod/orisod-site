#!/usr/bin/env python3
"""Fail unless GoatCounter is the site's only analytics, loaded the same way everywhere.

Orisod counts visits with GoatCounter (no cookies, no stored visitor IDs; see
/privacy/). Google Analytics was removed on 2026-10-26. This keeps it that way.

Rules, for every page with an index.html (same set as check_sitemap.py) plus 404.html:
- exactly one GoatCounter snippet, in <head>, written exactly as SNIPPET: the
  endpoint https://orisod.goatcounter.com/count and the self-hosted
  /assets/goatcounter/count.js (never gc.zgo.at)
- no Google Analytics anywhere on the page: no gtag, googletagmanager,
  google-analytics.com, dataLayer, G-/UA- measurement IDs, or the words
  "Google Analytics"
- no other analytics or tracking service (see OTHER_TRACKERS)
And assets/goatcounter/count.js must still be the reviewed copy (COUNT_JS_SHA256),
so an update is always a deliberate change; see "Analytics" in CLAUDE.md.

The CDN libraries the tools use (cdnjs, jsDelivr, cdn.sheetjs.com) aren't
trackers and aren't checked here.

Usage: python scripts/check_analytics.py [--root DIR]   (CI: check-analytics)
"""
import argparse
import hashlib
import re
import sys
from pathlib import Path

EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules", "prototypes", "audit", "claude"}
SNIPPET = '<script data-goatcounter="https://orisod.goatcounter.com/count" async src="/assets/goatcounter/count.js"></script>'
COUNT_JS = "assets/goatcounter/count.js"
COUNT_JS_SHA256 = "792b7abd26c1fb6ae62906833e09a301251e2641816e69e4f95aba518f3fe3f0"
GOOGLE_ANALYTICS = re.compile(r"gtag|googletagmanager|google-analytics\.com|dataLayer|\bG-[A-Z0-9]{8,}\b|\bUA-\d{4,}-\d+\b|google\s+analytics", re.I)
OTHER_TRACKERS = re.compile(
    r"plausible\.io|umami\.is|data-website-id=|matomo|piwik|usefathom\.com|simpleanalytics|scripts\.simpleanalyticscdn|"
    r"clarity\.ms|hotjar|cdn\.segment\.com|mixpanel|amplitude\.com|posthog|heapanalytics|connect\.facebook\.net|fbq\(|"
    r"snap\.licdn\.com|analytics\.tiktok\.com|mc\.yandex|static\.cloudflareinsights\.com|statcounter|withcabin\.com|pirsch\.io|"
    r"counter\.dev|quantserve|scorecardresearch|newrelic|nr-data\.net|gc\.zgo\.at", re.I)


def pages(root):
    for f in sorted(root.rglob("index.html")):
        rel = f.relative_to(root)
        if rel.parts[0] not in EXCLUDE_TOP_LEVEL:
            yield rel.as_posix()
    if (root / "404.html").exists():
        yield "404.html"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent), help="site folder to check")
    root = Path(ap.parse_args().root)
    sys.stdout.reconfigure(encoding="utf-8")
    problems = []
    count = 0
    for rel in pages(root):
        count += 1
        src = (root / rel).read_text(encoding="utf-8")
        head = src.split("</head>", 1)[0]
        n_page, n_head = src.count("data-goatcounter"), head.count(SNIPPET)
        if n_page != 1 or n_head != 1:
            problems.append(f"{rel}: needs exactly one GoatCounter snippet in <head>, written as {SNIPPET} "
                            f"(found {n_head} in <head>, {n_page} data-goatcounter in the page)")
        for m in GOOGLE_ANALYTICS.finditer(src):
            problems.append(f"{rel}: Google Analytics reference: {m.group(0)!r}")
        for m in OTHER_TRACKERS.finditer(src):
            problems.append(f"{rel}: analytics/tracking service other than GoatCounter: {m.group(0)!r}")

    js = root / COUNT_JS
    if not js.exists():
        problems.append(f"{COUNT_JS} is missing")
    elif hashlib.sha256(js.read_bytes()).hexdigest() != COUNT_JS_SHA256:
        problems.append(f"{COUNT_JS} differs from the reviewed copy (sha256 {COUNT_JS_SHA256}); "
                        "if you updated it on purpose, follow the update steps in CLAUDE.md and change COUNT_JS_SHA256")

    if problems:
        print(f"FAIL: {len(problems)} analytics problem(s):")
        for p in problems:
            print("  " + p)
        return 1
    print(f"OK: all {count} pages load GoatCounter exactly once with the right endpoint and no other analytics; "
          f"{COUNT_JS} is the reviewed copy.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
