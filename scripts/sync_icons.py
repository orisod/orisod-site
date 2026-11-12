#!/usr/bin/env python3
"""Write the vendored Lucide icons into the page content that names them.

Orisod 2.0 draws its icons with Lucide (assets/vendor/lucide/<version>/icons/NAME.svg, the version
being the "lucide" entry of assets/vendor/manifest.json). The site menu gets them from
scripts/sync_nav.py; every other icon on a page is an inline <svg> that names its icon:

    <svg class="o-icon" data-lucide="lock"></svg>

This script rewrites each such element as the vendored drawing, with the same cleaning as the
nav (license comment, Lucide's own class, width and height dropped; aria-hidden="true" added),
keeping its class and data-lucide. So the page keeps working offline and with no extra request,
and the vendored file stays the one place an icon is drawn. An icon a script adds at runtime is
cloned from a <template> on the page that holds the same kind of <svg>.

    python scripts/sync_icons.py            # dry run (default): list the pages that would change
    python scripts/sync_icons.py --write    # rewrite them
    python scripts/sync_icons.py --check    # exit 1 if any icon differs from its vendored file
    python scripts/sync_icons.py --root DIR # work on a copy of the site

It fails on an icon name that isn't vendored, a vendored file that isn't a plain Lucide SVG, and an
<svg data-lucide> with attributes other than class and data-lucide (anything else would be lost
when it's rewritten). To add an icon: vendor it (manifest entry; check_vendor.py), write the empty
<svg> on the page, run --write. Pages with no data-lucide are never touched.
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sync_nav import ICON_LIBRARY, MANIFEST, inline_svg  # noqa: E402
from sync_styles import NOT_PAGES, read, write  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
# An icon element: its opening tag (with data-lucide) up to its </svg>. Icons never nest.
ICON = re.compile(r'<svg\b([^>]*\bdata-lucide="[^"]*"[^>]*)>(.*?)</svg>', re.S)
ATTR = re.compile(r'\s*([a-zA-Z:-]+)="([^"]*)"')
KEPT = ("class", "data-lucide")
# What a written icon carries besides those (and what this script writes back each time).
WRITTEN = ("xmlns", "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "aria-hidden")


def lucide_dir(root):
    libs = [x for x in json.loads(read(root / MANIFEST))["libraries"] if x["name"] == ICON_LIBRARY]
    if len(libs) != 1:
        raise SystemExit(f'{MANIFEST} has no single "{ICON_LIBRARY}" library')
    return root / f"assets/vendor/{ICON_LIBRARY}/{libs[0]['version']}/icons"


def drawing(folder, name, cache):
    """The cleaned inline SVG for an icon, or raises ValueError."""
    if name not in cache:
        path = folder / f"{name}.svg"
        if not re.fullmatch(r"[a-z0-9-]+", name) or not path.is_file():
            raise ValueError(f'names the icon "{name}", which isn\'t vendored in {folder.relative_to(folder.parents[4]).as_posix()}')
        try:
            cache[name] = inline_svg(read(path))
        except ValueError as e:
            raise ValueError(f"uses {name}.svg, which {e}")
    return cache[name]


def sync_text(text, folder, cache):
    """(new text, problems)."""
    problems = []

    def rewrite(m):
        attrs = ATTR.findall(m.group(1))
        names = [k for k, _ in attrs]
        rest = ATTR.sub("", m.group(1)).strip()
        if rest or len(set(names)) != len(names) or any(k not in KEPT + WRITTEN for k in names):
            problems.append(f"has an icon <svg{m.group(1)}> with attributes other than class and data-lucide "
                            "(and the ones this script writes)")
            return m.group(0)
        a = dict(attrs)
        try:
            svg = drawing(folder, a["data-lucide"], cache)
        except ValueError as e:
            problems.append(str(e))
            return m.group(0)
        head = (f'class="{a["class"]}" ' if a.get("class") else "") + f'data-lucide="{a["data-lucide"]}" '
        return svg.replace("<svg ", "<svg " + head, 1)

    return ICON.sub(rewrite, text), problems


def run(root, write_changes=False, check=False):
    folder, cache = lucide_dir(root), {}
    lines, problems, changed, using = [], [], [], 0
    for f in sorted(root.rglob("*.html")):
        rel = f.relative_to(root).as_posix()
        if rel.split("/")[0] in NOT_PAGES:
            continue
        text = read(f)
        if "data-lucide=" not in text:
            continue
        using += 1
        new, probs = sync_text(text, folder, cache)
        problems += [f"{rel}: {p}" for p in probs]
        if new != text and not probs:
            changed.append(rel)
            if write_changes:
                write(f, new)
    lines += [f"  {'synced' if write_changes else 'out of date'}: {rel}" for rel in changed]
    lines += [f"  - {p}" for p in problems]
    lines.append(f"{using} page(s) use Lucide icons in their content: {using - len(changed)} in sync, "
                 f"{len(changed)} {'rewritten' if write_changes else 'out of date'}; {len(problems)} problem(s)")
    if problems:
        return 1, lines
    if check and changed:
        lines.append("Run: python scripts/sync_icons.py --write")
        return 1, lines
    if not write_changes and not check:
        lines.append("Dry run: nothing written." + (" Run again with --write to apply." if changed else ""))
    return 0, lines


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="rewrite the icons that differ")
    mode.add_argument("--check", action="store_true", help="exit 1 if any icon differs or is broken")
    ap.add_argument("--root", default=str(REPO_ROOT), help="site root (default: this repo)")
    args = ap.parse_args()
    code, lines = run(Path(args.root), write_changes=args.write, check=args.check)
    print("\n".join(lines))
    return code


if __name__ == "__main__":
    sys.exit(main())
