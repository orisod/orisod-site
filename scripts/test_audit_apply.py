#!/usr/bin/env python3
"""Local tests for audit_apply.py's safety checks (not in CI).

    python scripts/test_audit_apply.py

Runs check_replacement() on small made-up blocks and prints PASS/FAIL for each
case. Exits 1 if any case fails.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_apply import check_replacement  # noqa: E402
from audit_extract import protected  # noqa: E402

SOURCE = '<p>Orisod runs every tool in your browser. See the <a class="inline" href="/about/">About page</a>.</p>'

CASES = [
    # (name, replacement, expected: None = accepted, or a substring of the rejection reason)
    ("brand kept as Orisod", '<p>Orisod runs each tool in your browser. See the <a class="inline" href="/about/">About page</a>.</p>', None),
    ("brand becomes the domain orisod.com", '<p>orisod.com runs every tool in your browser. See the <a class="inline" href="/about/">About page</a>.</p>', None),
    ("brand lowercased to orisod", '<p>orisod runs every tool in your browser. See the <a class="inline" href="/about/">About page</a>.</p>', "drops protected term(s): Orisod"),
    ("brand dropped", '<p>This site runs every tool in your browser. See the <a class="inline" href="/about/">About page</a>.</p>', "drops protected term(s): Orisod"),
    ("domain inside a longer word does not count", '<p>notorisod.com runs every tool in your browser. See the <a class="inline" href="/about/">About page</a>.</p>', "drops protected term(s): Orisod"),
]


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    live = {"field_type": "paragraph", "source_html": SOURCE, "protected_tokens": protected(SOURCE)}
    failed = 0
    for name, new, expected in CASES:
        reason = check_replacement(live, new)
        ok = reason is None if expected is None else (reason is not None and expected in reason)
        failed += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: {'accepted' if reason is None else 'rejected (' + reason + ')'}")
    print("All audit_apply checks passed." if not failed else f"{failed} case(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
