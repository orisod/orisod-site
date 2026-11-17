#!/usr/bin/env python3
"""Prove scripts/check_published.py passes a clean site and fails each way a published site can go wrong.

Builds a tiny git repository and a fake built site in a temporary folder (tempfile, so TMP/TMPDIR decide where),
breaks the site one way at a time and runs the checker with --root and --site. Run: python3 scripts/test_check_published.py
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CHECKER = Path(__file__).resolve().parent / "check_published.py"
CONFIG = "exclude:\n" + "".join(f"  - {p}\n" for p in [
    "CLAUDE.md", "README.md", "LICENSE", "package.json", "package-lock.json",
    "audit", "scripts", "claude", "assets/js", "assets/icons/README.md"])
TRACKED = {
    "_config.yml": CONFIG,
    "index.html": "<!doctype html><title>Home</title>",
    "404.html": "<!doctype html><title>404</title>",
    "robots.txt": "User-agent: *\nAllow: /\n",
    "sitemap.xml": "<urlset><url><loc>https://orisod.com/</loc></url><url><loc>https://orisod.com/tool/</loc></url></urlset>\n",
    "tool/index.html": "<!doctype html><title>Tool</title>",
    "assets/vendor/lib/1.0/README.md": "license notes\n",
    "assets/js/source.js": "// source of an inline block\n",
    "CLAUDE.md": "internal\n",
    "scripts/check.py": "print('x')\n",
    "audit/notes.md": "internal\n",
    ".github/workflows/ci.yml": "on: push\n",
    "CNAME": "orisod.com\n",
}
# What the Pages build of TRACKED should publish.
CLEAN_SITE = ["index.html", "404.html", "robots.txt", "sitemap.xml", "tool/index.html", "assets/vendor/lib/1.0/README.md"]


def write(base, rel, text):
    p = base / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(text.encode("utf-8"))


def run(root, site):
    r = subprocess.run([sys.executable, str(CHECKER), "--root", str(root), "--site", str(site)], capture_output=True, text=True)
    return r.returncode, r.stdout


def main():
    with tempfile.TemporaryDirectory(prefix="check_published_") as tmp:
        tmp = Path(tmp)
        root = tmp / "repo"
        for rel, text in TRACKED.items():
            write(root, rel, text)
        git = lambda *a: subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *a],
                                        cwd=root, check=True, capture_output=True)
        git("init", "-q")
        git("add", "-A")
        git("commit", "-q", "-m", "fixture")

        def site_with(change=None):
            site = tmp / "site"
            shutil.rmtree(site, ignore_errors=True)
            for rel in CLEAN_SITE:
                write(site, rel, TRACKED[rel])
            if change:
                change(site)
            return site

        cases = [
            ("clean site", None, 0, "OK:"),
            ("CNAME copied by the builder", lambda s: write(s, "CNAME", "orisod.com\n"), 0, "OK:"),
            ("_config.yml without an exclude", "config", 1, "_config.yml doesn't exclude scripts"),
            ("CLAUDE.md published", lambda s: write(s, "CLAUDE.md", "internal\n"), 1, "published although excluded: CLAUDE.md"),
            ("page rendered from an excluded .md", lambda s: write(s, "audit/notes.html", "<p>x</p>"), 1, "published although excluded: audit/notes.html"),
            ("a script published", lambda s: write(s, "scripts/check.py", "print('x')\n"), 1, "published although excluded: scripts/check.py"),
            ("inline block source published", lambda s: write(s, "assets/js/source.js", "// source of an inline block\n"), 1, "published although excluded: assets/js/source.js"),
            ("new file at the root", lambda s: write(s, "NOTES.txt", "x\n"), 1, "unexpected file at the site root: NOTES.txt"),
            ("internal file type in a folder", lambda s: write(s, "tool/plan.md", "x\n"), 1, "internal file type published: tool/plan.md"),
            ("untracked file in a folder", lambda s: write(s, "tool/extra.js", "x\n"), 1, "built file that isn't tracked or expected: tool/extra.js"),
            ("page changed by the build", lambda s: write(s, "tool/index.html", "<!doctype html><title>Changed</title>"), 1, "changed by the build (not byte-identical to git): tool/index.html"),
            ("page missing", lambda s: (s / "tool/index.html").unlink(), 1, "tracked file missing from the build: tool/index.html"),
            ("sitemap URL without a page", lambda s: (s / "tool/index.html").unlink(), 1, "sitemap URL without a built page: https://orisod.com/tool/"),
        ]
        failures = 0
        for name, change, want_code, want_text in cases:
            if change == "config":
                write(root, "_config.yml", CONFIG.replace("  - scripts\n", ""))
                git("commit", "-q", "-a", "-m", "drop", "--allow-empty")
                code, out = run(root, site_with())
                write(root, "_config.yml", CONFIG)
                git("commit", "-q", "-a", "-m", "restore", "--allow-empty")
            else:
                code, out = run(root, site_with(change))
            ok = code == want_code and want_text in out
            failures += not ok
            print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" (exit {code}):\n{out}"))
        if failures:
            print(f"\n{failures} case(s) failed.")
            return 1
        print(f"\nAll {len(cases)} check_published.py cases behaved as expected.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
