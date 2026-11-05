#!/usr/bin/env python3
"""Negative tests for check_vendor.py's tarball-member, vendor-path, flag-folder, wa.me and share-link rules (both share pages).

Builds a tiny site in a temporary folder (one page, one vendored "font" taken from
a release tarball, its LICENSE, two circle-flags images and theirs, and a
WhatsApp link generator page), checks that check_vendor.py passes on it, then
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
}]}
PAGE = """<!doctype html><html><head><title>t</title></head><body><main>t</main>
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


def build(root, manifest=MANIFEST, page=PAGE, site_js=None, wa_page=WA_PAGE, rbp_page=RBP_PAGE):
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
    (root / "assets/vendor/manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (root / ".gitattributes").write_text("assets/vendor/** -text\n", encoding="utf-8")
    (root / "index.html").write_text(page, encoding="utf-8")
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
