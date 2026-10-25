#!/usr/bin/env python3
"""Extract a page's reviewable text into one JSON file for the pre-merge content audit.

Step 1 of the audit described in CLAUDE.md ("Shipping a new tool or post"):

    python scripts/audit_extract.py                  # pages added/changed vs main
    python scripts/audit_extract.py compress-image/index.html es/compress-image/index.html
    python scripts/audit_extract.py --base origin/main --out audit/out/review.json

The output keeps the schema of the Phase 12b and Hebrew calendar passes
(PRs #81-87, #136): `content_extraction_batch` with `style_rules`, then one
`content_block` record per block with record_id, pair_id, block_id, selector,
field_type, order, source_html, html_sha256, links, protected_tokens and
editable. To stay small enough to paste into one ChatGPT message, page-level
fields (page_path, source_file, canonical_url, lang, page_type) sit once per
page instead of on every block, and source_text, text_sha256 and the
context_before/after fields are left out (they repeated source_html).

What counts as a block: every heading, paragraph, list item, table cell,
figcaption, FAQ question and answer, CTA, related-card and blog-card text,
image alt text, SVG label and SVG text label inside the page content, plus
<title> and <meta name="description">. Phase 12 missed <li>, FAQ answers,
card blurbs and figcaptions; a block found nowhere else is reported as
"uncovered text" so nothing is silently skipped. Navigation, breadcrumbs,
footer, scripts and the tool's own controls (.workspace) are left out; pass
--include-ui to add the tool's controls as read-only blocks.

html_sha256 is the SHA-256 of the block's exact inner HTML (or attribute
value) as it is in the file. audit_apply.py re-extracts the live file and only
writes a block whose hash still matches.
"""

import argparse
import hashlib
import html
import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE = "https://orisod.com"
INSTRUCTIONS = REPO_ROOT / "audit" / "chatgpt-instructions.md"
NOT_PAGES = {".git", ".github", ".claude", "assets", "docs", "scripts", "audit", "node_modules", "prototypes", "claude"}

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
TEXT_BLOCKS = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "figcaption", "td", "th", "dt", "dd", "caption", "summary", "blockquote"}
SKIP = {"script", "style", "noscript", "template"}
LISTING = {"index.html", "tools/index.html", "blog/index.html",
           "es/index.html", "es/tools/index.html", "es/blog/index.html"}
GUIDE_LINK = ("Want the full picture?", "¿Quieres saber más?", "Lee nuestra guía")
ACRONYM = re.compile(r"\b(?:[A-Z][A-Z0-9]{1,}s?|[a-z]+[A-Z][A-Za-z]*|[A-Z][a-z]+[A-Z][A-Za-z]*)\b")


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def read(rel):
    """File text exactly as stored (newline="" keeps line endings, so offsets and hashes match the bytes)."""
    with open(REPO_ROOT / rel, encoding="utf-8", newline="") as fh:
        return fh.read()


def plain(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s))).strip()


def classes(attrs):
    return set((dict(attrs).get("class") or "").split())


class Node:
    __slots__ = ("tag", "attrs", "cls", "start", "inner", "end", "parent", "children", "nth", "counts", "text")

    def __init__(self, tag, attrs, start, inner, parent):
        self.tag, self.attrs, self.cls = tag, dict(attrs), classes(attrs)
        self.start, self.inner, self.end = start, inner, None
        self.parent, self.children, self.counts, self.text = parent, [], {}, False
        if parent is not None:
            parent.counts[tag] = parent.counts.get(tag, 0) + 1
            self.nth = parent.counts[tag]
            parent.children.append(self)
        else:
            self.nth = 1

    def has(self, *cls):
        return any(c in self.cls for c in cls)

    def up(self, pred):
        n = self.parent
        while n is not None:
            if pred(n):
                return n
            n = n.parent
        return None


