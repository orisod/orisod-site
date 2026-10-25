#!/usr/bin/env python3
"""Apply a reviewed audit JSON back to the pages, only where it is safe.

Step 3 of the audit described in CLAUDE.md ("Shipping a new tool or post"):

    python scripts/audit_apply.py audit/out/review.reviewed.json           # dry run (default)
    python scripts/audit_apply.py audit/out/review.reviewed.json --write   # then write

Input is the JSON audit_extract.py wrote, returned by the reviewer with
"replacement_html" on the blocks they changed (the older "new_html" field from
the Phase 12b packages and JSONL files work too).

Every page is extracted again from the live file, and a block is written only
when all of these hold, otherwise it is reported and left alone:
  - the record's block exists on the page and its source_html still hashes to
    html_sha256, and that hash matches the live page (no drift, no tampering);
  - the live block is editable (the JSON's own "editable" field is not trusted);
  - for <title> and <meta name="description">, the words are the same: only
    capitalization and punctuation may change;
  - the replacement keeps every tag, attribute and link of the original in the
    same order, keeps <code> contents and protected tokens, and has no em dash.

Counts: changed, unchanged, excluded (not editable, or title/meta wording
changed), rejected (failed a safety check) and mismatched (block missing or
hash mismatch). --write refuses to write anything while any block is rejected
or mismatched.

Twins are kept in step automatically: a title change also updates og:title, a
meta description change og:description and the JSON-LD description, a post H1
change the BlogPosting headline, and FAQ changes the FAQPage JSON-LD.
"""

import argparse
import hashlib
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_extract import LISTING, REPO_ROOT, extract_file, page_info, plain, read  # noqa: E402

WORDING_LOCKED = {"title", "meta_description"}
ATTRIBUTE_FIELDS = {"meta_description", "alt_text", "svg_label"}
TAG = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>")


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def words(s):
    """Lowercased word sequence: what must stay the same in a wording-locked field."""
    return re.findall(r"[^\W_]+", plain(s).lower())


def tags(s):
    return [(m.group(1), m.group(2).lower(), re.sub(r"\s+", " ", m.group(3)).strip()) for m in TAG.finditer(s)]


def load(path):
    text = Path(path).read_text(encoding="utf-8-sig")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = [json.loads(line) for line in text.splitlines() if line.strip()]  # JSONL
    if isinstance(data, dict):
        return data.get("pages", []), data.get("blocks", [])
    pages = [r for r in data if r.get("record_type") not in ("content_block",)]
    return pages, [r for r in data if r.get("record_type") == "content_block"]


def resolve_files(pages, blocks):
    """record_id -> source file, from the pages list (or the record's own source_file in older packages)."""
    prefixes = []
    for p in pages:
        if "source_file" in p:
            info = page_info(p["source_file"])
            prefixes.append((f"{info['slug']}.{info['lang']}.", p["source_file"]))
    prefixes.sort(key=lambda x: -len(x[0]))
    out = {}
    for b in blocks:
        rid = b.get("record_id", "")
        f = b.get("source_file")
        if not f:
            f = next((src for pre, src in prefixes if rid.startswith(pre)), None)
        out[rid] = f
    return out


def check_replacement(rec, live, new):
    """None if the replacement is safe to write, else the reason it isn't."""
    old = live["source_html"]
    if "—" in new:
        return "contains an em dash"
    if rec["field_type"] in ATTRIBUTE_FIELDS or rec["field_type"] in ("title", "svg_text"):
        if "<" in new or ">" in new:
            return "this field is plain text: no tags allowed"
        if rec["field_type"] in ATTRIBUTE_FIELDS and '"' in new and "&quot;" not in old:
            return 'contains a double quote, which would end the HTML attribute (use &quot; or a single quote)'
    elif tags(new) != tags(old):
        return "tags, attributes or links differ from the original (keep the same markup, only change the words)"
    if re.findall(r'href="([^"]*)"', new) != re.findall(r'href="([^"]*)"', old):
        return "links differ from the original"
    old_code = re.findall(r"<code[^>]*>(.*?)</code>", old, re.S)
    if re.findall(r"<code[^>]*>(.*?)</code>", new, re.S) != old_code:
        return "text inside <code> changed"
    lost = [t for t in live["protected_tokens"] if t not in plain(new) and t not in old_code]
    if lost:
        return "drops protected term(s): " + ", ".join(lost)
    if not plain(new):
        return "replacement is empty"
    return None


def json_variants(s):
    yield json.dumps(s, ensure_ascii=False)
    yield json.dumps(s, ensure_ascii=False).replace("<", "\\u003c")
    yield json.dumps(s)


