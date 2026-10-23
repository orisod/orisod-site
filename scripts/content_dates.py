#!/usr/bin/env python3
"""Measure when each page's real content last changed, from git history, and
write those dates to sitemap.xml (<lastmod>) and to every blog post's
BlogPosting JSON-LD (datePublished / dateModified).

This is the one place the dates come from, so a post's sitemap <lastmod> always
equals its JSON-LD dateModified (check_sitemap.py fails CI otherwise).

How a page's dates are measured:
- Its content is the visible text from the page's H1 (the first <h1> inside
  <main>) up to the CTA box, the related cards, the footer or </main>,
  whichever comes first, with <script>/<style> removed and whitespace
  collapsed. The nav, breadcrumb, footer, JSON-LD, CSS, JS and markup-only
  edits (site-wide rollouts) don't change that text, so they don't count.
- dateModified / lastmod: the day of the newest commit whose content differs
  from the revision before it. If the working copy's content differs from the
  last commit (or the file isn't committed yet), it's today.
- datePublished: the day of the file's first commit (today if not committed yet).
- If the content can't be read in a revision the walk has to compare (no H1
  inside <main>, or no end marker), the date isn't measurable. The page then
  keeps its current dates; nothing is guessed. The run lists those pages.
Dates are commit author dates, YYYY-MM-DD.

Usage:
  python scripts/content_dates.py            # dry run: list what would change
  python scripts/content_dates.py --write    # update sitemap.xml and the posts' JSON-LD
Run it with --write when shipping a new tool or post, or after editing a page's
content, then commit the result with the page.
"""
import datetime
import html
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE_ORIGIN = "https://orisod.com/"
END = re.compile(r'<div class="cta-box"|<div class="related-section"|<footer|</main>')
LOC = re.compile(r"(<url><loc>([^<]+)</loc>)(?:<lastmod>([^<]*)</lastmod>)?")
BLOGPOSTING = re.compile(r'<script type="application/ld\+json">\s*\{\s*"@context": "https://schema.org",\s*"@type": "BlogPosting".*?</script>', re.S)


def article_text(src):
    """The page's content text (see the module docstring), or None if it can't be read."""
    src = re.sub(r"<(script|style)\b.*?</\1>", "", src, flags=re.S)
    m = re.search(r"<main\b", src)
    start = src.find("<h1", m.end() if m else 0)
    if start < 0:
        return None
    end = END.search(src, start)
    if not end:
        return None
    text = html.unescape(re.sub(r"<[^>]+>", " ", src[start:end.start()]))
    return re.sub(r"\s+", " ", text).strip() or None


class Git:
    def __init__(self, root):
        self.root = root
        self.cat = subprocess.Popen(["git", "-C", str(root), "cat-file", "--batch"],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def log(self, rel):
        out = subprocess.run(["git", "-C", str(self.root), "log", "--format=%H %as", "--", rel],
                             capture_output=True, encoding="utf-8").stdout
        return [line.split(" ", 1) for line in out.splitlines()]  # newest first

    def show(self, commit, rel):
        self.cat.stdin.write(f"{commit}:{rel}\n".encode())
        self.cat.stdin.flush()
        header = self.cat.stdout.readline().split()
        if len(header) < 3 or header[1] == b"missing":
            return None
        data = self.cat.stdout.read(int(header[2]))
        self.cat.stdout.read(1)
        return data.decode("utf-8", errors="replace")


def content_dates(git, rel, today):
    """(datePublished, dateModified) for a repo-relative path; dateModified is None if not measurable."""
    log = git.log(rel)
    if not log:
        return today, today
    published = log[-1][1]
    current = article_text((git.root / rel).read_text(encoding="utf-8"))
    texts = [article_text(git.show(h, rel) or "") for h, _ in log]
    if current is None or texts[0] is None:
        return published, None
    if current != texts[0]:
        return published, today
    for i in range(len(log) - 1):
        if texts[i + 1] is None:
            return published, None
        if texts[i] != texts[i + 1]:
            modified = log[i][1]
            break
    else:
        modified = published
    if not (published <= modified <= today):
        return published, None
    return published, modified


def page_path(loc):
    rel = loc[len(SITE_ORIGIN):]
    return (rel + "index.html") if rel else "index.html"


def set_post_dates(src, published, modified):
    """Return src with the BlogPosting's datePublished/dateModified set (dateModified only if measured)."""
    m = BLOGPOSTING.search(src)
    if not m:
        return src
    block = m.group(0)
    new = re.sub(r'("datePublished": )"[^"]*"', rf'\1"{published}"', block, count=1)
    if modified:
        if '"dateModified"' in new:
            new = re.sub(r'("dateModified": )"[^"]*"', rf'\1"{modified}"', new, count=1)
        else:
            new = re.sub(r'(\n(\s*)"datePublished": "[^"]*",)', rf'\1\n\2"dateModified": "{modified}",', new, count=1)
    return src[:m.start()] + new + src[m.end():]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    write = "--write" in sys.argv[1:]
    today = datetime.date.today().isoformat()
    git = Git(REPO_ROOT)
    sitemap_path = REPO_ROOT / "sitemap.xml"
    sitemap = sitemap_path.read_text(encoding="utf-8")
    changes, unmeasured, post_changes, kept = [], [], [], 0

    def fix(m):
        nonlocal kept
        head, loc, old = m.group(1), m.group(2), m.group(3)
        rel = page_path(loc)
        if not (REPO_ROOT / rel).exists():
            return m.group(0)
        published, modified = content_dates(git, rel, today)
        if re.fullmatch(r"(es/)?blog/[^/]+/index\.html", rel):
            src = (REPO_ROOT / rel).read_text(encoding="utf-8")
            updated = set_post_dates(src, published, modified)
            if updated != src:
                post_changes.append(rel)
                if write:
                    (REPO_ROOT / rel).write_text(updated, encoding="utf-8", newline="")
        if modified is None:
            unmeasured.append(f"{loc} (kept {old or 'no lastmod'})")
            return m.group(0)
        if modified == old:
            kept += 1
            return m.group(0)
        changes.append((loc, old, modified))
        return f"{head}<lastmod>{modified}</lastmod>"

    new_sitemap = LOC.sub(fix, sitemap)
    if write and new_sitemap != sitemap:
        sitemap_path.write_text(new_sitemap, encoding="utf-8", newline="")

    verb = "Updated" if write else "Would update"
    print(f"{verb} {len(changes)} sitemap lastmod value(s); {kept} already correct; {len(unmeasured)} not measurable (kept as is).")
    for loc, old, new in changes:
        print(f"  {loc}: {old} -> {new}")
    for line in unmeasured:
        print(f"  not measurable: {line}")
    print(f"{verb} the JSON-LD dates of {len(post_changes)} blog post(s).")
    for rel in post_changes:
        print(f"  {rel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
