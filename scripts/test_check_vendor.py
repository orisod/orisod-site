#!/usr/bin/env python3
"""Negative tests for check_vendor.py's tarball-member, vendor-path, stylesheet-path, flag-folder, wa.me, share-link and on-demand script rules.

Builds a tiny site in a temporary folder (one page, one vendored "font" taken from
a release tarball, its LICENSE, two circle-flags images and theirs, a
WhatsApp link generator page, a shared stylesheet in assets/css, and a Merge PDF page
and its /es/ twin that load a vendored "PDF.js" on demand), checks that check_vendor.py passes on it, then
breaks it one way at a time and checks that check_vendor.py fails with the
expected message. Run after changing either rule:

  python scripts/test_check_vendor.py   (CI: check-vendor)
"""
import copy
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

CHECK = Path(__file__).resolve().parent / "check_vendor.py"
URL = "https://example.org/releases/demo-fonts-1.0.tar.gz"
FOLDER = "assets/vendor/demo-font/1.0/"
FONT = b"not really a font, only bytes to hash"
LICENSE = b"Demo license text\n"
FLAGS = "assets/vendor/circle-flags/9.9/"
FLAG_SVG = b"<svg xmlns='http://www.w3.org/2000/svg'/>"
PDFJS = "assets/vendor/pdfjs/9.9/"
PDFJS_JS = b"window.pdfjsLib = {};"
PDFJS_WORKER_JS = b"self.onmessage = null;"