def twin_edits(text, rec, new, problems):
    """Extra (start, end, replacement) edits that keep og: tags and JSON-LD in step with a changed block."""
    edits = []
    ft, bid, old = rec["field_type"], rec["block_id"], rec["source_html"]

    def og(prop):
        m = re.search(r'<meta property="%s" content="([^"]*)"' % re.escape(prop), text)
        if m and m.group(1) == old:
            edits.append((m.start(1), m.end(1), new))
        elif m:
            problems.append(f"{prop} didn't match the old text, so it was not updated: fix it by hand")

    def jsonld(old_text, new_text, what, required=True):
        found = 0
        for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', text, re.S):
            body, base = m.group(1), m.start(1)
            for enc_old, enc_new in zip(json_variants(old_text), json_variants(new_text)):
                hits = [h.start() for h in re.finditer(re.escape(enc_old), body)]
                if hits:
                    edits.extend((base + h, base + h + len(enc_old), enc_new) for h in hits)
                    found += len(hits)
                    break
        if required and not found:
            problems.append(f"couldn't find the JSON-LD {what} to update: fix it by hand")

    if ft == "title":
        og("og:title")
    elif ft == "meta_description":
        og("og:description")
        jsonld(html.unescape(old), html.unescape(new), "description", required=False)
    elif bid == "h1":
        jsonld(plain(old), plain(new), "headline/name")
    elif ft in ("faq_question", "faq_answer") and bid.count(".") == 1:
        jsonld(plain(old), plain(new), "FAQ text")
    return edits


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("review", help="the reviewed JSON (or JSONL) file")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True, help="report only (default)")
    mode.add_argument("--write", action="store_true", help="write the changes to the pages")
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    pages, blocks = load(args.review)
    files = resolve_files(pages, blocks)
    page_files = sorted({f for f in files.values() if f})
    hrefs = {page_info(f)["page_path"] for f in page_files if f not in LISTING}
    include_ui = any(b.get("field_type") == "ui_text" for b in blocks)

    counts = {"changed": 0, "unchanged": 0, "excluded": 0, "rejected": 0, "mismatched": 0}
    report = []
    edits = {f: [] for f in page_files}
    texts, live = {}, {}
    for f in page_files:
        if not (REPO_ROOT / f).exists():
            continue
        texts[f] = read(f)
        ex = extract_file(f, include_ui, card_hrefs=hrefs if f in LISTING else None, text=texts[f])
        live[f] = {b["block_id"]: b for b in ex.blocks}

    for rec in blocks:
        rid = rec.get("record_id", "?")
        f = files.get(rid)
        new = rec.get("replacement_html", rec.get("new_html"))

        def note(kind, why):
            counts[kind] += 1
            report.append((kind, rid, why))

        if not f or f not in live:
            note("mismatched", "page not found")
            continue
        cur = live[f].get(rec.get("block_id"))
        if cur is None:
            note("mismatched", "block no longer exists on the page")
            continue
        if sha(rec.get("source_html", "")) != rec.get("html_sha256"):
            note("mismatched", "source_html was edited: it no longer matches its html_sha256")
            continue
        if rec["html_sha256"] != cur["html_sha256"] or rec.get("expected_html_sha256", cur["html_sha256"]) != cur["html_sha256"]:
            note("mismatched", "the page changed since extraction (hash differs): extract again")
            continue
        if new is None or new == cur["source_html"]:
            counts["unchanged"] += 1
            continue
        if not cur["editable"]:
            note("excluded", "not editable" + (f" ({cur['note']})" if cur.get("note") else ""))
            continue
        if cur["field_type"] in WORDING_LOCKED and words(new) != words(cur["source_html"]):
            note("excluded", "title/meta wording is locked: only capitalization and punctuation may change")
            continue
        why = check_replacement(cur, cur, new)
        if why:
            note("rejected", why)
            continue
        problems = []
        twins = twin_edits(texts[f], cur, new, problems)
        if problems:
            note("rejected", "; ".join(problems))
            continue
        start, end = cur["_span"]
        edits[f].append((start, end, new))
        for s, e in cur["_also"]:
            edits[f].append((s, e, new))
        edits[f].extend(twins)
        counts["changed"] += 1
        report.append(("changed", rid, f"+{len(twins)} twin update(s)" if twins else ""))

    for kind, rid, why in report:
        if kind != "changed" or why:
            print(f"  {kind:<10} {rid}" + (f": {why}" if why else ""))
    print("changed {changed}, unchanged {unchanged}, excluded {excluded}, rejected {rejected}, "
          "mismatched {mismatched}".format(**counts))

    if not args.write:
        print("Dry run: nothing written. Run again with --write to apply the changed blocks.")
        return 1 if counts["rejected"] or counts["mismatched"] else 0
    if counts["rejected"] or counts["mismatched"]:
        print("Not written: fix the rejected/mismatched blocks first (or extract again if the pages changed).")
        return 1
    written = 0
    for f, items in edits.items():
        if not items:
            continue
        items.sort(key=lambda e: e[0])
        for a, b in zip(items, items[1:]):
            if a[1] > b[0]:
                print(f"Not written: two edits overlap in {f}. Nothing was changed.")
                return 1
        text = texts[f]
        for s, e, new in reversed(items):
            text = text[:s] + new + text[e:]
        with open(REPO_ROOT / f, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        written += 1
    print(f"Wrote {written} file(s). Next: python scripts/verify_new_content.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
