"""Prove that check_filename.py fails on every kind of problem it's meant to catch (CI: check-filename).

Builds a tiny synthetic site in a temporary folder (the real helper source, one opted-in page), checks that
it passes, then breaks it one way at a time and checks that each copy fails with the expected message.
It also checks that sync_filename.py --write --add adopts a page without touching anything outside the
block, and that --write repairs an edited block.

    python scripts/test_check_filename.py
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "js" / "orisod-filename.js"
CHECK = ROOT / "scripts" / "check_filename.py"
SYNC = ROOT / "scripts" / "sync_filename.py"

TOOL = """<!DOCTYPE html>
<html lang="en"><head><title>Tool</title></head>
<body>
<div id="result"></div>
<script src="/assets/vendor/x.js"></script>
<script>
const resultEl = document.getElementById('result');
function done(selectedFile, blob) {
  const url = URL.createObjectURL(blob);
  const outName = orisodFileName({ name: selectedFile.name, accept: ['pdf'], action: 'signed', ext: 'pdf', fallback: 'document' });
  const card = document.createElement('div');
  card.innerHTML = `
    <div class="result-filename"></div>
    <div class="result-stat">${(blob.size / 1024).toFixed(1)} KB</div>
  `;
  card.querySelector('.result-filename').textContent = outName;
  const kept = blob.size === 0;
  const keptName = kept ? selectedFile.name : orisodFileName({ name: selectedFile.name, accept: ['pdf'], action: 'compressed', ext: 'pdf' });
  const link = document.createElement('a');
  link.href = url;
  link.download = outName;
  link.setAttribute('download', keptName);
  zip.file(orisodFileName({ name: selectedFile.name, accept: ['pdf'], action: 'page', part: 1, total: 3, ext: 'pdf' }), blob);
}
</script>
</body></html>
"""

# Favicon Generator keeps the standard names of its zip's entries (STANDARD_ZIP_ENTRIES); only the zip is named by the helper.
FAVICON = """<!DOCTYPE html>
<html lang="en"><head><title>Favicon</title></head>
<body>
<script>
async function build(zip, ico, buf, snippet) {
  zip.file('favicon.ico', ico);
  const namedSizes = [
    { size: 16, name: 'favicon-16x16.png' },
    { size: 512, name: 'android-chrome-512x512.png' }
  ];
  for (const { size, name } of namedSizes) zip.file(name, buf);
  zip.file('favicon-html-snippet.txt', snippet);
  const a = document.createElement('a');
  a.download = orisodZipName({ fallback: 'favicon-package' });
}
</script>
</body></html>
"""
# (label, old, new, expected message part) on the favicon page, and the same entries on another page.
FAVICON_BREAKS = [
    ("a non-standard entry name", "zip.file('favicon.ico', ico);", "zip.file('icon.ico', ico);", "zip.file('icon.ico'"),
    ("a non-standard name in the size list", "name: 'android-chrome-512x512.png'", "name: 'icon-512.png'", "zip.file(name"),
    ("a template entry name", "zip.file('favicon.ico', ico);", "zip.file(`${base}.ico`, ico);", "zip.file(`${base}.ico`"),
    ("a literal zip name", "a.download = orisodZipName({ fallback: 'favicon-package' });", "a.download = 'favicon-package.zip';", ".download = 'favicon-package.zip'"),
]

# (label, old, new, expected message part); each break is applied to the synced page.
BREAKS = [
    ("an edited block", "const ORISOD_NAME_BYTES = 120;", "const ORISOD_NAME_BYTES = 200;", "differs from"),
    ("a missing end marker", "// Orisod file name: end", "// end", "broken markers"),
    ("two blocks", "<div id=\"result\"></div>", "<div id=\"result\"></div>\n<script>\n// Orisod file name: start\n// Orisod file name: end\n</script>", "broken markers"),
    ("a literal download name", "link.download = outName;", "link.download = 'signed.pdf';", ".download = 'signed.pdf'"),
    ("a template download name", "link.download = outName;", "link.download = `${selectedFile.name}-signed.pdf`;", "doesn't come from orisodFileName()"),
    ("a variable not from the helper", "link.download = outName;", "const other = selectedFile.name + '-x.pdf';\n  link.download = other;", ".download = other"),
    ("a second plain assignment", "  const link = document.createElement('a');", "  let n2 = orisodFileName({ name: 'a', ext: 'pdf' });\n  n2 = 'plain.pdf';\n  const link = document.createElement('a');\n  link.download = n2;", ".download = n2"),
    ("a literal beside the helper", "kept ? selectedFile.name :", "kept ? 'original.pdf' :", "setAttribute(\"download\", keptName)"),
    ("a literal zip entry", "zip.file(orisodFileName({ name: selectedFile.name, accept: ['pdf'], action: 'page', part: 1, total: 3, ext: 'pdf' }), blob);", "zip.file('page-1.pdf', blob);", "zip.file('page-1.pdf'"),
    ("a helper name in a template", "<div class=\"result-filename\"></div>", "<div class=\"result-filename\">${outName}</div>", "(outName) is written into HTML"),
    ("a file .name in a template", "<div class=\"result-filename\"></div>", "<div class=\"result-filename\">${selectedFile.name}</div>", "(.name) is written into HTML"),
    ("a file name concatenated into HTML", "  card.querySelector('.result-filename').textContent = outName;", "  card.innerHTML += '<b>' + outName + '</b>';", "(outName) is written into HTML"),
    ("a variable taken from .name in HTML", "  const kept = blob.size === 0;", "  const label = selectedFile.name;\n  card.innerHTML += `<b>${label}</b>`;\n  const kept = blob.size === 0;", "(label) is written into HTML"),
    ("insertAdjacentHTML with a name", "  card.querySelector('.result-filename').textContent = outName;", "  card.insertAdjacentHTML('beforeend', `<b>${keptName}</b>`);", "(keptName) is written into HTML"),
]

# (label, line 3 of a page without the block, part of the expected message): each must fail.
NO_BLOCK_DOWNLOADS = [
    ("a.download", "<script>a.download = 'calendar.pdf';</script>", ".download ="),
    ("link.download from a variable", "<script>link.download = outName;</script>", ".download ="),
    ("setAttribute", "<script>link.setAttribute('download', 'x.png');</script>", "setAttribute('download'"),
    ("zip.file", "<script>zip.file('page-1.pdf', bytes);</script>", "zip.file("),
    ("an <a download> in the markup", "<a href=\"/report.pdf\" download=\"report.pdf\">Get</a>", "<a href=\"/report.pdf\" download"),
]


def run(script, root, *args):
    r = subprocess.run([sys.executable, str(script), "--root", str(root), *args], capture_output=True, text=True, encoding="utf-8")
    return r.returncode, r.stdout + r.stderr


def make_site(tmp):
    (tmp / "assets" / "js").mkdir(parents=True)
    shutil.copy(SOURCE, tmp / "assets" / "js" / "orisod-filename.js")
    (tmp / "tool").mkdir()
    (tmp / "tool" / "index.html").write_bytes(TOOL.replace("\n", "\r\n").encode("utf-8"))


def main():
    failures = []
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        make_site(tmp)
        page = tmp / "tool" / "index.html"
        before = page.read_bytes()
        code, out = run(CHECK, tmp)
        if code == 0 or "without the \"Orisod file name\" block" not in out:
            failures.append(f"a helper call without the block passed: {out}")
        code, out = run(SYNC, tmp, "--write", "--add", "tool/index.html")
        after = page.read_bytes()
        block_start = after.find(b"// Orisod file name: start")
        block_end = after.find(b"// Orisod file name: end") + len(b"// Orisod file name: end\r\n")
        if code != 0 or after[:block_start] + after[block_end:] != before or b"\n" in after.replace(b"\r\n", b""):
            failures.append(f"--add changed more than the block, or not with CRLF: {out}")
        if after.rfind(b"<script>", 0, block_start) < after.find(b"<script src"):
            failures.append("--add put the block in the wrong <script>")
        code, out = run(CHECK, tmp)
        if code != 0:
            failures.append(f"the synced page failed: {out}")
        # The favicon page: its standard entry names pass there, and fail anywhere else.
        fav = tmp / "favicon-generator" / "index.html"
        fav.parent.mkdir()
        fav.write_bytes(FAVICON.replace("\n", "\r\n").encode("utf-8"))
        run(SYNC, tmp, "--write", "--add", "favicon-generator/index.html")
        code, out = run(CHECK, tmp)
        if code != 0:
            failures.append(f"the favicon page's standard entry names failed: {out}")
        fav_good = fav.read_bytes().decode("utf-8").replace("\r\n", "\n")
        for label, old, new, want in FAVICON_BREAKS:
            if fav_good.count(old) != 1:
                failures.append(f"favicon, {label}: the test text isn't in the page once")
                continue
            fav.write_text(fav_good.replace(old, new), encoding="utf-8", newline="\n")
            code, out = run(CHECK, tmp)
            if code == 0 or want not in out:
                failures.append(f"favicon, {label}: expected a failure with \"{want}\", got {code}: {out.strip()}")
            else:
                print(f"ok   favicon, {label} fails as it should")
        other = tmp / "other-tool" / "index.html"
        other.parent.mkdir()
        other.write_text(fav_good, encoding="utf-8", newline="\n")
        code, out = run(CHECK, tmp)
        if code == 0 or "other-tool/index.html" not in out or "zip.file('favicon.ico'" not in out:
            failures.append(f"the standard favicon names passed on another page: {out.strip()}")
        else:
            print("ok   the standard favicon names fail on any other page")
        shutil.rmtree(other.parent)
        fav.write_text(fav_good, encoding="utf-8", newline="\n")
        # A page that offers a download without the block fails, in every form, unless it's in PENDING_PAGES.
        plain = tmp / "plain-tool" / "index.html"
        plain.parent.mkdir()
        for label, body, want in NO_BLOCK_DOWNLOADS:
            plain.write_text(f"<html><body>\n<div></div>\n{body}\n</body></html>\n", encoding="utf-8", newline="\n")
            code, out = run(CHECK, tmp)
            if code == 0 or "plain-tool/index.html:3: offers a download" not in out or want not in out:
                failures.append(f"no block, {label}: expected a failure at line 3 naming \"{want}\", got {code}: {out.strip()}")
            else:
                print(f"ok   no block, {label} fails as it should")
        shutil.rmtree(plain.parent)
        # PENDING_PAGES is empty: the pages it used to list (Merge PDF, the WhatsApp link generator) fail like any other.
        pending = tmp / "merge-pdf" / "index.html"
        pending.parent.mkdir()
        pending.write_text("<script>\nlink.download = 'merged.pdf';\n</script>\n", encoding="utf-8", newline="\n")
        code, out = run(CHECK, tmp)
        if code == 0 or "merge-pdf/index.html:2: offers a download" not in out:
            failures.append(f"merge-pdf with a download and no block passed with the list empty: {out.strip()}")
        else:
            print("ok   with PENDING_PAGES empty, merge-pdf with a download and no block fails")
        # The list's own rules, on a copy of the check with one entry: it keeps its old download for now, and a stale
        # entry (no download any more, or the block added) fails.
        listed = tmp / "check_listed.py"
        src = CHECK.read_text(encoding="utf-8")
        assert src.count("PENDING_PAGES = {}") == 1
        listed.write_text(src.replace("PENDING_PAGES = {}", 'PENDING_PAGES = {"merge-pdf/index.html": "test entry"}'), encoding="utf-8")
        shutil.copy(SYNC, tmp / "sync_filename.py")
        code, out = run(listed, tmp)
        if code != 0:
            failures.append(f"a PENDING_PAGES page with its old download failed: {out.strip()}")
        else:
            print("ok   a PENDING_PAGES page keeps its old download while listed")
        pending.write_text("<script>\nconst x = 1;\n</script>\n", encoding="utf-8", newline="\n")
        code, out = run(listed, tmp)
        if code == 0 or "listed in PENDING_PAGES but offers no download" not in out:
            failures.append(f"a PENDING_PAGES page with no download passed: {out.strip()}")
        else:
            print("ok   a PENDING_PAGES page with no download fails (stale entry)")
        pending.write_bytes(fav.read_bytes())
        code, out = run(listed, tmp)
        if code == 0 or "listed in PENDING_PAGES but carries the block" not in out:
            failures.append(f"a PENDING_PAGES page carrying the block passed: {out.strip()}")
        else:
            print("ok   a PENDING_PAGES page carrying the block fails (stale entry)")
        shutil.rmtree(pending.parent)
        listed.unlink()
        (tmp / "sync_filename.py").unlink()
        fav.write_text(fav_good.replace("<body>\n", "<body>\n<a href=\"/x.zip\" download>Get</a>\n", 1), encoding="utf-8", newline="\n")
        code, out = run(CHECK, tmp)
        if code == 0 or "favicon-generator/index.html:4: an <a download> in the markup" not in out:
            failures.append(f"an <a download> in a block page's markup passed: {out.strip()}")
        else:
            print("ok   an <a download> in the markup of a page with the block fails, at its line")
        fav.write_text(fav_good, encoding="utf-8", newline="\n")
        good = page.read_bytes().decode("utf-8").replace("\r\n", "\n")
        for label, old, new, want in BREAKS:
            if good.count(old) != 1:
                failures.append(f"{label}: the test text isn't in the page once")
                continue
            page.write_text(good.replace(old, new), encoding="utf-8", newline="\n")
            code, out = run(CHECK, tmp)
            if code == 0 or want not in out:
                failures.append(f"{label}: expected a failure with \"{want}\", got {code}: {out.strip()}")
            else:
                print(f"ok   {label} fails as it should")
        # The reported line is the page's own line, also for code after the block.
        broken = good.replace("link.download = outName;", "link.download = 'signed.pdf';")
        page.write_text(broken, encoding="utf-8", newline="\n")
        code, out = run(CHECK, tmp)
        want_line = broken[:broken.index("link.download = 'signed.pdf'")].count("\n") + 1
        if f"tool/index.html:{want_line}:" not in out:
            failures.append(f"the failure isn't reported at line {want_line}: {out.strip()}")
        else:
            print(f"ok   the failure is reported at the page's line {want_line}")
        page.write_text(good.replace("const ORISOD_NAME_BYTES = 120;", "const ORISOD_NAME_BYTES = 9;"), encoding="utf-8", newline="\n")
        code, out = run(SYNC, tmp, "--check")
        if code == 0:
            failures.append("sync --check passed an edited block")
        run(SYNC, tmp, "--write")
        if page.read_text(encoding="utf-8") != good:
            failures.append("sync --write didn't restore the edited block")
        src = tmp / "assets" / "js" / "orisod-filename.js"
        src.write_text(src.read_text(encoding="utf-8") + "// Orisod file name: end\n", encoding="utf-8")
        code, out = run(CHECK, tmp)
        if code == 0 or "must not contain the block markers" not in out:
            failures.append(f"a source with a marker passed: {out}")
        else:
            print("ok   a source containing a marker fails as it should")
    for f in failures:
        print(f"FAIL {f}")
    if failures:
        return 1
    print(f"All check_filename.py tests passed ({len(BREAKS) + len(FAVICON_BREAKS) + len(NO_BLOCK_DOWNLOADS) + 7} broken copies fail, --add and --write touch only the block).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