def entry(name, data):
    return {"path": FOLDER + name, "source": URL, "member": "demo-fonts-1.0/" + name,
            "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


MANIFEST = {"about": "test", "libraries": [{
    "name": "demo-font", "version": "1.0", "license": "OFL-1.1", "used_by": ["index"],
    "release_archive": {"url": URL, "sha256": "0" * 64, "bytes": 1, "checksum_from": "a test"},
    "files": [entry("Demo-Regular.ttf", FONT)],
    "license_file": entry("LICENSE", LICENSE),
}, {
    "name": "circle-flags", "version": "9.9", "license": "MIT", "used_by": ["whatsapp-link-generator"],
    "files": [{"path": FLAGS + c + ".svg", "source": "https://example.org/flags/" + c + ".svg",
               "sha256": hashlib.sha256(FLAG_SVG).hexdigest(), "bytes": len(FLAG_SVG)} for c in ("ar", "mx")],
    "license_file": {"path": FLAGS + "LICENSE", "source": "https://example.org/LICENSE",
                     "sha256": hashlib.sha256(LICENSE).hexdigest(), "bytes": len(LICENSE)},
}, {
    "name": "pdfjs", "version": "9.9", "license": "Apache-2.0", "used_by": ["merge-pdf"],
    "files": [{"path": PDFJS + n, "source": "https://example.org/pdfjs/" + n, "sha256": hashlib.sha256(b).hexdigest(), "bytes": len(b)}
              for n, b in (("pdf.min.js", PDFJS_JS), ("pdf.worker.min.js", PDFJS_WORKER_JS))],
    "license_file": {"path": PDFJS + "LICENSE", "source": "https://example.org/LICENSE",
                     "sha256": hashlib.sha256(LICENSE).hexdigest(), "bytes": len(LICENSE)},
}]}
PAGE = """<!doctype html><html><head><title>t</title><style>@font-face{font-family:"Demo";src:url("/assets/vendor/demo-font/1.0/Demo-Regular.ttf")}</style></head><body><main>t</main>
<script>
const FONT_FILES = ["/assets/vendor/demo-font/1.0/Demo-Regular.ttf"];
fetch(FONT_FILES[0]);
fetch(`${location.origin}/assets/vendor/demo-font/1.0/Demo-Regular.ttf`);
</script></body></html>
"""
WA_PAGE = """<!doctype html><html><head><title>w</title></head><body><main>w</main>
<script>
const FLAG_DIR = "/assets/vendor/circle-flags/9.9/";
const FLAG_CODES = "ar mx";
img.src = FLAG_DIR + code + ".svg";
link.href = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
const SHARE = "https://t.me/share/url?url=" + enc(u) + "&text=" + enc(t);
</script></body></html>
"""


# A second page with the "Share this tool" button: its share links are allowed, a WhatsApp chat link isn't.
RBP_PAGE = """<!doctype html><html><head><title>r</title></head><body><main>r</main>
<script>
const SHARE = ["https://wa.me/?text=" + enc(t), "https://t.me/share/url?url=" + enc(u), "https://www.reddit.com/submit?url=" + enc(u)];
</script></body></html>
"""


# Merge PDF loads PDF.js when the first PDF is added: a <script> it creates, pointed at the vendored file through a const.
LAZY_PAGE = """<!doctype html><html><head><title>m</title></head><body><main>m</main>
<script>
const PDFJS_SRC = "/assets/vendor/pdfjs/9.9/pdf.min.js";
let script = null;
function load() {
  script = document.createElement('script');
  script.src = PDFJS_SRC;
  script.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdfjs/9.9/pdf.worker.min.js"; };
  document.body.appendChild(script);
  const img = document.createElement('img');
  img.src = thumbUrl;
}
</script></body></html>
"""


# The shared stylesheet (assets/css/orisod.css in the real site) points at the vendored font too.
SITE_CSS = "@font-face{font-family:Demo;src:url(/assets/vendor/demo-font/1.0/Demo-Regular.ttf) format(\"truetype\")}" + chr(10)


def build(root, manifest=MANIFEST, page=PAGE, site_js=None, wa_page=WA_PAGE, rbp_page=RBP_PAGE, site_css=SITE_CSS, lazy_page=LAZY_PAGE, lazy_es=None):
    (root / FOLDER).mkdir(parents=True)
    (root / FOLDER / "Demo-Regular.ttf").write_bytes(FONT)
    (root / FOLDER / "LICENSE").write_bytes(LICENSE)
    (root / FLAGS).mkdir(parents=True)
    for c in ("ar", "mx"):
        (root / FLAGS / (c + ".svg")).write_bytes(FLAG_SVG)
    (root / FLAGS / "LICENSE").write_bytes(LICENSE)
    (root / "whatsapp-link-generator").mkdir()
    (root / "whatsapp-link-generator/index.html").write_text(wa_page, encoding="utf-8")
    (root / "remove-blank-pages").mkdir()
    (root / "remove-blank-pages/index.html").write_text(rbp_page, encoding="utf-8")
    (root / PDFJS).mkdir(parents=True)
    (root / PDFJS / "pdf.min.js").write_bytes(PDFJS_JS)
    (root / PDFJS / "pdf.worker.min.js").write_bytes(PDFJS_WORKER_JS)
    (root / PDFJS / "LICENSE").write_bytes(LICENSE)
    for folder, html in (("merge-pdf", lazy_page), ("es/merge-pdf", LAZY_PAGE if lazy_es is None else lazy_es)):
        (root / folder).mkdir(parents=True)
        (root / folder / "index.html").write_text(html, encoding="utf-8")
    (root / "assets/vendor/manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (root / ".gitattributes").write_text("assets/vendor/** -text\n", encoding="utf-8")
    (root / "index.html").write_text(page, encoding="utf-8")
    (root / "assets/css").mkdir(parents=True)
    (root / "assets/css/site.css").write_text(site_css, encoding="utf-8")
    if site_js is not None:
        (root / "assets/js").mkdir(parents=True)
        (root / "assets/js/site.js").write_text(site_js, encoding="utf-8")


def run(**kw):
    with tempfile.TemporaryDirectory() as d:
        build(Path(d), **kw)
        r = subprocess.run([sys.executable, str(CHECK), "--root", d], capture_output=True, text=True, encoding="utf-8")
        return r.returncode, r.stdout + r.stderr


def broken(change):
    m = copy.deepcopy(MANIFEST)
    change(m["libraries"][0])
    return m


CASES = [
    # (label, kwargs, expected text in the failure; None means it must pass)
    ("the valid demo site", {}, None),
    ("a member file without a release_archive", {"manifest": broken(lambda lib: lib.pop("release_archive"))},
     "needs a release_archive"),
    ("a member whose source isn't the tarball", {"manifest": broken(lambda lib: lib["files"][0].update(source="https://example.org/other.tar.gz"))},
     "its source must be the release_archive url"),
    ("a member path with ..", {"manifest": broken(lambda lib: lib["files"][0].update(member="../Demo-Regular.ttf"))},
     "same file name, at a relative path inside the tarball"),
    ("a member with another file name", {"manifest": broken(lambda lib: lib["files"][0].update(member="demo-fonts-1.0/Other.ttf"))},
     "same file name, at a relative path inside the tarball"),
    ("a release_archive without checksum_from", {"manifest": broken(lambda lib: lib["release_archive"].pop("checksum_from"))},
     "release_archive needs"),
    ("a release_archive no file uses", {"manifest": broken(lambda lib: [e.pop("member") for e in lib["files"] + [lib["license_file"]]])},
     "no file names a member of it"),
    ("a page fetching a vendor file not in the manifest", {"page": PAGE.replace("fetch(FONT_FILES[0]);", 'fetch("/assets/vendor/demo-font/1.0/Missing.ttf");')},
     "names /assets/vendor/demo-font/1.0/Missing.ttf, which isn't a library file"),
    ("a page naming a vendor file through a constant", {"page": PAGE.replace("Demo-Regular.ttf\"]", "Demo-Bold.ttf\"]")},
     "names /assets/vendor/demo-font/1.0/Demo-Bold.ttf"),
    ("a page fetching the license file", {"page": PAGE.replace("fetch(FONT_FILES[0]);", "fetch('/assets/vendor/demo-font/1.0/LICENSE.txt');")},
     "names /assets/vendor/demo-font/1.0/LICENSE.txt"),
    ("a template-literal fetch of a missing file", {"page": PAGE.replace("1.0/Demo-Regular.ttf`", "1.0/Gone.ttf`")},
     "names /assets/vendor/demo-font/1.0/Gone.ttf"),
    ("the site's own JS naming a missing vendor file", {"site_js": 'fetch("/assets/vendor/demo-font/2.0/Demo-Regular.ttf");\n'},
     "assets/js/site.js: a script names /assets/vendor/demo-font/2.0/Demo-Regular.ttf"),
    ("an inline <style> pointing at a vendor file not in the manifest", {"page": PAGE.replace("1.0/Demo-Regular.ttf\")}", "1.0/Demo-Bold.woff2\")}")},
     "index.html: a stylesheet points at /assets/vendor/demo-font/1.0/Demo-Bold.woff2, which isn't a library file"),
    ("an inline <style> pointing at the license file", {"page": PAGE.replace("1.0/Demo-Regular.ttf\")}", "1.0/LICENSE\")}")},
     "index.html: a stylesheet points at /assets/vendor/demo-font/1.0/LICENSE"),
    ("the shared stylesheet pointing at a missing vendor file", {"site_css": SITE_CSS.replace("demo-font/1.0/", "demo-font/2.0/")},
     "assets/css/site.css: a stylesheet points at /assets/vendor/demo-font/2.0/Demo-Regular.ttf"),
    ("the shared stylesheet importing from another host", {"site_css": "@import url(https://fonts.example.org/demo.css);" + chr(10) + SITE_CSS},
     "assets/css/site.css: imports or loads something from another host"),
    ("FLAG_CODES naming a flag that isn't vendored", {"wa_page": WA_PAGE.replace('"ar mx"', '"ar mx br"')},
     "FLAG_CODES names flags that aren't library files in assets/vendor/manifest.json under /assets/vendor/circle-flags/9.9/: br"),
    ("FLAG_DIR pointing at another version", {"wa_page": WA_PAGE.replace("circle-flags/9.9/", "circle-flags/9.8/")},
     "a script names the folder /assets/vendor/circle-flags/9.8/, which holds no library file"),
    ("a page using the flag folder without FLAG_CODES", {"wa_page": WA_PAGE.replace('const FLAG_CODES = "ar mx";', "")},
     "doesn't declare const FLAG_DIR"),
    ("FLAG_CODES with an upper-case code", {"wa_page": WA_PAGE.replace('"ar mx"', '"ar MX"')},
     "FLAG_CODES must be distinct two-letter lowercase codes"),
    ("a wa.me link on a page that isn't the WhatsApp tool", {"page": PAGE.replace("</script>", "location.href = 'https://wa.me/123';\n</script>")},
     "index.html: inline script refers to https://wa.me/123 on another host"),
    ("a share link on a page that isn't the WhatsApp tool", {"page": PAGE.replace("</script>", "a.href = 'https://t.me/share/url?url=x';\n</script>")},
     "index.html: inline script refers to https://t.me/share/url?url=x on another host"),
    ("a WhatsApp chat link on a page that only shares", {"rbp_page": RBP_PAGE.replace("https://wa.me/?text=", "https://wa.me/447400123456?text=")},
     "remove-blank-pages/index.html: inline script refers to https://wa.me/447400123456?text= on another host"),
    ("another address on a share host, on the second share page", {"rbp_page": RBP_PAGE.replace("reddit.com/submit?url=", "reddit.com/r/all?url=")},
     "remove-blank-pages/index.html: inline script refers to https://www.reddit.com/r/all?url= on another host"),
    ("another address on a share host", {"wa_page": WA_PAGE.replace("t.me/share/url?url=", "t.me/joinchat?url=")},
     "inline script refers to https://t.me/joinchat?url= on another host"),
    # On-demand (lazy) scripts: only a vendored library file, through a string or a const declared once.
    ("a lazy script written as a string", {"lazy_page": LAZY_PAGE.replace("script.src = PDFJS_SRC;", 'script.src = "/assets/vendor/pdfjs/9.9/pdf.min.js";'),
                                            "lazy_es": LAZY_PAGE.replace("script.src = PDFJS_SRC;", 'script.src = "/assets/vendor/pdfjs/9.9/pdf.min.js";')}, None),
    ("a lazy script from a CDN", {"lazy_page": LAZY_PAGE.replace('"/assets/vendor/pdfjs/9.9/pdf.min.js"', '"https://cdn.jsdelivr.net/npm/pdfjs-dist@9.9/pdf.min.js"')},
     "merge-pdf/index.html: a script loads https://cdn.jsdelivr.net/npm/pdfjs-dist@9.9/pdf.min.js on demand; only library scripts"),
    ("a lazy script from another host", {"lazy_page": LAZY_PAGE.replace('"/assets/vendor/pdfjs/9.9/pdf.min.js"', '"https://example.org/pdf.min.js"')},
     "merge-pdf/index.html: a script loads https://example.org/pdf.min.js on demand"),
    ("a lazy script from the site but outside assets/vendor", {"lazy_page": LAZY_PAGE.replace('"/assets/vendor/pdfjs/9.9/pdf.min.js"', '"/assets/js/pdf.min.js"')},
     "merge-pdf/index.html: a script loads /assets/js/pdf.min.js on demand"),
    ("a lazy script that isn't in the manifest", {"lazy_page": LAZY_PAGE.replace('"/assets/vendor/pdfjs/9.9/pdf.min.js"', '"/assets/vendor/pdfjs/9.8/pdf.min.js"')},
     "merge-pdf/index.html: a script loads /assets/vendor/pdfjs/9.8/pdf.min.js on demand"),
    ("a lazy load of a license file", {"lazy_page": LAZY_PAGE.replace('"/assets/vendor/pdfjs/9.9/pdf.min.js"', '"/assets/vendor/pdfjs/9.9/LICENSE"')},
     "merge-pdf/index.html: a script loads /assets/vendor/pdfjs/9.9/LICENSE on demand"),
    ("a lazy script built from a template literal", {"lazy_page": LAZY_PAGE.replace("script.src = PDFJS_SRC;", "script.src = `/assets/vendor/pdfjs/${v}/pdf.min.js`;")},
     "script.src is set to `/assets/vendor/pdfjs/${v}/pdf.min.js`; a <script> a page creates must load a vendored file"),
    ("a lazy script built by concatenation", {"lazy_page": LAZY_PAGE.replace("script.src = PDFJS_SRC;", 'script.src = DIR + "pdf.min.js";')},
     'script.src is set to DIR + "pdf.min.js"'),
    ("a lazy script through a let", {"lazy_page": LAZY_PAGE.replace("const PDFJS_SRC =", "let PDFJS_SRC =")},
     "script.src is set to PDFJS_SRC, which must be a const declared once as a vendored file path"),
    ("a lazy script whose const is reassigned", {"lazy_page": LAZY_PAGE.replace("function load() {", 'function load() {\n  PDFJS_SRC = "https://example.org/x.js";')},
     "script.src is set to PDFJS_SRC, which must be a const declared once"),
    ("a lazy script's src set with setAttribute", {"lazy_page": LAZY_PAGE.replace("script.src = PDFJS_SRC;", "script.setAttribute('src', PDFJS_SRC);")},
     "sets the src of the <script> it creates (script) with setAttribute"),
    ("a created script with code written into it", {"lazy_page": LAZY_PAGE.replace("script.src = PDFJS_SRC;", "script.src = PDFJS_SRC;\n  script.textContent = code;")},
     "writes code into it"),
    ("a created script that isn't assigned to a variable", {"lazy_page": LAZY_PAGE.replace("document.body.appendChild(script);", "document.body.appendChild(document.createElement('script'));")},
     "creates a <script> element that isn't assigned to a variable"),
    ("a lazy PDF.js without its workerSrc", {"lazy_page": LAZY_PAGE.replace('pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdfjs/9.9/pdf.worker.min.js";', "")},
     "merge-pdf/index.html: loads /assets/vendor/pdfjs/9.9/pdf.min.js but doesn't set pdfjsLib.GlobalWorkerOptions.workerSrc"),
    ("a lazy PDF.js with a worker that isn't vendored", {"lazy_page": LAZY_PAGE.replace("9.9/pdf.worker.min.js", "9.8/pdf.worker.min.js")},
     "workerSrc is /assets/vendor/pdfjs/9.8/pdf.worker.min.js, which isn't a library file"),
    ("EN loading PDF.js on demand and ES not at all", {"lazy_es": LAZY_PAGE.replace("script.src = PDFJS_SRC;", "").replace("script = document.createElement('script');", "")},
     "es/merge-pdf/index.html: loads [], but merge-pdf/index.html loads ['/assets/vendor/pdfjs/9.9/pdf.min.js']"),
    ("the site's own JS loading a script that isn't vendored", {"site_js": "const s = document.createElement('script');\ns.src = '/assets/js/extra.js';\n"},
     "assets/js/site.js: a script loads /assets/js/extra.js on demand"),
]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    failed = 0
    for label, kw, want in CASES:
        code, out = run(**kw)
        ok = code == 0 if want is None else (code == 1 and want in out)
        failed += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {label}: check_vendor {'passed' if code == 0 else 'failed'}"
              + ("" if ok else f" (expected {'a pass' if want is None else repr(want)})\n{out}"))
    print(f"{len(CASES) - failed} of {len(CASES)} check_vendor rule tests passed." if not failed else f"{failed} test(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
