"""Check the download file name helper and the pages that use it (CI: check-filename).

Fails when:
- assets/js/orisod-filename.js contains a block marker or </script>
- a page's "Orisod file name" block is broken (a marker missing, two blocks, outside a single <script>)
  or differs from the source (line endings aside); fix with python scripts/sync_filename.py --write
- a page calls orisodFileName() or orisodZipName() without carrying the block
- on a page with the block (an opted-in page), outside the block:
  - an `X.download = ...`, `setAttribute("download", ...)` or `zip.file(<name>, ...)` whose name doesn't come
    from the helper: it must be a helper call, or a variable whose every assignment is one. Around the call,
    only plain code is allowed (no string or template literal), so `kept ? file.name : orisodFileName(...)`
    passes and `kept ? "x.pdf" : orisodFileName(...)` doesn't
  - a file name written into HTML: an innerHTML/outerHTML assignment or insertAdjacentHTML() that uses a
    helper-made variable or any `.name` property (use textContent)
- the one exception, STANDARD_ZIP_ENTRIES: Favicon Generator's zip entries keep their standard names
  (favicon.ico, favicon-16x16.png...), because browsers look for those exact names and the HTML snippet in the
  same zip links to them. Its zip.file() names must be one of those literals, or the `name` of its size list,
  whose every `name: '...'` must be one of them too. The zip itself is named by the helper like any other.

    python scripts/check_filename.py [--root DIR]
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sync_filename as sf  # noqa: E402

HELPERS = ("orisodFileName(", "orisodZipName(")
# Files inside a zip whose names must not change, by page. Favicon Generator's package: browsers request
# /favicon.ico and the other icons by these exact names, and favicon-html-snippet.txt links to them, so they keep
# their standard names (no input name, no -orisod). Only the zip's own name comes from the helper.
FAVICON_ENTRIES = {"favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png",
                   "android-chrome-192x192.png", "android-chrome-512x512.png", "favicon-html-snippet.txt"}
STANDARD_ZIP_ENTRIES = {"favicon-generator/index.html": FAVICON_ENTRIES, "es/favicon-generator/index.html": FAVICON_ENTRIES}
SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S | re.I)


def balanced(text, i, open_ch="(", close_ch=")"):
    """Index just past the bracket closing the one at text[i]; skips string and template literals."""
    depth, j, n = 0, i, len(text)
    while j < n:
        c = text[j]
        if c in "'\"`":
            j = skip_string(text, j)
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return n


def skip_string(text, i):
    q, j, n = text[i], i + 1, len(text)
    while j < n:
        c = text[j]
        if c == "\\":
            j += 2
            continue
        if q == "`" and text.startswith("${", j):
            j = balanced(text, j + 1, "{", "}")
            continue
        if c == q:
            return j + 1
        j += 1
    return n


def statement_end(text, i):
    """End of the expression starting at i: the first ; or line break outside brackets and literals, or a
    closing bracket of an enclosing call."""
    depth, j, n = 0, i, len(text)
    while j < n:
        c = text[j]
        if c in "'\"`":
            j = skip_string(text, j)
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                return j
            depth -= 1
        elif depth == 0 and c in ";\n,":
            return j
        j += 1
    return n


def without_helper_calls(expr):
    out, j = "", 0
    while True:
        k = min([expr.find(h, j) for h in HELPERS if expr.find(h, j) >= 0], default=-1)
        if k < 0:
            return out + expr[j:], out != expr
        p = expr.index("(", k)
        out += expr[j:k] + "HELPER"
        j = balanced(expr, p)


def from_helper(expr):
    rest, had = without_helper_calls(expr.strip())
    return had and not re.search(r"['\"`]", rest)


def assignments(code, ident):
    pat = re.compile(r"(?<![\w.$])" + re.escape(ident) + r"\s*=(?![=>])")
    for m in pat.finditer(code):
        yield code[m.end():statement_end(code, m.end())]


IDENT_RE = re.compile(r"[A-Za-z_$][\w$]*$")


def name_ok(code, expr):
    expr = expr.strip()
    if IDENT_RE.match(expr):
        values = list(assignments(code, expr))
        return bool(values) and all(from_helper(v) for v in values)
    return from_helper(expr)


def helper_vars(code):
    """Variables that hold a file name: made by the helper, or taken from a `.name` (currentFileName = file.name)."""
    names = set()
    for m in re.finditer(r"(?<![\w.$])([A-Za-z_$][\w$]*)\s*=(?![=>])", code):
        value = code[m.end():statement_end(code, m.end())]
        if any(h in value for h in HELPERS) or re.search(r"\.name\b", value):
            names.add(m.group(1))
    return names


def html_sinks(code):
    for m in re.finditer(r"\.(?:innerHTML|outerHTML)\s*\+?=(?!=)\s*", code):
        yield m.start(), code[m.end():statement_end(code, m.end())]
    for m in re.finditer(r"\.insertAdjacentHTML\s*\(", code):
        p = m.end() - 1
        yield m.start(), code[p + 1:balanced(code, p) - 1]


def interpolations(expr):
    """The code parts of an HTML expression: ${...} inside templates, and everything outside literals."""
    parts, j, n = [], 0, len(expr)
    plain = ""
    while j < n:
        c = expr[j]
        if c in "'\"":
            j = skip_string(expr, j)
            plain += " "
            continue
        if c == "`":
            k = j + 1
            while k < n and expr[k] != "`":
                if expr[k] == "\\":
                    k += 2
                    continue
                if expr.startswith("${", k):
                    e = balanced(expr, k + 1, "{", "}")
                    parts.append(expr[k + 2:e - 1])
                    k = e
                    continue
                k += 1
            j = k + 1
            plain += " "
            continue
        plain += c
        j += 1
    return parts + [plain]


def line_of(text, offset):
    return text.count("\n", 0, offset) + 1


def standard_entry(code, expr, allowed):
    """A zip entry name on a STANDARD_ZIP_ENTRIES page: an allowed literal, or `name` from a list whose every
    `name: '...'` is allowed."""
    expr = expr.strip()
    m = re.fullmatch(r"'([^'\\]*)'|\"([^\"\\]*)\"", expr)
    if m:
        return (m.group(1) or m.group(2)) in allowed
    if expr == "name":
        listed = re.findall(r"\bname:\s*['\"]([^'\"]*)['\"]", code)
        return bool(listed) and all(n in allowed for n in listed)
    return False


def check_page(rel, text, source, errors):
    try:
        r = sf.region(text)
    except ValueError as e:
        errors.append(f"{rel}: {e}")
        return
    calls = any(h in text for h in HELPERS)
    if r is None:
        if calls:
            errors.append(f"{rel}: calls orisodFileName()/orisodZipName() without the \"Orisod file name\" block "
                          f"(python scripts/sync_filename.py --write --add {rel})")
        return
    scripts = [(m.start(2), m.end(2), m.group(1)) for m in SCRIPT_RE.finditer(text)]
    holder = [s for s in scripts if s[0] <= r[0] and r[1] <= s[1]]
    if not holder or holder[0][2].strip():
        errors.append(f"{rel}: the \"Orisod file name\" block isn't inside a single inline <script>")
        return
    if text[r[0]:r[1]] != sf.block(source):
        errors.append(f"{rel}:{line_of(text, r[0])}: the \"Orisod file name\" block differs from {sf.SOURCE.as_posix()} "
                      f"(python scripts/sync_filename.py --write)")
    for s, e, attrs in scripts:
        if attrs.strip():
            continue
        code = text[s:e]
        if s <= r[0] and r[1] <= e:
            code = text[s:r[0]] + "\n" * text.count("\n", r[0], r[1]) + text[r[1]:e]
        # The block is blanked out with the same number of line breaks, so lines are counted in `code` itself.
        first = text.count("\n", 0, s)
        at = lambda off: f"{rel}:{first + code.count(chr(10), 0, off) + 1}"  # noqa: E731
        for m in re.finditer(r"\.download\s*=(?![=>])\s*", code):
            expr = code[m.end():statement_end(code, m.end())]
            if not name_ok(code, expr):
                errors.append(f"{at(m.start())}: .download = {expr.strip()[:80]} doesn't come from orisodFileName()")
        for m in re.finditer(r"\.setAttribute\(\s*['\"]download['\"]\s*,", code):
            expr = code[m.end():statement_end(code, m.end())]
            if not name_ok(code, expr):
                errors.append(f"{at(m.start())}: setAttribute(\"download\", {expr.strip()[:80]}) doesn't come from orisodFileName()")
        allowed = STANDARD_ZIP_ENTRIES.get(rel, set())
        for m in re.finditer(r"\bzip\.file\(", code):
            expr = code[m.end():statement_end(code, m.end())]
            if not name_ok(code, expr) and not standard_entry(code, expr, allowed):
                errors.append(f"{at(m.start())}: zip.file({expr.strip()[:80]}, ...) doesn't come from orisodFileName()/orisodZipName()")
        names = helper_vars(code)
        for off, expr in html_sinks(code):
            for part in interpolations(expr):
                used = [n for n in names if re.search(r"(?<![\w.$])" + re.escape(n) + r"(?![\w$])", part)]
                if re.search(r"\.name\b", part):
                    used.append(".name")
                if used:
                    errors.append(f"{at(off)}: a file name ({', '.join(sorted(used))}) is written into HTML; use textContent")
                    break


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    root = Path(a.root)
    errors = []
    try:
        source = sf.read_source(root)
    except SystemExit as e:
        print(f"FAIL {e}")
        return 1
    count = 0
    for p in sf.pages(root):
        text = p.read_bytes().decode("utf-8").replace("\r\n", "\n")
        before = len(errors)
        check_page(p.relative_to(root).as_posix(), text, source, errors)
        if sf.START_PREFIX in text and len(errors) == before:
            count += 1
    for e in errors:
        print(f"FAIL {e}")
    if errors:
        print(f"{len(errors)} problem(s) with download file names.")
        return 1
    print(f"OK: {count} pages carry the file name helper, identical to {sf.SOURCE.as_posix()}; "
          "every download name on them comes from it and no file name is written into HTML.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
