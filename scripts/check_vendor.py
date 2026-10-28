#!/usr/bin/env python3
"""Fail if a page depends on an outside script host, or a self-hosted library isn't the reviewed copy.

The tools' libraries are moving from the CDNs (cdnjs, jsDelivr, cdn.sheetjs.com)
to self-hosted copies in assets/vendor/<name>/<version>/, so no page needs a
third-party server to work. Each vendored file is byte-identical to its source,
and assets/vendor/manifest.json records its source URL, sha256, size and license.
See "Self-hosted libraries" in CLAUDE.md for how to add or update one.

Rules, for every page (every .html outside the folders below, including 404.html):
- no <script src> on another host (https://..., or //host/...), unless the exact
  URL is in REMAINING_CDN
- no <link> stylesheet, preload, preconnect, icon or other resource on another
  host (only rel="canonical" and rel="alternate" may point elsewhere), and no
  @import or url(http...) in an inline <style>
- no CDN host (CDN_HOSTS) in any inline <script> (JSON-LD aside) or in the site's
  own JS files (assets/**/*.js outside assets/vendor), and no absolute outside URL
  given to workerSrc, workerPath, corePath, langPath, importScripts(), fetch(),
  import() or new Worker(), unless the exact URL is in REMAINING_CDN
- a page that starts Tesseract must give it workerPath, corePath and langPath, or
  Tesseract downloads its worker, engine and language data from jsDelivr by
  itself (pages in TESSERACT_DEFAULTS are still allowed to)
- a page that loads the vendored PDF.js (/assets/vendor/pdfjs/<version>/pdf.min.js)
  must set pdfjsLib.GlobalWorkerOptions.workerSrc to the worker in the same folder,
  or PDF.js guesses the worker's address from its own; and any workerSrc that
  isn't an outside URL (those are covered above) must be a file in the manifest
- every /assets/vendor/ script a page loads is a file listed in the manifest, and
  no vendor script is in <head> (libraries load after the content, before the
  tool's own script)
- an English page and its /es/ twin load the same vendor and CDN scripts, in the
  same order
And for assets/vendor:
- the manifest is valid and complete: name, version, SPDX license, files and a
  license file for every library, each path inside assets/vendor/<name>/<version>/,
  each source an https URL
- every file's sha256 and size match the manifest, every file on disk is in the
  manifest (and nothing in the manifest is missing), and every library has its
  LICENSE file
- .gitattributes keeps assets/vendor byte-for-byte (assets/vendor/** -text)

Links (<a href>), the GoatCounter endpoint (data-goatcounter) and the Stripe
donation links on /support aren't resources the page loads, so they're allowed.
Files inside assets/vendor are exempt from the CDN rules: Tesseract, for one,
carries its own default jsDelivr addresses, which the pages override instead.

REMAINING_CDN lists every CDN URL still in use, with exactly how many times it
appears on the site. More than that fails (a new CDN dependency); fewer also
fails, with a reminder to lower or remove the entry, so the list shrinks with
each library that moves and ends empty.

Usage: python scripts/check_vendor.py [--root DIR]   (CI: check-vendor)
       python scripts/check_vendor.py --allowlist    (print REMAINING_CDN as JSON, for test_vendor_smoke.js)
"""
import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules", "prototypes", "audit", "claude"}
VENDOR = "assets/vendor"
MANIFEST = f"{VENDOR}/manifest.json"
GITATTRIBUTES_RULE = "assets/vendor/** -text"

# Every CDN URL still in use, and how many times it appears (script tags plus
# strings in inline scripts). Shrinks as each library moves to assets/vendor.
REMAINING_CDN = {
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js": 16,
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js": 2,
    "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js": 4,
    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js": 10,
    "https://cdn.jsdelivr.net/npm/docx@9.7.1/dist/index.iife.js": 2,
    "https://cdn.jsdelivr.net/npm/mammoth@1.12.1/mammoth.browser.min.js": 2,
    "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js": 2,
    "https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js": 2,
    "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/7.0.0/tesseract.min.js": 2,
}
# Pages still letting Tesseract fetch its worker, engine and language data from jsDelivr.
TESSERACT_DEFAULTS = {"ocr-pdf/index.html", "es/ocr-pdf/index.html"}

