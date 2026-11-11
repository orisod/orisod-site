#!/usr/bin/env python3
"""Fail if any page's copy of the shared stylesheet differs from assets/css/orisod.css.

Orisod 2.0 keeps its shared styles in one source file, assets/css/orisod.css, and
copies it into a marked region of each adopting page's inline <style> (see
scripts/sync_styles.py for the markers). This check (CI: check-styles) fails on:

- a page whose region isn't a copy of the source (line endings aside): someone edited
  the source without running `python scripts/sync_styles.py --write`, or edited the
  copy on the page instead of the source
- a page with broken markers: only one of them, more than one of either, the end
  before the start, or a region outside a single <style> element
- a source that contains a marker or a </style> tag

A page without the markers isn't checked: adopting the region is page by page
(`python scripts/sync_styles.py --write --add PAGE`).

    python scripts/check_styles.py [--root DIR]
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sync_styles import REPO_ROOT, run  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=str(REPO_ROOT), help="site root (default: this repo)")
    args = ap.parse_args()
    code, lines = run(Path(args.root), check=True)
    if code:
        print("Shared stylesheet problems found:")
        print("\n".join(lines))
        return 1
    print("OK: " + lines[-1])
    return 0


if __name__ == "__main__":
    sys.exit(main())
