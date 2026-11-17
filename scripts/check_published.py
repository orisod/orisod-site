#!/usr/bin/env python3
"""Check what GitHub Pages publishes: internal files stay out, every page is published unchanged.

CI (check-published) first builds the site with actions/jekyll-build-pages, the same builder GitHub Pages uses,
then runs this on the output folder:

    python3 scripts/check_published.py --site _site

It fails when:
  - _config.yml doesn't exclude one of REQUIRED_EXCLUDES;
  - the built site holds a file under an excluded path, or the page Jekyll renders from an excluded .md file;
  - the built site holds an internal file type (.md, .py, .mjs, .patch, .csv, .jsonl, .yml) outside assets/vendor;
  - the site root holds a file that isn't in ROOT_FILES or a page folder;
  - a tracked file that isn't excluded (or hidden by Jekyll: dot-paths, CNAME) is missing from the build or isn't
    byte-identical to its git blob, so a page that Jekyll would change fails too;
  - the build holds a file that is neither tracked nor in GENERATED;
  - a sitemap URL has no built page.

--root DIR checks another checkout (the tracked list and blobs come from `git ls-tree HEAD` there).
"""
import argparse
import hashlib
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parent.parent

# Internal files: in the repository, never on orisod.com. _config.yml must list each one.
REQUIRED_EXCLUDES = [
    "CLAUDE.md", "README.md", "LICENSE", "package.json", "package-lock.json",
    "audit", "scripts", "claude", "assets/js", "assets/icons/README.md",
]
# Files at the site root that belong to the site (besides page folders, which hold an index.html).
ROOT_FILES = {
    "index.html", "404.html", "sitemap.xml", "robots.txt", "site.webmanifest", "favicon.ico", "favicon.svg",
    "favicon-16x16.png", "favicon-32x32.png", "icon-192.png", "icon-512.png", "apple-touch-icon.png",
}
# Files the Pages build writes that aren't tracked: the theme stylesheet and the pages rendered from the vendored
# Markdown notices (kept on purpose: a license file must stay available next to its library).
GENERATED = {
    "assets/css/style.css",
    "assets/vendor/liberation-sans/2.1.5/index.html",
    "assets/vendor/tesseract/7.0.0/core/LICENSE-openlibm.html",
}
INTERNAL_TYPES = re.compile(r"\.(md|py|mjs|patch|csv|jsonl|ya?ml)$", re.I)


def config_excludes(root):
    """The exclude list of _config.yml (a plain YAML list; no YAML library needed)."""
    text = (root / "_config.yml").read_text(encoding="utf-8")
    m = re.search(r"^exclude:\s*\n((?:[ \t]+-[^\n]*\n?)+)", text, re.M)
    if not m:
        return []
    return [line.split("-", 1)[1].strip().strip("'\"") for line in m.group(1).splitlines() if line.strip()]


def under(path, prefix):
    return path == prefix or path.startswith(prefix.rstrip("/") + "/")


def tracked_blobs(root):
    out = subprocess.run(["git", "ls-tree", "-r", "HEAD"], cwd=root, capture_output=True, text=True, check=True).stdout
    return {line.split("\t", 1)[1]: line.split()[2] for line in out.splitlines()}


def blob_sha(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--site", required=True, help="the built site folder (Jekyll's output)")
    ap.add_argument("--root", default=str(REPO), help="the checkout the site was built from")
    args = ap.parse_args()
    root, site = Path(args.root).resolve(), Path(args.site).resolve()
    problems = []

    excludes = config_excludes(root)
    for req in REQUIRED_EXCLUDES:
        if req not in excludes:
            problems.append(f"_config.yml doesn't exclude {req}")

    built = sorted(str(p.relative_to(site)).replace("\\", "/") for p in site.rglob("*") if p.is_file())
    builtset = set(built)
    blobs = tracked_blobs(root)
    excluded = lambda p: any(under(p, e) for e in excludes) or any(under(p, e) for e in REQUIRED_EXCLUDES)
    hidden = lambda p: any(part.startswith((".", "_", "#", "~")) for part in p.split("/")) or p == "CNAME"

    for p in built:
        rendered_from = re.sub(r"\.html$", ".md", p)
        if excluded(p) or (p.endswith(".html") and rendered_from in blobs and excluded(rendered_from)):
            problems.append(f"published although excluded: {p}")
        elif INTERNAL_TYPES.search(p) and not under(p, "assets/vendor"):
            problems.append(f"internal file type published: {p}")
        if "/" not in p and p not in ROOT_FILES:
            problems.append(f"unexpected file at the site root: {p}")
        if p not in blobs and p not in GENERATED and not excluded(p):
            problems.append(f"built file that isn't tracked or expected: {p}")

    for p, sha in blobs.items():
        if excluded(p) or hidden(p):
            continue
        if p not in builtset:
            problems.append(f"tracked file missing from the build: {p}")
        elif blob_sha((site / p).read_bytes()) != sha:
            problems.append(f"changed by the build (not byte-identical to git): {p}")

    sitemap = (root / "sitemap.xml").read_text(encoding="utf-8")
    urls = re.findall(r"<loc>([^<]+)</loc>", sitemap)
    for u in urls:
        path = urlparse(u).path.lstrip("/")
        page = (path + "index.html") if (path == "" or path.endswith("/")) else path
        if page not in builtset:
            problems.append(f"sitemap URL without a built page: {u}")

    if problems:
        for msg in problems:
            print("FAIL " + msg)
        print(f"\n{len(problems)} problem(s).")
        return 1
    print(f"OK: {len(built)} built files; none of the {len(REQUIRED_EXCLUDES)} excluded paths is published; every "
          f"tracked site file is published byte-identical to git; all {len(urls)} sitemap URLs have a page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