CDN_HOSTS = re.compile(
    r"(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fastly\.jsdelivr\.net|cdn\.sheetjs\.com|unpkg\.com|esm\.sh|"
    r"cdn\.skypack\.dev|ajax\.googleapis\.com|code\.jquery\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|"
    r"stackpath\.bootstrapcdn\.com|maxcdn\.bootstrapcdn\.com|cdn\.rawgit\.com|rawcdn\.githack\.com|"
    r"raw\.githubusercontent\.com|tessdata\.projectnaptha\.com)", re.I)
URL = re.compile(r"(?:https?:)?//[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s\"'`<>)\\]*")
SCRIPT = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S | re.I)
SRC = re.compile(r"""\bsrc\s*=\s*["']([^"']+)["']""", re.I)
LINK = re.compile(r"<link\b[^>]*>", re.I)
STYLE = re.compile(r"<style\b[^>]*>(.*?)</style>", re.S | re.I)
STYLE_EXTERNAL = re.compile(r"@import|url\(\s*[\"']?(?:https?:)?//", re.I)
LOADER = re.compile(
    r"""(?:\b(?:workerSrc|workerPath|corePath|langPath)\s*[:=]\s*|\b(?:importScripts|fetch|import)\s*\(\s*|"""
    r"""\bnew\s+Worker\s*\(\s*)["'`]((?:https?:)?//[^"'`]+)""")
