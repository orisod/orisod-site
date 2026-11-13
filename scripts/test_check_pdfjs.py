#!/usr/bin/env python3
"""Negative tests for check_pdfjs.py: the eval setting, the one way a page loads PDF.js, and <head>.

Builds a tiny site in a temporary folder (a page that loads the vendored PDF.js with a
<script> tag, and Merge PDF and its /es/ twin, which load it on demand when the first
PDF is added), checks that check_pdfjs.py passes on it, then breaks it one way at a
time and checks that check_pdfjs.py fails with the expected message. Run after
changing the check:

  python scripts/test_check_pdfjs.py   (CI: check-pdfjs)
"""
import subprocess
import sys
import tempfile
from pathlib import Path

CHECK = Path(__file__).resolve().parent / "check_pdfjs.py"
TAG = '<script src="/assets/vendor/pdfjs/3.11.174/pdf.min.js"></script>'
TAG_PAGE = f"""<!doctype html><html><head><title>t</title></head><body><main>t</main>
{TAG}
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdfjs/3.11.174/pdf.worker.min.js";
const pdf = await pdfjsLib.getDocument({{ data, isEvalSupported: false }}).promise;
</script></body></html>
"""
LAZY_PAGE = """<!doctype html><html><head><title>m</title></head><body><main>m</main>
<script>
const PDFJS_SRC = "/assets/vendor/pdfjs/3.11.174/pdf.min.js";
function loadPdfjs() {
  script = document.createElement('script');
  script.src = PDFJS_SRC;
  document.body.appendChild(script);
}
async function read(data, worker) {
  const pdf = await pdfjsLib.getDocument({ data, worker, isEvalSupported: false }).promise;
}
</script></body></html>
"""


def run(tag_page=TAG_PAGE, lazy_page=LAZY_PAGE):
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        for folder, html in (("split-pdf", tag_page), ("merge-pdf", lazy_page), ("es/merge-pdf", LAZY_PAGE)):
            (root / folder).mkdir(parents=True)
            (root / folder / "index.html").write_text(html, encoding="utf-8")
        r = subprocess.run([sys.executable, str(CHECK), "--root", d], capture_output=True, text=True, encoding="utf-8")
        # Page names print with the system's path separator.
        return r.returncode, (r.stdout + r.stderr).replace("\\", "/")


CASES = [
    # (label, kwargs, expected text in the failure; None means it must pass)
    ("the valid demo site", {}, None),
    ("a getDocument() call without isEvalSupported: false", {"tag_page": TAG_PAGE.replace(", isEvalSupported: false", "")},
     "split-pdf/index.html: getDocument({ data }) must pass isEvalSupported: false"),
    ("an on-demand page's getDocument() without isEvalSupported: false", {"lazy_page": LAZY_PAGE.replace(", isEvalSupported: false", "")},
     "merge-pdf/index.html: getDocument({ data, worker }) must pass isEvalSupported: false"),
    ("isEvalSupported: true", {"lazy_page": LAZY_PAGE.replace("isEvalSupported: false", "isEvalSupported: true")},
     "merge-pdf/index.html: getDocument({ data, worker, isEvalSupported: true }) must pass isEvalSupported: false"),
    ("a getDocument() call that can't be read", {"tag_page": TAG_PAGE.replace("getDocument({ data, isEvalSupported: false }).promise", "getDocument(opts).then(go)")},
     "split-pdf/index.html: a getDocument() call isn't in the form"),
    ("a page that opens PDFs without loading PDF.js", {"tag_page": TAG_PAGE.replace(TAG + "\n", "")},
     "split-pdf/index.html: opens PDFs but loads the vendored PDF.js 0 time(s) with a <script> tag and 0 time(s) on demand"),
    ("a page that loads PDF.js with a tag and on demand", {"lazy_page": LAZY_PAGE.replace("<script>\n", TAG + "\n<script>\n", 1)},
     "merge-pdf/index.html: opens PDFs but loads the vendored PDF.js 1 time(s) with a <script> tag and 1 time(s) on demand"),
    ("PDF.js loaded on demand from a CDN", {"lazy_page": LAZY_PAGE.replace('"/assets/vendor/pdfjs/3.11.174/pdf.min.js"', '"https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"')},
     "merge-pdf/index.html: opens PDFs but loads the vendored PDF.js 0 time(s) with a <script> tag and 0 time(s) on demand"),
    ("PDF.js from a CDN tag", {"tag_page": TAG_PAGE.replace('"/assets/vendor/pdfjs/3.11.174/pdf.min.js"', '"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"')},
     "split-pdf/index.html: opens PDFs but loads the vendored PDF.js 0 time(s)"),
    ("a CDN library in <head>", {"tag_page": TAG_PAGE.replace("</title>", '</title><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>')},
     "split-pdf/index.html: a library <script> is in <head>"),
]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    failed = 0
    for label, kw, want in CASES:
        code, out = run(**kw)
        ok = code == 0 if want is None else (code == 1 and want in out)
        failed += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {label}: check_pdfjs {'passed' if code == 0 else 'failed'}"
              + ("" if ok else f" (expected {'a pass' if want is None else repr(want)})\n{out}"))
    print(f"{len(CASES) - failed} of {len(CASES)} check_pdfjs rule tests passed." if not failed else f"{failed} test(s) failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
