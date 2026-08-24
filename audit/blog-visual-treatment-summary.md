# Blog Visual Treatment — Inventory Summary (v2)

Source: `audit/blog-visual-treatment-inventory-v2.jsonl` — 42 records, one per EN/ES post pair. This is the v1 inventory (`blog-visual-treatment-inventory.jsonl`, kept for reference, unmodified) with ChatGPT's editorial/technical review (`blog-visual-treatment-review.md` + `blog-visual-treatment-review-decisions.jsonl`) applied on top: global policies first, then 35 per-post revisions, then the pilot replacement. Read-only reconciliation — nothing has been built.

## What changed vs. v1

- **Precision:** 4 diagrams moved `illustrative → exact` (`extract-text-from-pdf`, `how-to-make-a-qr-code`, `fix-sideways-photo`, `pdf-page-to-image`) because they depict a factual, verifiable mechanism, not a freeform concept. One moved the other way (`what-is-exif-data` → `illustrative`, redesigned as a text-free symbolic illustration — see below).
- **`fix-sideways-photo` and `what-is-exif-data` swapped production pathways.** `fix-sideways-photo`'s EXIF-orientation mechanism is a well-defined, verifiable spec, so it moved to `hybrid`/`svg`/`exact`. `what-is-exif-data`'s hidden-metadata example values (GPS, timestamp, device model) are exactly the kind of factual-looking data that shouldn't be freehand-generated, so it moved the other way, to `chatgpt-imagegen`/`raster-illustration`/`illustrative`, redesigned to carry no numbers or labels at all — icons only.
- **Theme handling: 10 records forced to `shared`.** Before-after composites, one photo-crop comparison (`png-vs-jpg`), and the two now-illustrative/SVG diagrams don't need to react to the site's theme toggle — only real Orisod interface screenshots do. Net effect: 27 shared / 15 separate-light-dark, down from 17/25 in v1 — the "every bitmap needs two versions" rule from v1 was broader than necessary.
- **New field: `primary_visual.accessible_equivalent`** (`html-table | adjacent-text-summary | nearby-prose | none`) on every record. `precise-comparison` and `reference-sheet` require `html-table` — an image's `alt` text was never meant to carry a full data table. Diagrams that assert real values get `adjacent-text-summary`; screenshots and before-afters get `nearby-prose` (the surrounding article text already carries the explanation); purely illustrative pieces with no asserted facts get `none`.
- **`verification_requirements` standardized into 5 reusable profiles** (`tool-ui-capture-v1`, `same-source-output-v1`, `reproducible-benchmark-v1`, `authoritative-current-spec-v1`, `source-backed-mechanism-v1` — full rule text in the JSONL and in `blog-visual-treatment-review.md` §3) instead of 42 independent, sometimes-thin notes. Several v1 notes that only said "confirm the article's numbers" were replaced with real reproducibility requirements (source asset, encoder/version, equivalent-quality criterion, test date, "label as this example, not a universal guarantee"). Where a v1 note covered something the profile doesn't (e.g. `blur-face-in-photo`'s requirement to use a synthetic/model-released subject, not a real identifiable person), it was kept alongside the profile, not dropped.
- **`compress-pdf-without-losing-quality` is now `"status": "blocked"`, not a numbered priority.** `priority` is `null`. Its caption fields were nulled out (`reject_current_copy`) rather than left as-is, since the reviewer flagged the specific invented 35MB/"perfect legibility" claim in the old caption as unsafe to keep even as a placeholder.
- **Two priority downgrades:** `find-color-code-from-image` and `how-to-make-a-qr-code` moved P1 → P2 — both are clear and useful, but neither is as load-bearing as a post built entirely around an unillustrated comparison.
- **~20 caption/alt text corrections** — mostly softening absolute claims into example-scoped ones (`"WebP is smaller"` → `"In this example, WebP uses 25–35% less data"`), per the review's editorial pass. Full list in `blog-visual-treatment-review.md` §7.
- **7 posts unchanged beyond the global policies** (`svg-to-png-guide`, `change-pdf-page-size`, `check-image-dimensions`, `crop-photo-exact-size`, `html-to-pdf-guide`, `reorder-delete-pdf-pages`, `rotate-pdf-pages`) — not mentioned in any post_review record, per the decisions file's `unlisted_post_rule`. They still received `accessible_equivalent` and, where applicable, the theme policy.
- **Secondary visuals are still description-only placeholders** (11 records carry one). Per the `secondary_visuals` policy: not to be built in the pilot round, and need to be expanded to the full `primary_visual` schema (type, insertion point, owner, precision, etc.) before anyone builds one — that expansion is new design work, out of scope for this reconciliation pass.

## Counts (v2)

**By priority / status**

| Priority | Count | Meaning |
|---|---|---|
| 1 | 13 | A complementary chart belongs next to an existing table, or the post is built around a comparison/mechanism that's currently unillustrated |
| 2 | 26 | Solid, standard value |
| 3 | 2 | Lower marginal value |
| blocked | 1 | `compress-pdf-without-losing-quality` — source article needs a copy fix first |

**By visual type** (unchanged from v1 — the reviewer found no post whose type was misclassified)

| Type | Count |
|---|---|
| interface-screenshot | 15 |
| conceptual-diagram | 10 |
| precise-comparison | 7 |
| before-after | 7 |
| reference-sheet | 3 |

**By owner / method**