class Tree(HTMLParser):
    """Element tree with exact source offsets (start of tag, start of inner HTML, start of end tag)."""

    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.src = text
        self.lines = [0]
        for m in re.finditer("\n", text):
            self.lines.append(m.end())
        self.root = Node("#root", [], 0, 0, None)
        self.stack = [self.root]
        self.errors = []
        self.feed(text)
        self.close()
        self.root.end = len(text)

    def pos(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def handle_starttag(self, tag, attrs):
        start = self.pos()
        raw = self.get_starttag_text()
        node = Node(tag, attrs, start, start + len(raw), self.stack[-1])
        if tag in VOID or raw.endswith("/>"):
            node.end = node.inner
        else:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        start = self.pos()
        raw = self.get_starttag_text()
        node = Node(tag, attrs, start, start + len(raw), self.stack[-1])
        node.end = node.inner

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        names = [n.tag for n in self.stack]
        if tag not in names[1:]:
            self.errors.append(f"stray </{tag}> at line {self.getpos()[0]}")
            return
        while self.stack[-1].tag != tag:
            n = self.stack.pop()
            self.errors.append(f"<{n.tag}> at line {self.src.count(chr(10), 0, n.start) + 1} is never closed")
            n.end = self.pos()
        self.stack.pop().end = self.pos()

    def handle_data(self, data):
        if data.strip():
            self.stack[-1].text = True

    def close(self):
        super().close()
        for n in self.stack[1:]:
            self.errors.append(f"<{n.tag}> at line {self.src.count(chr(10), 0, n.start) + 1} is never closed")
            n.end = len(self.src)

    def walk(self, node=None):
        node = node or self.root
        for c in node.children:
            yield c
            yield from self.walk(c)


def attr_span(src, node, name):
    """(start, end) of an attribute's raw value inside node's start tag."""
    tag = src[node.start:node.inner]
    m = re.search(r'\s%s\s*=\s*("([^"]*)"|\'([^\']*)\')' % re.escape(name), tag)
    if not m:
        return None
    g = 2 if m.group(2) is not None else 3
    return node.start + m.start(g), node.start + m.end(g)


def page_info(rel):
    rel = rel.replace("\\", "/")
    lang = "es" if rel.startswith("es/") else "en"
    path = "/" + rel[: -len("index.html")]
    base = rel[3:] if lang == "es" else rel
    slug = base[: -len("index.html")].strip("/") or "home"
    if base.startswith("blog/") and base != "blog/index.html":
        ptype = "guide"
    elif rel in LISTING:
        ptype = "listing"
    elif rel == "404.html":
        ptype = "page"
    else:
        ptype = None  # decided from the markup (tool pages have .seo-content)
    return {"page_path": path, "source_file": rel, "canonical_url": SITE + path,
            "lang": lang, "slug": slug.replace("/", "."), "page_type": ptype}


def protected(inner):
    toks = []
    for m in re.finditer(r"<code[^>]*>(.*?)</code>", inner, re.S):
        toks.append(html.unescape(m.group(1)))
    text = plain(inner)
    for m in ACRONYM.finditer(text):
        toks.append(m.group(0))
    if "Orisod" in text:
        toks.append("Orisod")
    seen = []
    for t in toks:
        if t not in seen:
            seen.append(t)
    return seen


def selector_of(node):
    parts = []
    n = node
    while n is not None and n.tag not in ("#root", "html", "body"):
        if n.cls:
            parts.append(n.tag + "." + ".".join(sorted(n.cls)) + f":nth-of-type({n.nth})")
        else:
            parts.append(f"{n.tag}:nth-of-type({n.nth})")
        if n.tag == "main" or n.has("container", "seo-content", "article-body", "related-section", "cta-box"):
            break
        n = n.parent
    return " > ".join(reversed(parts))


class Extractor:
    def __init__(self, rel, text, include_ui=False, card_hrefs=None):
        self.rel, self.src, self.tree = rel, text, Tree(text)
        self.info = page_info(rel)
        self.include_ui = include_ui
        self.card_hrefs = card_hrefs  # listing pages: only cards linking to these hrefs
        if self.info["page_type"] is None:
            seo = any(n.has("seo-content") for n in self.tree.walk())
            self.info["page_type"] = "tool" if seo else "page"
        self.blocks, self.uncovered, self.counts = [], [], {}

    # --- helpers -------------------------------------------------------
    def add(self, block_id, field_type, span, node, editable=True, note=None, also=None):
        raw = self.src[span[0]:span[1]]
        info = self.info
        rec = {
            "record_type": "content_block",
            "record_id": f"{info['slug']}.{info['lang']}.{block_id}",
            "pair_id": f"{info['slug']}.{block_id}",
            "block_id": block_id,
            "selector": selector_of(node) if node is not None else field_type,
            "field_type": field_type,
            "order": len(self.blocks),
            "source_html": raw,
            "html_sha256": sha(raw),
            "links": re.findall(r'href="([^"]*)"', raw),
            "protected_tokens": protected(raw),
            "editable": editable,
        }
        if note:
            rec["note"] = note
        rec["_span"] = span
        rec["_also"] = also or []  # other spans that must receive the same text (SVG <title>)
        self.blocks.append(rec)

    def next_id(self, region, kind):
        key = (region, kind)
        self.counts[key] = self.counts.get(key, 0) + 1
        return f"{region}.{kind}_{self.counts[key]:02d}"

    def region(self, node):
        n = node
        while n is not None:
            if n.has("faq-item"):
                return "faq"
            if n.has("cta-box"):
                return "cta"
            if n.has("related-grid", "related-section"):
                return "related"
            if n.has("seo-content"):
                return "seo"
            if n.has("article-body"):
                return "body"
            if n.has("workspace"):
                return "ui"
            n = n.parent
        return "main"

    # --- extraction ----------------------------------------------------
    def run(self):
        self.head()
        content = self.content_root()
        if content is not None:
            self.visit(content)
        return self

    def head(self):
        head = next((n for n in self.tree.walk() if n.tag == "head"), None)
        if head is None:
            return
        for n in self.tree.walk(head):
            if n.tag == "title" and not any(b["block_id"] == "head.title" for b in self.blocks):
                self.add("head.title", "title", (n.inner, n.end), n,
                         note="Wording is locked: only capitalization and punctuation may change.")
            if n.tag == "meta" and n.attrs.get("name") == "description":
                span = attr_span(self.src, n, "content")
                if span:
                    self.add("head.meta_description", "meta_description", span, n,
                             note="Wording is locked: only capitalization and punctuation may change.")

    def content_root(self):
        main = next((n for n in self.tree.walk() if n.tag == "main"), None)
        if main is not None:
            return main
        body = next((n for n in self.tree.walk() if n.tag == "body"), None)
        return body

    def skipped(self, n):
        if n.tag in SKIP or n.tag in ("header", "footer", "form", "button", "select", "input", "textarea"):
            return True
        if n.tag == "nav" or n.has("breadcrumbs", "site-nav", "site-footer"):
            return True
        if n.has("workspace") and not self.include_ui:
            return True
        if n.attrs.get("hidden") is not None or n.attrs.get("aria-hidden") == "true" and n.tag != "svg":
            return True
        return False

    def is_block(self, n):
        if n.tag in TEXT_BLOCKS:
            return True
        if n.tag == "div" and n.parent is not None and n.parent.has("faq-item"):
            return True
        if n.has("title", "desc", "tool-sub", "intro", "tool-card-title", "tool-card-desc", "name",
                 "cta-button", "blog-cat", "back-link", "read-more", "note", "trust-strip", "disclaimer"):
            return True
        if n.tag == "label" and self.include_ui:
            return True
        return False

    def contains_block(self, n):
        return any(self.is_block(c) and not self.skipped(c) for c in self.tree.walk(n))

    def listing_card(self, n):
        """On listing pages, the card (a.tool-card / a.blog-card) a node sits in, or None."""
        return n if n.tag == "a" and n.has("tool-card", "blog-card", "card") else n.up(
            lambda p: p.tag == "a" and p.has("tool-card", "blog-card", "card"))

    def visit(self, node):
        for n in node.children:
            if self.skipped(n):
                continue
            if self.info["page_type"] == "listing":
                card = self.listing_card(n)
                if card is None:
                    if n.tag == "a" or not any(self.listing_card(c) for c in self.tree.walk(n)):
                        continue  # listing pages: only the cards of pages under review
                elif self.card_hrefs is not None and card.attrs.get("href") not in self.card_hrefs:
                    continue
            if n.tag == "img":
                alt = n.attrs.get("alt")
                if alt:
                    self.add(self.next_id(self.region(n), "alt"), "alt_text", attr_span(self.src, n, "alt"), n)
                continue
            if n.tag == "svg":
                self.svg(n)
                continue
            if self.is_block(n) and not self.contains_block(n):
                self.block(n)
                continue
            if (n.text and not self.is_block(n) and n.tag not in ("a", "span", "strong", "em", "code", "b", "i")
                    and re.search(r"[^\W\d_]", plain(self.src[n.inner:n.end]))):
                self.uncovered.append(f"{n.tag} {selector_of(n)}: {plain(self.src[n.inner:n.end])[:60]}")
            self.visit(n)

    def svg(self, n):
        region = self.region(n)
        label = n.attrs.get("aria-label")
        title = next((c for c in n.children if c.tag == "title"), None)
        if label:
            also = []
            if title is not None and plain(self.src[title.inner:title.end]) == html.unescape(label):
                also = [(title.inner, title.end)]
            self.add(self.next_id(region, "svg_label"), "svg_label", attr_span(self.src, n, "aria-label"), n,
                     note="Also written to the SVG's <title> when they match." if also else None, also=also)
        elif title is not None and plain(self.src[title.inner:title.end]):
            self.add(self.next_id(region, "svg_label"), "svg_label", (title.inner, title.end), title)
        for t in self.tree.walk(n):
            if t.tag == "text" and re.search(r"[A-Za-zÀ-ÿ]{2}", plain(self.src[t.inner:t.end])):
                self.add(self.next_id(region, "svg_text"), "svg_text", (t.inner, t.end), t,
                         note="Short label drawn inside a diagram: keep it about the same length.")

    def block(self, n):
        inner = self.src[n.inner:n.end]
        text = plain(inner)
        if not text:
            return
        region, editable, note = self.region(n), True, None
        listing = self.info["page_type"] == "listing"
        if n.tag == "h1":
            bid, ftype = "h1", "heading"
            if self.info["page_type"] == "tool":
                editable, note = False, "Tool name: also used in breadcrumbs, JSON-LD, /tools and related cards."
        elif n.has("tool-sub"):
            bid, ftype = "tool_sub", "body_html"
        elif n.has("intro"):
            bid, ftype = "intro", "body_html"
        elif region == "faq":
            item = n.up(lambda p: p.has("faq-item"))
            idx = item.parent.children.index(item)
            num = sum(1 for c in item.parent.children[: idx + 1] if c.has("faq-item"))
            if n.has("q"):
                bid, ftype = f"faq.q_{num:02d}", "faq_question"
            else:
                bid, ftype = self.next_id(f"faq.a_{num:02d}", "part") if n.tag == "p" else f"faq.a_{num:02d}", "faq_answer"
        elif n.has("blog-cat"):
            bid, ftype, editable, note = "category_badge", "label", False, "Category label (Guides/Tips/Comparisons)."
        elif n.has("back-link", "read-more"):
            bid, ftype, editable, note = self.next_id(region, "nav_link"), "label", False, "Fixed navigation label."
        elif n.has("cta-button"):
            bid, ftype = "cta.button", "label"
        elif listing:
            card = self.listing_card(n)
            key = (card.attrs.get("href") or "").strip("/").replace("/", ".") or "home"
            kind = "title" if n.tag in ("h2", "h3") or n.has("title", "name", "tool-card-title") else "desc"
            bid, ftype = f"card.{key}.{kind}", "card_title" if kind == "title" else "card_desc"
            if kind == "title" and n.has("name", "tool-card-title"):
                editable, note = False, "Tool name."
        elif region == "related":
            card = n.up(lambda p: p.tag == "a" and p.has("related-card", "blog-card"))
            if card is None:
                bid, ftype = self.next_id(region, n.tag), "heading" if n.tag[0] == "h" else "body_html"
            else:
                key = (card.attrs.get("href") or "").strip("/").replace("/", ".")
                kind = "title" if n.tag in ("h2", "h3") or n.has("title") else "desc"
                src = "the /tools card" if card.has("related-card") else "that post's blog index card"
                bid, ftype = f"related.{key}.{kind}", "card_title" if kind == "title" else "card_desc"
                editable, note = False, f"Copy of {src}: change it there, then copy it here."
        elif region == "ui":
            bid, ftype, editable, note = self.next_id(region, n.tag), "ui_text", False, "Tool control text (read-only)."
        else:
            kind = n.tag if n.tag in TEXT_BLOCKS else "text"
            bid = (f"{region}.heading" if region == "cta" and n.tag[0] == "h" else self.next_id(region, kind))
            ftype = "heading" if n.tag[0] == "h" and n.tag[1:].isdigit() else ("list_item" if n.tag == "li" else "body_html")
        if any(g in text for g in GUIDE_LINK):
            editable, note = False, "Link to this tool's guide: keep it exactly as it is."
        elif re.fullmatch(r"\s*(<code[^>]*>.*?</code>\s*)+", inner, re.S) or n.tag == "pre":
            editable, note = False, "Code: not prose."
        self.add(bid, ftype, (n.inner, n.end), n, editable, note)


def extract_file(rel, include_ui=False, card_hrefs=None, text=None):
    if text is None:
        text = read(rel)
    return Extractor(rel, text, include_ui, card_hrefs).run()


def changed_pages(base):
    """HTML pages added or changed vs base (committed, staged, unstaged and untracked)."""
    out = subprocess.run(["git", "diff", "--name-only", "--diff-filter=AMR", f"{base}...HEAD"],
                         cwd=REPO_ROOT, capture_output=True, text=True, check=True).stdout.split()
    out += subprocess.run(["git", "diff", "--name-only", "--diff-filter=AMR", "HEAD"],
                          cwd=REPO_ROOT, capture_output=True, text=True, check=True).stdout.split()
    out += subprocess.run(["git", "ls-files", "--others", "--exclude-standard"],
                          cwd=REPO_ROOT, capture_output=True, text=True, check=True).stdout.split()
    pages = []
    for f in out:
        f = f.replace("\\", "/")
        if f.endswith(".html") and f.split("/")[0] not in NOT_PAGES and f not in pages and (REPO_ROOT / f).exists():
            pages.append(f)
    return sorted(pages)


def style_rules():
    """The '- ' bullets under '## Rules' in audit/chatgpt-instructions.md."""
    if not INSTRUCTIONS.exists():
        return []
    text = INSTRUCTIONS.read_text(encoding="utf-8")
    m = re.search(r"^## Rules\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not m:
        return []
    return [re.sub(r"\s+", " ", b).strip() for b in re.findall(r"^- (.*?)(?=^- |\Z)", m.group(1), re.M | re.S)]


def public(rec):
    return {k: v for k, v in rec.items() if not k.startswith("_")}


def build(files, include_ui=False):
    files = [f.replace("\\", "/") for f in files]
    hrefs = {page_info(f)["page_path"] for f in files if f not in LISTING}
    pages, blocks, notes = [], [], []
    for rel in files:
        ex = extract_file(rel, include_ui, card_hrefs=hrefs if rel in LISTING else None)
        info = {k: ex.info[k] for k in ("page_path", "source_file", "canonical_url", "lang", "page_type")}
        info["block_count"] = len(ex.blocks)
        pages.append(info)
        blocks += [public(b) for b in ex.blocks]
        notes += [f"{rel}: {e}" for e in ex.tree.errors]
        notes += [f"{rel}: uncovered text in {u}" for u in ex.uncovered]
        if rel in LISTING and not ex.blocks:
            notes.append(f"{rel}: no card links to a page in this batch, nothing extracted")
    batch = {
        "record_type": "content_extraction_batch",
        "source_snapshot_id": "orisod-" + subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT,
                                                         capture_output=True, text=True).stdout.strip(),
        "editorial_policy": "orisod-humanization-v2",
        "allow_em_dash": False,
        "style_rules": style_rules(),
        "how_to_answer": ("Return this same JSON. For each block you change, add \"replacement_html\" (the new inner "
                          "HTML) and \"change_reason\". Leave every other field exactly as it is, and leave out "
                          "replacement_html on blocks you don't change or that have \"editable\": false."),
        "pages": pages,
        "blocks": blocks,
    }
    return batch, notes


def dump(batch):
    """Readable but compact: header indented, one block per line."""
    head = {k: v for k, v in batch.items() if k not in ("pages", "blocks")}
    lines = json.dumps(head, indent=1, ensure_ascii=False)[:-2]
    lines += ',\n "pages": [\n  ' + ",\n  ".join(json.dumps(p, ensure_ascii=False) for p in batch["pages"]) + "\n ],"
    lines += '\n "blocks": [\n  ' + ",\n  ".join(json.dumps(b, ensure_ascii=False) for b in batch["blocks"]) + "\n ]\n}\n"
    return lines


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("files", nargs="*", help="pages to extract (default: HTML pages added/changed vs --base)")
    ap.add_argument("--base", default="main", help="branch to compare against (default: main)")
    ap.add_argument("--out", default="audit/out/review.json", help="output file (default: audit/out/review.json)")
    ap.add_argument("--include-ui", action="store_true", help="also list the tool's control text, read-only")
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    files = args.files or changed_pages(args.base)
    if not files:
        print(f"No HTML pages added or changed vs {args.base}. Pass files explicitly to extract other pages.")
        return 0
    batch, notes = build(files, args.include_ui)
    out = REPO_ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    text = dump(batch)
    out.write_text(text, encoding="utf-8")

    for p in batch["pages"]:
        print(f"  {p['source_file']:<55} {p['page_type']:<8} {p['block_count']:>4} blocks")
    editable = sum(1 for b in batch["blocks"] if b["editable"])
    print(f"{len(batch['blocks'])} blocks ({editable} editable) from {len(files)} page(s) -> {args.out} "
          f"({len(text.encode('utf-8')) / 1024:.0f} KB)")
    if len(text.encode("utf-8")) > 120 * 1024:
        print("Note: over 120 KB. If ChatGPT cuts it off, extract fewer pages per file (e.g. EN and ES separately).")
    for n in notes:
        print("  ! " + n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
