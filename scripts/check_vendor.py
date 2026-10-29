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
- no address on another host in any inline <script> (JSON-LD aside) or in the
  site's own JS files (assets/**/*.js outside assets/vendor): not a CDN (CDN_HOSTS),
  not an absolute URL given to workerSrc, workerPath, corePath, langPath,
  importScripts(), fetch(), import() or new Worker(), and no other outside URL
  either, except the few in NOT_LOADED that nothing loads (an XML namespace, a
  link the visitor can click, a comment in GoatCounter's count.js)
- a page that starts Tesseract must load the vendored tesseract.min.js and give
  Tesseract.createWorker() workerPath, corePath and langPath, each once, as a full
  same-origin URL (`${location.origin}/assets/vendor/tesseract/<version>/...`,
  because its worker starts from a blob: address): workerPath the worker.min.js
  next to that tesseract.min.js, corePath a folder there holding the three LSTM
  core builds, and langPath a folder there holding <lang>.traineddata.gz for the
  page's language, all files in the manifest. Without them, Tesseract downloads
  its worker, engine and language data from jsDelivr by itself
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
  each source an https URL (only a notice file may instead be marked
  "written_by": "Orisod", for a notice Orisod wrote; never a script)
- every file's sha256 and size match the manifest, every file on disk is in the
  manifest (and nothing in the manifest is missing), and every library has its
  LICENSE file (plus any notice_files, e.g. the licenses of code it bundles)
- .gitattributes keeps assets/vendor byte-for-byte (assets/vendor/** -text)

Links (<a href>), the GoatCounter endpoint (data-goatcounter) and the Stripe
donation links on /support aren't resources the page loads, so they're allowed.
Files inside assets/vendor are exempt from these address rules: Tesseract, for
one, carries its own default jsDelivr addresses, which the OCR pages override.

REMAINING_CDN listed every CDN URL still in use while the libraries moved, with
exactly how many times it appeared; it shrank with each library and has been
empty since Tesseract moved (2026-10-28), so any CDN address now fails.

Usage: python scripts/check_vendor.py [--root DIR]   (CI: check-vendor)
       python scripts/check_vendor.py --allowlist    (print REMAINING_CDN as JSON, for test_vendor_smoke.js)
"""
import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from fnmatch import fnmatch
from pathlib import Path

EXCLUDE_TOP_LEVEL = {".git", ".github", ".claude", "assets", "docs", "scripts", "node_modules", "prototypes", "audit", "claude"}
VENDOR = "assets/vendor"
MANIFEST = f"{VENDOR}/manifest.json"
GITATTRIBUTES_RULE = "assets/vendor/** -text"

# Every CDN URL still in use, and how many times it appears (script tags plus
# strings in inline scripts). Empty since every library moved to assets/vendor:
# don't add an entry, self-host the library instead.
REMAINING_CDN = {}

# Outside addresses an inline script or the site's own JS may mention, because
# nothing loads them: (file pattern, URL prefix). Anything else on another host fails.
NOT_LOADED = (
    ("*", "http://www.w3.org/"),  # XML namespace names (SVG's), which browsers never fetch
    ("image-metadata-viewer/index.html", "https://www.google.com/maps?q="),  # the "Open in Google Maps" link
    ("es/image-metadata-viewer/index.html", "https://www.google.com/maps?q="),
    ("assets/goatcounter/count.js", "https://www.goatcounter.com"),  # comments in the pinned count.js
    ("assets/goatcounter/count.js", "https://opensource.org/licenses/ISC"),
    ("assets/goatcounter/count.js", "https://github.com/arp242/goatcounter"),
)
SITE_HOSTS = {"orisod.com", "www.orisod.com"}

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
TESSERACT_SCRIPT = re.compile(r"^(/assets/vendor/tesseract/[^/]+)/tesseract\.min\.js$")
TESSERACT_KEYS = ("workerPath", "corePath", "langPath")
TESSERACT_KEY = re.compile(r"\b(workerPath|corePath|langPath)\s*:")
TESSERACT_PATH = re.compile(r"\b(workerPath|corePath|langPath)\s*:\s*`\$\{location\.origin\}(/assets/vendor/[^`$]*)`")
TESSERACT_LANG = re.compile(r"""Tesseract\.createWorker\(\s*(?:["'](\w+(?:\+\w+)*)["']|(\w+))""")
TESSERACT_CORE_BUILDS = ("relaxedsimd-lstm", "simd-lstm", "lstm")  # the LSTM-only builds its worker picks from
SHA256 = re.compile(r"^[0-9a-f]{64}$")
WRITTEN_BY_NOT_ALLOWED = re.compile(r"\.(?:m?js|cjs|wasm|html?|css|json)$", re.I)
SPDX = re.compile(r"^[A-Za-z0-9.+-]+(?: (?:OR|AND|WITH) [A-Za-z0-9.+-]+)*$")


def external(url):
    return url.startswith(("http://", "https://", "//"))


def on_other_host(url):
    host = re.split(r"[/?#:]", re.sub(r"^(?:https?:)?//", "", url), maxsplit=1)[0].lower()
    return host not in SITE_HOSTS


def not_loaded(rel, url):
    return any(fnmatch(rel, where) and url.startswith(prefix) for where, prefix in NOT_LOADED)


def check_tesseract(rel, body, loads, vendor_files, problems):
    """A page that starts Tesseract must point its worker, engine and language data at its vendored copy."""
    folders = [m.group(1) for m in (TESSERACT_SCRIPT.match(u) for u in loads) if m]
    if len(folders) != 1:
        problems.append(f"{rel}: starts Tesseract but doesn't load one /assets/vendor/tesseract/<version>/tesseract.min.js")
        return
    folder = folders[0]
    paths = {}
    for m in TESSERACT_PATH.finditer(body):
        paths.setdefault(m.group(1), []).append(m.group(2).rstrip("/"))
    named = Counter(m.group(1) for m in TESSERACT_KEY.finditer(body))
    for key in TESSERACT_KEYS:
        if named[key] != 1 or len(paths.get(key, [])) != 1:
            problems.append(f"{rel}: Tesseract.createWorker() must set {key} once, to `${{location.origin}}{folder}/...` "
                            f"(a full URL on this site, since its worker starts from a blob: address); "
                            f"otherwise Tesseract downloads it from jsDelivr")
    if any(len(paths.get(key, [])) != 1 for key in TESSERACT_KEYS):
        return
    worker, core, lang = (paths[key][0] for key in TESSERACT_KEYS)
    if worker != f"{folder}/worker.min.js" or worker not in vendor_files:
        problems.append(f"{rel}: workerPath is {worker}, not {folder}/worker.min.js from {MANIFEST}")
    for build in TESSERACT_CORE_BUILDS:
        want = f"{core}/tesseract-core-{build}.wasm.js"
        if not core.startswith(folder + "/") or want not in vendor_files:
            problems.append(f"{rel}: corePath is {core}, which doesn't hold {want.rsplit('/', 1)[1]} next to {folder}/tesseract.min.js in {MANIFEST}")
    m = TESSERACT_LANG.search(body)
    codes = m and m.group(1)
    if m and not codes:
        const = re.search(rf"""\b(?:const|let|var)\s+{re.escape(m.group(2))}\s*=\s*["'](\w+(?:\+\w+)*)["']""", body)
        codes = const and const.group(1)
    if not codes:
        problems.append(f"{rel}: can't tell which language Tesseract.createWorker() loads (give it a string, or a const set to one)")
        return
    for code in codes.split("+"):
        want = f"{lang}/{code}.traineddata.gz"
        if not lang.startswith(folder + "/") or want not in vendor_files:
            problems.append(f"{rel}: langPath is {lang}, which doesn't hold {code}.traineddata.gz next to {folder}/tesseract.min.js in {MANIFEST}")


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
        notices = lib.get("notice_files", [])
        if not isinstance(notices, list) or not all(isinstance(e, dict) for e in notices):
            problems.append(f"{where}: notice_files must be a list of files like license_file")
        else:
            entries += [(e, "notice") for e in notices]
        for entry, is_license in entries:
            path = str(entry.get("path", ""))
            listed[path] += 1
            if not path.startswith(folder) or ".." in path:
                problems.append(f"{where}: {path or '(no path)'} must be inside {folder}")
                continue
            if is_license == "notice" and "source" not in entry and entry.get("written_by") == "Orisod":
                # A notice Orisod wrote (e.g. which versions a library bundles): text, never code.
                if WRITTEN_BY_NOT_ALLOWED.search(path):
                    problems.append(f"{where}: {path} is code, so it must be an upstream file with its https source URL")
            elif not str(entry.get("source", "")).startswith("https://"):
                problems.append(f"{where}: {path} needs its https source URL"
                                + (" (or, for a notice Orisod wrote, \"written_by\": \"Orisod\")" if is_license == "notice" else ""))
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
                if um.start() in seen:
                    continue
                url = um.group(0)
                if CDN_HOSTS.search(url):
                    if url in REMAINING_CDN:
                        cdn_uses[url] += 1
                    else:
                        problems.append(f"{rel}: inline script refers to the CDN address {url}; self-host it in {VENDOR}")
                elif on_other_host(url) and not not_loaded(rel, url):
                    problems.append(f"{rel}: inline script refers to {url} on another host; pages only load files from "
                                    f"this site (if nothing loads that address, like a link, add it to NOT_LOADED)")
            if "Tesseract.createWorker(" in body:
                check_tesseract(rel, body, loads[rel], vendor_scripts, problems)
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
            url = um.group(0)
            if CDN_HOSTS.search(url):
                problems.append(f"{rel}: refers to the CDN address {url}")
            elif on_other_host(url) and not not_loaded(rel, url):
                problems.append(f"{rel}: refers to {url} on another host (if nothing loads that address, add it to NOT_LOADED)")

    for url, allowed in REMAINING_CDN.items():
        used = cdn_uses[url]
        if used > allowed:
            problems.append(f"{url} appears {used} times, but REMAINING_CDN allows {allowed}: a new page depends on a CDN; "
                            f"self-host the library instead")
        elif used < allowed:
            problems.append(f"{url} appears {used} times, not {allowed}: lower its REMAINING_CDN entry in "
                            f"scripts/check_vendor.py" + (" (remove it)" if used == 0 else ""))

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
          f"all matching {MANIFEST}. "
          + (f"{sum(cdn_uses.values())} CDN references remain, all in REMAINING_CDN ({len(REMAINING_CDN)} URLs)."
             if REMAINING_CDN else "No page or site script uses a CDN or any other outside host."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