| Owner | Count | Method |
|---|---|---|
| code-playwright | 23 | screenshot |
| hybrid | 16 | svg |
| chatgpt-imagegen | 2 | raster-illustration |
| code-svg | 1 | svg |

**By precision**

| Precision | Count |
|---|---|
| exact | 40 |
| illustrative | 2 |

**By localization**

| Localization | Count |
|---|---|
| requires-en-es-versions | 28 |
| language-neutral | 14 |

**By theme handling**

| theme_variants | Count |
|---|---|
| shared | 27 |
| separate-light-dark | 15 |

**By accessible_equivalent** (new)

| Value | Count |
|---|---|
| nearby-prose | 23 |
| html-table | 10 |
| adjacent-text-summary | 7 |
| none | 2 |

**Other**

- 11 records carry an optional `secondary_visual` (unchanged — still description-only, see above)
- 36 of 42 records now carry at least one `verification_requirements` entry (up from 16 in v1)

## Exceptions — flagged separately from the ranked inventory

### 1. Four posts already have a table in this section — the visual is complementary, not a section-filler

**Correction:** earlier versions of this document (and the inventory itself) described these four headings as empty, on the theory that the prose was written assuming a chart would sit directly under them with nothing else there. That was wrong. All four headings already contain a real `<table class="compare-table">` with example figures in the live article, plus in most cases a following sentence. The "empty" claim came from a bug in the script that built the original inventory: it only extracted `<p>`/`<ul>` content after each `<h2>` and silently dropped any `<table>` content, so these sections looked bare when they weren't. Fixed in `blog-visual-treatment-inventory-v2.jsonl` — each record's `notes`, `educational_goal`, and the affected `verification_requirements` entry now describe this accurately.

These four are still good P1 candidates — a real chart genuinely adds something a plain HTML table doesn't (at-a-glance visual comparison) — just for the corrected reason: **add a complementary chart next to the existing table**, not fill an empty section.

| Slug | Heading (already has a table) | Visual type |
|---|---|---|
| `avif-format-explained` | "AVIF vs WebP vs JPG at a glance" | precise-comparison |
| `shrink-bmp-files` | "File size side by side" | precise-comparison |
| `webp-vs-jpg` | "WebP vs JPG at a glance" | precise-comparison |
| `social-media-image-sizes-2026` | "Current recommended sizes (2026)" | reference-sheet |

The review's `accessible_equivalent: html-table` call for all four turns out to be exactly right, just for a reason the review didn't know at the time: the table isn't a *new* accessibility requirement to build — it already exists in the article. The chart sits alongside it as a visual complement.

### 2. `compress-pdf-without-losing-quality` — now formally blocked, not a visual-inventory item

Confirmed by the review. This post's copy predates the Quick clean / Strong compression mode split. It keeps a `primary_visual` record in the JSONL for structural completeness (all 42 slugs get one), but `"status": "blocked"`, `"priority": null`, and its caption fields are `null` — the reviewer specifically rejected the old caption's invented 35MB example and "stays fully legible" claim rather than leaving them in place as a placeholder. **Do not build this visual, and do not include it in any pilot or build list, until the article's copy is updated to reflect the current tool.**

## Recommended pilot posts (replaces the v1 proposal entirely)

The v1 pilot list is superseded — the review found it didn't cover what it claimed to (three owners instead of four, no `before-after`, two `precise-comparison` rows). New five:

1. **`shrink-bmp-files`** — precise-comparison / hybrid+svg / exact / EN+ES / shared / complements an existing table. ChatGPT-specified composition, reproducible-benchmark data, SVG build.
2. **`social-media-image-sizes-2026`** — reference-sheet / hybrid+svg+html-table / exact / EN+ES / shared / complements an existing table. Volatile real-world data, authoritative sourcing, and the semantic-HTML-table-plus-SVG pattern together.
3. **`find-color-code-from-image`** — interface-screenshot / code-playwright / exact / EN+ES / separate-light-dark. Real tool capture, the most common owner/method pair (23 of 42 records) and the only pilot needing two theme variants.
4. **`what-is-exif-data`** — conceptual-diagram / chatgpt-imagegen / illustrative / language-neutral / shared. The freeform-illustration pathway, redesigned text-free so it's genuinely safe to generate without inventing facts.
5. **`resize-image-without-distorting`** — before-after / code-playwright, real tool output / exact / language-neutral / shared. The only before-after pilot, and a reusable shared bitmap composite.

**Optional 6th, only if needed:** `svg-to-png-guide` (`code-svg`, conceptual-diagram, exact, shared) — add only if the `code-svg` owner label needs its own validation separate from the technically-identical `hybrid` SVG pipeline it otherwise shares.

**Two removals from the old pilot, with reasons from the review:**
- `extract-image-from-gif` — dropped in favor of `what-is-exif-data`, now the higher-priority conceptual-diagram pilot after its text-free redesign.
- `jpg-to-webp-guide` — dropped: duplicates the `precise-comparison` pattern already covered by `shrink-bmp-files`, and adds secondary-visual complexity before the basic pattern is validated.

This set covers all five visual types, all four owner/method pathways, and both theme-handling cases in five posts — `compress-pdf-without-losing-quality` and the other two posts with an existing table awaiting a complementary chart (`avif-format-explained`, `webp-vs-jpg`) stay out of the pilot: the former is blocked, the latter two are next in line once the `hybrid`/`precise-comparison` pathway is validated by `shrink-bmp-files`.
