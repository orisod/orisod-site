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
    ("insertAdjacentHTML with a name", "  card.querySelector('.result-filename').textContent = outName;", "  card.insertAdjacentHTML('beforeend', `<b>${keptName}</b>`);", "(keptName) is written into HTML"),
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
    print(f"All check_filename.py tests passed ({len(BREAKS) + 2} broken copies fail, --add and --write touch only the block).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