WORKER_SRC = re.compile(r"""\bworkerSrc\s*[:=]\s*["'`]([^"'`]*)["'`]""")
PDFJS_SCRIPT = re.compile(r"^/assets/vendor/pdfjs/([^/]+)/pdf\.min\.js$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SPDX = re.compile(r"^[A-Za-z0-9.+-]+(?: (?:OR|AND|WITH) [A-Za-z0-9.+-]+)*$")


def external(url):
    return url.startswith(("http://", "https://", "//"))


def pages(root):
    for f in sorted(root.rglob("*.html")):
        rel = f.relative_to(root)
        if rel.parts[0] not in EXCLUDE_TOP_LEVEL:
            yield rel.as_posix()


def check_manifest(root, problems):
    """Check assets/vendor against the manifest; return the set of listed library files."""
    listed, scripts = Counter(), set()
    try:
        manifest = json.loads((root / MANIFEST).read_text(encoding="utf-8"))
        libs = manifest["libraries"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        problems.append(f"{MANIFEST}: can't read the manifest ({e})")
        return scripts
    for i, lib in enumerate(libs):
        name, version = lib.get("name"), lib.get("version")
        where = f"{MANIFEST}: library {name or i}@{version}"
        if not name or not version or not re.fullmatch(r"[A-Za-z0-9._-]+", f"{name}{version}"):
            problems.append(f"{where}: needs a plain name and version")
            continue
        if not SPDX.match(str(lib.get("license", ""))):
            problems.append(f"{where}: needs an SPDX license identifier (e.g. MIT, Apache-2.0)")
        folder = f"{VENDOR}/{name}/{version}/"
        entries = [(e, False) for e in lib.get("files") or []]
        if not entries:
            problems.append(f"{where}: lists no files")
        if not isinstance(lib.get("license_file"), dict):
            problems.append(f"{where}: needs a license_file (the library's LICENSE, shipped next to it)")
        else:
            entries.append((lib["license_file"], True))
        for entry, is_license in entries:
            path = str(entry.get("path", ""))
            listed[path] += 1
            if not path.startswith(folder) or ".." in path:
                problems.append(f"{where}: {path or '(no path)'} must be inside {folder}")
                continue
            if not str(entry.get("source", "")).startswith("https://"):
                problems.append(f"{where}: {path} needs its https source URL")
            if not SHA256.match(str(entry.get("sha256", ""))) or not isinstance(entry.get("bytes"), int):
                problems.append(f"{where}: {path} needs its sha256 (64 lowercase hex) and bytes")
            f = root / path
            if not f.is_file():
                problems.append(f"{where}: {path} is in the manifest but missing" + (" (every library needs its LICENSE)" if is_license else ""))
                continue
            data = f.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            if digest != entry.get("sha256") or len(data) != entry.get("bytes"):
                problems.append(f"{where}: {path} isn't the reviewed copy (sha256 {digest}, {len(data)} bytes; "
                                f"manifest says {entry.get('sha256')}, {entry.get('bytes')} bytes)")
            if not is_license:
                scripts.add("/" + path)
    on_disk = {p.relative_to(root).as_posix() for p in (root / VENDOR).rglob("*") if p.is_file()} - {MANIFEST}
    for path in sorted(on_disk - set(listed)):
        problems.append(f"{path}: file in {VENDOR} that isn't in the manifest")
    for path, n in sorted(listed.items()):
        if n > 1:
            problems.append(f"{MANIFEST}: {path} is listed {n} times")
    attrs = root / ".gitattributes"
    if GITATTRIBUTES_RULE not in (attrs.read_text(encoding="utf-8").splitlines() if attrs.is_file() else []):
        problems.append(f".gitattributes: needs the line '{GITATTRIBUTES_RULE}' so line endings never change a vendored file")
    return scripts


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent), help="site folder to check")
    ap.add_argument("--allowlist", action="store_true", help="print the remaining CDN URLs as JSON and exit")
    args = ap.parse_args()
    if args.allowlist:
        print(json.dumps(REMAINING_CDN, indent=2))
        return 0
    root = Path(args.root)
    sys.stdout.reconfigure(encoding="utf-8")
    problems = []
    vendor_scripts = check_manifest(root, problems)

    cdn_uses = Counter()
    loads = {}  # page -> list of vendor/CDN script srcs, in order
    worker_srcs = {}  # page -> every workerSrc string its inline scripts set
    vendor_refs = 0
    for rel in pages(root):
        text = (root / rel).read_text(encoding="utf-8")
        head_end = text.find("</head>")
        loads[rel] = []
        worker_srcs[rel] = []
        for m in SCRIPT.finditer(text):
            attrs, body = m.group(1), m.group(2)
            src = SRC.search(attrs)
            if src:
                url = src.group(1)
                if url.startswith("/assets/vendor/"):
                    vendor_refs += 1
                    loads[rel].append(url)
                    if url not in vendor_scripts:
                        problems.append(f"{rel}: loads {url}, which isn't a library file in {MANIFEST}")
                    if 0 <= m.start() < head_end:
                        problems.append(f"{rel}: {url} is in <head>; load it right before the tool's own script instead")
                elif external(url):
                    loads[rel].append(url)
                    if url in REMAINING_CDN:
                        cdn_uses[url] += 1
                    else:
                        problems.append(f"{rel}: <script src=\"{url}\"> loads a script from another host; self-host it in {VENDOR}")
            if "application/ld+json" in attrs.lower() or not body.strip():
                continue
            seen = set()
            for lm in LOADER.finditer(body):
                url = lm.group(1)
                seen.add(lm.start(1))
                if url in REMAINING_CDN:
                    cdn_uses[url] += 1
                else:
                    problems.append(f"{rel}: inline script loads {url} from another host; point it at {VENDOR}")
            for um in URL.finditer(body):
                if um.start() in seen or not CDN_HOSTS.search(um.group(0)):
                    continue
                url = um.group(0)
                if url in REMAINING_CDN:
                    cdn_uses[url] += 1
                else:
                    problems.append(f"{rel}: inline script refers to the CDN address {url}; self-host it in {VENDOR}")
            if "Tesseract.createWorker(" in body and rel not in TESSERACT_DEFAULTS:
                missing = [k for k in ("workerPath", "corePath", "langPath") if k not in body]
                if missing:
                    problems.append(f"{rel}: Tesseract.createWorker() needs {', '.join(missing)} pointing at {VENDOR}, "
                                    f"or Tesseract downloads them from jsDelivr")
            for wm in WORKER_SRC.finditer(body):
                worker = wm.group(1)
                worker_srcs[rel].append(worker)
                if not external(worker) and worker not in vendor_scripts:
                    problems.append(f"{rel}: workerSrc is {worker or '(empty)'}, which isn't a library file in {MANIFEST}")
        for url in loads[rel]:
            pm = PDFJS_SCRIPT.match(url)
            want = f"/assets/vendor/pdfjs/{pm.group(1)}/pdf.worker.min.js" if pm else None
            if want and want not in worker_srcs[rel]:
                problems.append(f"{rel}: loads {url} but doesn't set pdfjsLib.GlobalWorkerOptions.workerSrc = \"{want}\"; "
                                f"without it PDF.js guesses the worker's address from its own")
        for lm in LINK.finditer(text):
            tag = lm.group(0)
            href = re.search(r"""\bhref\s*=\s*["']([^"']+)["']""", tag, re.I)
            rel_attr = re.search(r"""\brel\s*=\s*["']([^"']+)["']""", tag, re.I)
            kinds = set((rel_attr.group(1) if rel_attr else "").lower().split())
            if href and external(href.group(1)) and not kinds <= {"canonical", "alternate"}:
                problems.append(f"{rel}: <link rel=\"{' '.join(sorted(kinds))}\"> loads {href.group(1)} from another host")
        for sm in STYLE.finditer(text):
            if STYLE_EXTERNAL.search(sm.group(1)):
                problems.append(f"{rel}: an inline <style> imports or loads something from another host")

    for f in sorted((root / "assets").rglob("*.js")):
        rel = f.relative_to(root).as_posix()
        if rel.startswith(VENDOR + "/"):
            continue
        for um in URL.finditer(f.read_text(encoding="utf-8")):
            if CDN_HOSTS.search(um.group(0)):
                problems.append(f"{rel}: refers to the CDN address {um.group(0)}")

    for url, allowed in REMAINING_CDN.items():
        used = cdn_uses[url]
        if used > allowed:
            problems.append(f"{url} appears {used} times, but REMAINING_CDN allows {allowed}: a new page depends on a CDN; "
                            f"self-host the library instead")
        elif used < allowed:
            problems.append(f"{url} appears {used} times, not {allowed}: lower its REMAINING_CDN entry in "
                            f"scripts/check_vendor.py" + (" (remove it)" if used == 0 else ""))
    for rel in sorted(TESSERACT_DEFAULTS):
        text = (root / rel).read_text(encoding="utf-8") if (root / rel).is_file() else ""
        if "Tesseract.createWorker(" not in text or all(k in text for k in ("workerPath", "corePath", "langPath")):
            problems.append(f"{rel}: no longer uses Tesseract's jsDelivr defaults; remove it from TESSERACT_DEFAULTS")

    for rel, srcs in loads.items():
        if rel.startswith("es/") and rel[3:] in loads and loads[rel[3:]] != srcs:
            problems.append(f"{rel}: loads {srcs}, but {rel[3:]} loads {loads[rel[3:]]}; EN and ES must load the same libraries")

    if problems:
        print("Vendor problems found:")
        for p in problems:
            print(f"  - {p}")
        print(f"\n{len(problems)} problem(s)")
        return 1
    print(f"OK: {len(loads)} pages checked. {vendor_refs} script tags load {len(vendor_scripts)} self-hosted files, "
          f"all matching {MANIFEST}. {sum(cdn_uses.values())} CDN references remain, all in REMAINING_CDN "
          f"({len(REMAINING_CDN)} URLs).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
