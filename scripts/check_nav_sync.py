#!/usr/bin/env python3
"""Fail if any page's generated site menu differs from its source.

Orisod 2.0 generates the nav (menu, search box, category flyouts and their script)
from one source, assets/nav/ plus the /tools cards, and copies it into three marked
regions of each adopting page (see scripts/sync_nav.py for the markers). This check
(CI: check-nav-sync) fails on:

- a region that isn't what sync_nav.py would write (line endings aside): the source
  changed without `python scripts/sync_nav.py --write`, a tool was added to or renamed
  on /tools without it (so a menu's flyout list is stale), or someone edited a page's
  copy instead of the source
- broken regions: a marker missing or repeated, the end before the start, only some
  of the three regions, the CSS region outside a single <style>, the header or script
  region inside a <style> or <script>, or the script region above the header
- a homepage or /tools page whose search icon targets a box that isn't on the page
- a source that would break pages: </style> in the CSS, </script> or <!-- in the
  script, a marker in either, a template section missing, or strings.json without
  the same keys in both languages
- a generated menu on 404.html (not supported yet)

Pages without the regions aren't checked here (check_nav.py counts them until the
rollout is complete).

    python scripts/check_nav_sync.py [--root DIR]
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sync_nav import REPO_ROOT, run  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=str(REPO_ROOT), help="site root (default: this repo)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    code, lines = run(Path(args.root), check=True)
    if code:
        print("Site menu problems found:")
        print("\n".join(lines))
        return 1
    print("OK: " + lines[-1])
    return 0


if __name__ == "__main__":
    sys.exit(main())
