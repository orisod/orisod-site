# Orisod — Project Context for Claude Code

## Permanent rules

**Always run `git pull` at the start of every session before making changes**, since manual edits sometimes happen directly on GitHub's web editor.

**Never commit or push directly to `main`.** Every change, without exception, goes through: create a feature branch → commit → push the branch → open a PR → wait for CI to pass → merge only after the user explicitly approves the merge. This applies regardless of how the request is phrased (e.g. "commit this," "push it") — those instructions mean "do it via the branch/PR flow," not "commit straight to main." If a step in this flow seems to conflict with a direct instruction, stop and confirm with the user rather than defaulting to the direct-to-main path.

## What this project is

Orisod (orisod.com) is a free, browser-based toolkit for images and PDFs — think a lighter, privacy-first alternative to iLovePDF/TinyWow. Static HTML site, deployed via GitHub Pages, folder-based routing (`/tool-name/index.html`).

**Core brand promise:** everything runs 100% client-side in the browser. Files are never uploaded to any server. This is the main differentiator and is mentioned explicitly on the home page and in every tool's FAQ section.

**Contact:** orisod.lab@gmail.com (JS-obfuscated on the site to avoid scraper bots — never hardcode it as plain `mailto:` text in HTML)

## Tech stack

- Plain HTML/CSS/JS, no build step, no framework
- Google Analytics 4 installed site-wide (measurement ID `G-V2GMNDCVMK`) — same snippet must be in `<head>` of every page
- CDN libraries used depending on the tool:
  - **PDF.js** (`pdf.js/3.11.174/pdf.min.js`) — rendering/rasterizing PDF pages
  - **jsPDF** (`jspdf/2.5.1/jspdf.umd.min.js`) — building PDFs from images
  - **pdf-lib** (`pdf-lib/1.17.1/pdf-lib.min.js`) — real PDF manipulation (merge, split, rotate, reorder, page numbers) that preserves text/vector content instead of rasterizing
  - **heic2any** (`heic2any/0.0.4/heic2any.min.js`) — real HEIC decoding
  - **JSZip** (`jszip/3.10.1/jszip.min.js`) — packaging multi-file downloads as ZIP; also used to open .pptx files (themselves a zip of XML) for PowerPoint to PDF's text extraction
  - **qrcodejs** (`qrcodejs/1.0.0/qrcode.min.js`) — QR generation
  - **html2canvas** (`html2canvas/1.4.1/html2canvas.min.js`) — rasterizing rendered HTML/DOM to canvas (used with jsPDF for HTML to PDF and Word to PDF)
  - **docx** (`docx@9.7.1/dist/index.iife.js`) — building .docx Word files client-side (used for PDF to Word). Not on cdnjs (confirmed unavailable there); loaded from jsdelivr instead (`cdn.jsdelivr.net/npm/docx@9.7.1/dist/index.iife.js`), exposing a global `docx` object (`docx.Document`, `docx.Paragraph`, `docx.Packer`, etc.).
  - **mammoth** (`mammoth@1.12.1/mammoth.browser.min.js`) — converting .docx content to HTML client-side (used for Word to PDF, piped into the html2canvas/jsPDF rasterize pipeline). Also not on cdnjs; loaded from jsdelivr (`cdn.jsdelivr.net/npm/mammoth@1.12.1/mammoth.browser.min.js`).
  - **SheetJS / xlsx** (`xlsx@0.20.3`) — reading Excel workbooks client-side (used for Excel to PDF). Not on npm/cdnjs/jsdelivr (SheetJS stopped publishing current releases there) — loaded from their own CDN instead (`cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`), exposing a global `XLSX` object. **Always pin the exact version in the URL** (never a `-latest` alias) so the site never silently picks up an unreviewed new release.
  - **jspdf-autotable** (`jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js`) — drawing real, selectable-text PDF tables with jsPDF (used for Excel to PDF). On cdnjs; version pinned to 3.8.4 specifically because it's the last major version whose peer dependency (`jspdf@^2.5.1`) matches this site's pinned jsPDF version — a newer autotable major targets jsPDF 3.x and would silently break table rendering against our jsPDF 2.5.1.
  - **tesseract.js** (`tesseract.js/7.0.0/tesseract.min.js`) — client-side OCR (used for OCR PDF). On cdnjs. At runtime it fetches its own additional resources (the OCR language data — `eng` or `spa` depending on the page — and a core WASM binary) from Tesseract's own default CDN endpoints, cached by the browser after first use; this is separate from, and doesn't change, the "files never uploaded" promise — it's the tool downloading a public language model, not sending the user's PDF anywhere.
  - **spark-md5** (`spark-md5/3.0.2/spark-md5.min.js`) — computes MD5 client-side (used for Hash & Checksum Generator). On cdnjs. Needed specifically because the browser's native Web Crypto API (`crypto.subtle.digest`) deliberately does not implement MD5 — it's the one algorithm on that tool not covered by the zero-dependency native API, so a small purpose-built library fills the gap rather than hand-rolling MD5 or pulling in a larger general-purpose crypto library for one algorithm. SHA-1/256/384/512 on the same tool use `crypto.subtle` directly, no library needed.
  - **turndown** (`turndown/7.2.4/turndown.js`) — HTML-to-Markdown conversion (used for Convert to Markdown). On cdnjs. The standard, widely-used library for this exact job, chosen over hand-rolling an HTML parser/converter for the same reason spark-md5 was chosen over hand-rolled MD5 — non-trivial parsing logic is exactly what the project prefers to reuse rather than reimplement.
  - **turndown-plugin-gfm** (`turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js`) — adds GitHub-Flavored Markdown table, strikethrough, and task-list support on top of Turndown's default element set (used for Convert to Markdown). Not on cdnjs (confirmed via the cdnjs API — 404); loaded from jsdelivr instead, the same fallback already used for docx and mammoth. Exposes a global `turndownPluginGfm` object; register its combined ruleset with `turndownService.use(turndownPluginGfm.gfm)`.
  - Three CDN hosts are now in play: cdnjs (default for everything above unless noted), jsdelivr (docx, mammoth, turndown-plugin-gfm — anything not on cdnjs), and cdn.sheetjs.com (xlsx specifically, per SheetJS's own current publishing practice).
  - **Andika** (`assets/fonts/Andika-Regular.woff2` + `.ttf` fallback) — the site's first self-hosted font, used only by Handwriting Worksheets for the traceable-letter canvas rendering. SIL International designed it specifically for early-reader/literacy legibility (single-story letterforms, generous spacing); OFL 1.1 licensed (`assets/fonts/Andika-OFL.txt`), sourced from the `google/fonts` GitHub repo and converted from the upstream `.ttf` to `.woff2` locally (via `fontTools`) for a smaller download. Self-hosted rather than loaded from Google Fonts' CDN specifically to keep the "nothing leaves your device" trust-strip claim literally true on this tool — no other page on the site loads a custom font at all, so this is a deliberate one-off, not a new site-wide pattern.

## Visual design system (must stay consistent across every page)

- Background `#0b0f1a`, text `white`, font `Arial, Helvetica, sans-serif` (dark theme values — see **Theming** below for the light-theme equivalents and how colors are now expressed as CSS custom properties, not raw hex)
- Primary blue button: `background:#2563eb`
- Tool card/box: `background:#111827; border:1px solid #1f2937; border-radius:10px`
- Dropzone pattern: dashed border `#374151`, hover state `border-color:#2563eb`
- Footer: `© Orisod Labs` (home/tools pages also link to About/Privacy)
- Every tool page has: dropzone at top (no scroll needed to start converting) → tool UI → site-wide top nav (see **Site-wide navigation**) → SEO content section (what it does / when to use / 4 FAQs — **no "Why Orisod" section**, see **"Why Orisod" section — never re-add** below) → Related tools (2-3 cards, see below) → footer
- **Related tools card grid (added 2026-08-16):** replaced the old flat `.related` link list with a `.related-grid` of `.related-card` cards — icon in a rounded-square `.icon-box` container, bold title, muted-color description, right-aligned `→` arrow. 2 columns on desktop, 1 column under 600px. Card content (icon/title/desc) is pulled verbatim from that tool's entry in `/tools/index.html` (or `/es/tools/index.html`) — don't hand-write different copy here, keep them in sync. Icon-box background is **color-coded by category**: image = blue (`rgba(37,99,235,var(--icon-alpha))`, reuses `--accent`), PDF = amber (`rgba(245,158,11,var(--icon-alpha))`), utility = violet (`rgba(139,92,246,var(--icon-alpha))`) — chosen to stay clear of the site's existing semantic red (`#f87171` error) and green (`#4ade80` success) so the tint never reads as a status color. `--icon-alpha` is a per-theme token (`.30` dark / `.24` light) added to each page's `:root` blocks. This same Image/PDF/Utility → blue/amber/violet mapping is the one to reuse if color-coding ever extends to `/tools/` itself — don't invent a second mapping.

## Logo & favicon

**Correction (2026-08-23): the note that used to be here ("Logo removed for now... reverted to plain text branding... do not re-attempt logo integration") was stale.** It described the state right after the first attempt was reverted (commit `04c4e6d`, 2026-08-03) for a transparent-background problem, but a fixed version was tested and then approved for site-wide rollout two weeks later (`a6e8067` "TEST: swap favicon + nav icon + hero logo on homepage (EN only)" → `39e60f4` "Roll out logo/icon refresh site-wide (approved from homepage test)", both 2026-08-17). Nobody updated this section afterward, so it kept contradicting the **Site-wide navigation** section below, which has correctly described the nav bar as including a **logo** all along. The logo is intentional and live: `assets/orisod-icon-detailed.png` (small icon + "Orisod" text) in every page's nav bar, and `assets/orisod-logo-full.png` (full wordmark) in the Home page hero, in both languages — About does not have a hero logo. Don't remove any of this without being asked.

**Favicon — status: done (2026-08-15).** The repo previously had no favicon at all (browsers showed the generic globe icon) despite this file's earlier claim that favicon files "already existed" — that claim was stale/wrong and has been corrected here. The current favicon is a simplified brand mark: a blue (`#2563eb`) ring/"O" monogram on a navy (`#0b0f1a`) rounded-square background — not the gear icon from the full wordmark logo, because at 16×16 a gear's teeth blur into an indistinct blob while the ring stays crisp at every size (verified by rendering both at true 16/32/48px before deciding). Files live at repo root: `favicon.ico` (16/32/48 multi-res), `favicon.svg`, `favicon-16x16.png`, `favicon-32x32.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180×180, flat full-bleed square, no rounding/alpha baked in since iOS applies its own mask), and `site.webmanifest`. Every page's `<head>` links all of these plus a `<meta name="theme-color" content="#2563eb">`, inserted right after the `hreflang="x-default"` line. When adding a new tool/page, copy this same block from any existing page — don't regenerate the icons.

## Site-wide navigation

- Every page (all tool pages, Home, All Tools, About, Privacy, both languages) shares one consolidated top nav bar: **logo** (left, links to Home) — **category links** "All Tools | Image Tools | PDF Tools | Utility Tools" (center) — **language switch + theme toggle** (right).
- This single bar replaced three older, separate patterns: the floating top-right EN/ES box, the per-page "🏠 Home | View All Tools" button row on tool pages, and the old "🏠 Home | All Tools" top-nav on About/Privacy/All Tools pages. Don't reintroduce any of those.
- Category links are plain click-through links — **no hover-triggered dropdowns**, that was explicitly rejected as bad UX.
- Highlighting rule (updated 2026-09-29, Phase 11.5): a highlighted nav item renders as bold blue text wrapped in a **rounded capsule** (`background:rgba(37,99,235,.14); border:1px solid var(--accent); border-radius:999px; padding:5px 14px; margin:-5px 0;` on `.site-nav-links span.active-category`). Its text uses a per-theme `--nav-active-text` token (`#60a5fa` dark, `#1d4ed8` light, 6.7:1 and 5.3:1 on the capsule), not `--accent`: plain `#2563eb` text measured only 3.3:1 in dark theme, a WCAG AA failure that axe only started catching once the sticky nav got a solid background. Only two places ever show one: (1) **"Blog" on the blog index pages only (`/blog/` and `/es/blog/`)**, as a static `<span class="active-category">Blog</span>`; (2) **`/tools` while a category filter is selected** (set at runtime by that page's filter JS, see next bullet). **Individual tool pages and individual blog posts highlight nothing** (the same "listing page highlights, item page doesn't" rule for both): tool pages show all categories as normal links to `/tools/#image|pdf|utility` (EN) or `/es/tools/#...` (ES), which open `/tools` with that filter applied, and blog posts show "Blog" as a normal link to `/blog/` or `/es/blog/`. (Corrected 2026-09-29, right after Phase 11.5 shipped: posts had kept the index's highlighted "Blog" span, and `check_nav.py` briefly enforced that wrong behavior; all 148 posts, EN+ES, now use a plain link.) (Before Phase 11.5, each tool page hard-coded its own category as a highlighted `<span>`; that was removed from all 152 tool pages.) Home, About, Privacy and Support highlight nothing. "All Tools" is never highlighted anywhere. `scripts/check_nav.py` (CI: `check-nav`) enforces all of this, so a new page copied from an old template fails CI instead of regressing.
- **Sticky nav (added 2026-09-29, Phase 11.5):** the `.site-nav` bar stays pinned at the top while scrolling (`position:sticky;top:0;z-index:50;background-color:var(--bg);`, prepended to each page's `.site-nav{}` rule). Each page also carries, before its first `</style>`, a "Sticky nav (Phase 11.5)" CSS block (`html{scroll-padding-top}` plus a `max-width:900px` compact layout: logo + EN/ES/theme on one row, category links on a second single row that swipes horizontally instead of wrapping, which keeps the pinned bar about 87px tall on phones instead of 173 to 251px) and, right after `</header>`, a one-line script that keeps `--site-nav-h` on `<html>` equal to the nav's live height and scrolls a highlighted item into view in the swipe row. Anything else that pins to the top must use `top:var(--site-nav-h, 60px)` rather than `top:0` so it sits below the nav (done for the PDF Editor `.toolbar` and the homepage `.hero-pin-inner`). z-index 50 keeps the nav above the Phase 13 gear layers (z-index 0) and page content but below full-screen modals (Calendar Generator's `.modal-overlay` is 100). When adding a page, copy all three pieces from any existing page; `check_nav.py` fails CI if the sticky rule or the height script is missing.
- **The All Tools page (`/tools`) keeps the full nav-links bar like every other page (reversed 2026-08-18 — it previously omitted category links entirely; see below for why).** Its 4 category links carry `data-filter` attributes; clicking one runs the same client-side filter as the filter pills below (no page reload), and the page's `syncNavCategory()` JS swaps the selected category's `<a>` for a `<span class="active-category">` (and back) to match. It also reads the URL hash on load, which is how the category links on tool pages (`/tools/#utility` etc.) arrive pre-filtered. In the unfiltered "All" state, no nav link is highlighted ("All Tools" was wrongly highlighted there until Phase 11.5 fixed `syncNavCategory()`), matching the homepage's no-highlight convention — "All Tools" is never highlighted anywhere on the site.
- The All Tools page additionally has its own **click-based filter pills** (not part of the shared nav bar): "All (N) | Image Tools (21) | PDF Tools (N) | Utility Tools (18)" — N tracks the live tool count above, update both together when adding a tool. Clicking a pill filters/scrolls to that category; clicking "All" shows everything grouped by category and sorted alphabetically within each group (deliberately different from iLovePDF, whose "All" view loses category grouping).

## Theming (light/dark)

- Two themes only: dark (default) and light. A sun/moon toggle button lives in the nav bar; it sets `data-theme="light"` (or removes it for dark) on `<html>` and persists the choice in `localStorage` (key `orisod-theme`). A tiny inline script at the very top of `<head>` reads that value and applies it before first paint, to avoid a flash of the wrong theme.
- Colors are expressed as CSS custom properties defined in `:root` (dark values) and overridden under `:root[data-theme="light"]` — never hardcode a raw hex for something that should flip between themes. Core variables: `--bg`, `--text`, `--card-bg`, `--border`, `--accent`, `--muted-text`, `--dropzone-border`.
- When adding new UI to any page, use the existing variables rather than introducing new hardcoded colors, so it stays correct in both themes automatically.
- **Both themes are checked for contrast (added 2026-10-07).** `scripts/check_a11y.js` (CI: `check-a11y`) scans every page twice, in dark and then in light theme (it flips `data-theme="light"` with transitions off), and reports which theme each violation is in. Until then CI only checked dark theme, so 24 light-only contrast failures had built up unnoticed. The fixes set the pattern for light-theme text colors: light-blue text (`#60a5fa`, used for inline links and `<code>`) becomes `#1d4ed8` in light theme. Amber text (`#f59e0b`) becomes `#92400e`, the same pair the `.disclaimer` box uses. Plain `--accent` (`#2563eb`) is too faint for small text on white inside the 0.85–0.9 opacity paragraphs these pages use. Watch for an `opacity:1` that a more specific `.box p{opacity:.85}`-style rule silently overrides.
- **Every page has a subtle CSS grid/atmosphere background, driven by a `--grid-alpha` token** (added to home/`/tools` first, extended to all 44 tool pages in PR #3/commit `59d90d5`, and to all 42 blog posts EN+ES on 2026-08-24 — now live everywhere). Values: `--grid-alpha:.05;` in `:root{}` (dark), `--grid-alpha:.10;` in `:root[data-theme="light"]{}` (light needs more contrast to read against a near-white background — .035 was tried first and was effectively invisible). Applied via `body{background-color:var(--bg);background-image:linear-gradient(rgba(148,163,184,var(--grid-alpha)) 1px, transparent 1px),linear-gradient(90deg, rgba(148,163,184,var(--grid-alpha)) 1px, transparent 1px);background-size:42px 42px;...}` (replaces the plain `background:var(--bg);` shorthand — note the transition property also changes from `background 0.2s` to `background-color 0.2s`). Every new page must include this exact block — see the Working conventions checklist below.
- **`.theme-toggle` CSS must be self-contained, including an explicit `margin:0`.** Every tool page defines its own generic `button, .back{...}` rule for that tool's action button (e.g. "Compress Image"), and that bare `button` element selector applies to *every* `<button>` on the page — including the nav's `<button class="theme-toggle">`. Class selectors on `.theme-toggle` (like `display`, `padding`, `background`) already win over the element selector on specificity, but `margin` is a property the tool's generic `button` rule sets and `.theme-toggle` didn't use to set, so it fell through unopposed and visibly misaligned the toggle relative to the EN/ES pills next to it. The standard `.theme-toggle` rule now is: `box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:30px;margin:0;padding:0 9px;background:var(--card-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);cursor:pointer;font-size:15px;line-height:1;` — and `.lang-flag` uses the matching box model (`box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 10px;...`) so both sit on an identical height/baseline regardless of being an `<a>`/`<span>` vs a `<button>`. When propagating the nav to a tool page, always use these exact rules rather than copying the tool page's pre-existing `.lang-flag`/theme styles verbatim.

## Nav/theming propagation — status: done

The shared nav bar + light/dark theming (see **Site-wide navigation** and 
**Theming** above) has been propagated to every page: Home, All Tools, 
About, Privacy, and all 36 tools in both English and Spanish (72 tool 
pages total). Two bugs surfaced and were fixed during this rollout, kept 
here as a record so they don't get reintroduced:

- **/tools nav links:** it originally showed only "All Tools" instead of 
  all 4 links — since fixed, then further revised per the `/tools` 
  exception documented in Site-wide navigation (that page's top nav now 
  omits category links entirely, since the filter pills below duplicate 
  them).
- **`.theme-toggle` misalignment:** on tool pages specifically (not the 
  base pages), the toggle button sat visibly lower than the EN/ES pills 
  next to it. Root cause and the permanent fix are documented in the 
  Theming section's `.theme-toggle` bullet — every propagated page now 
  uses that exact CSS.

## Site structure as of now

**Base pages:** `/` (home), `/tools` (catalog, 3 categories), `/about`, `/privacy`

**75 tools**, organized into 3 categories on `/tools`:

**Correction (2026-09-29):** this list said 74 tools (Utility at 17) after Calendar Generator actually shipped (`77da15f`, 2026-09-02, "Add Calendar Generator tool, Phase 10, tool 7/7"), the same never-updated-inventory gap as the Collage Maker correction below. Caught when the roadmap (75) and this doc (74) disagreed; the live `/tools` page showed "All (75)" with 75 cards on 2026-09-28. Calendar Generator is filed under Utility on the live site (`icon-box cat-utility`).

**Correction (2026-09-04):** this list said 73 tools (Image at 20) for a long time after Collage Maker actually shipped (`98ddd05`, "Add Collage Maker tool, Phase 10, tool 6/7") — the doc was never updated at the time. Caught during Phase 12b content-humanization reconciliation, which cross-referenced this inventory against the live `/tools` page. Collage Maker is filed under Image on the live site (`icon-box cat-image` in `tools/index.html`).

**🖼️ Image Tools (21):** webp-to-jpg, heic-to-jpg, png-to-jpg, png-to-webp, jpg-to-webp, webp-to-png, avif-to-jpg-png, gif-to-jpg-png, bmp-to-jpg-png, svg-to-png, resize-image, crop-image, compress-image, rotate-image, social-media-crop, round-image-corners, add-border-to-image, image-color-filters, watermark-adder, blur-area-tool, collage-maker

**📄 PDF Tools (36):** jpg-to-pdf, image-to-pdf, pdf-to-jpg, pdf-to-word, word-to-pdf, excel-to-pdf, powerpoint-to-pdf, merge-pdf, split-pdf, compress-pdf, rotate-pdf, pdf-page-organizer, add-page-numbers, edit-pdf-metadata, crop-pdf-pages, resize-pdf-pages, delete-pdf-pages, extract-pdf-text, ocr-pdf, fill-pdf-forms, pdf-editor, watermark-pdf, sign-pdf, html-to-pdf, flatten-pdf, text-to-pdf, add-stamps, compare-pdfs, pdf-color-filters, n-up-pdf, alternate-mix-pages, pdf-booklet-maker, extract-images-from-pdf, pdf-header-footer, repair-pdf, handwriting-worksheets

**🛠️ Utility Tools (18):** exif-remover, image-metadata-viewer, favicon-generator, qr-code-generator, image-to-base64, color-picker-from-image, image-dimension-checker, password-generator, uuid-generator, json-formatter, case-converter, word-character-counter, color-picker-converter, hash-checksum-generator, convert-to-markdown, ai-writing-checker, read-aloud, calendar-generator

**Discarded (do not build):** "PDF first page to image" — redundant with pdf-to-jpg, which already lets users download any single page individually.

## Custom 404 page (added 2026-10-06, expanded 2026-10-06, Spanish wired up 2026-10-07)

`/404.html` (repo root, a file, not a folder) is the site's custom error page. GitHub Pages serves it for every unmatched path on orisod.com with a real HTTP 404 status (verified live). It is **one file for both languages**: GitHub Pages has no per-folder 404 support, so there is no `/es/404.html`. The HTML is English, which is what no-JS visitors always get. When the broken URL starts with `/es/`, the page's script (`localizeToSpanish()`) translates it in place from the `COPY.es` JS object: `<html lang>`, title, heading, both message pools, all three link labels, gear hints and button labels, the nav and footer text (copied from the live `/es/` pages; keep `COPY.es.chrome`/`footerHeadings`/`footerBrandDesc`/`footerSupportText` in sync if the Spanish nav or footer ever changes), and the EN/ES switch (ES active, EN links to `/`). It also points every site link at its `/es/` version (prefixing `/es`), and "Let the gears choose" draws from `/es/tools/` instead of `/tools/`. A future language would follow the same pattern: add `COPY.<lang>`, detect its prefix, and generalize `localizeToSpanish()`. Because it's served at arbitrary depths (`/es/a/b/c`), every URL in it must be root-absolute. It has `<meta name="robots" content="noindex">`, no canonical/hreflang, and is deliberately **not** in `sitemap.xml` (`check_sitemap.py` only looks at `index.html` files, so it never asks for one). `check_nav.py` explicitly adds it to its page list, and `check_a11y.js` scans it once per gear variant, on both an English and a broken `/es/` URL, via `EXTRA_PATHS` (its local server serves `404.html` for unmatched paths, like GitHub Pages), since neither would pick it up otherwise.

**Rule: the page resolves first, plays second.** With zero interaction and with JS disabled, it shows the fixed `<h1>` "404: This page slipped out of gear." (colon, not an em dash, per editorial rule #1; never rotates), a message, and three plain `<a href>` links: "Browse all tools" (`/tools/`), "Let the gears choose" (fallback href `/compress-image/`; JS upgrades it to a random tool by fetching `/tools/`, or `/es/tools/` on a Spanish URL, and reading its `a.tool-card` links, so there's no separate tool list to maintain), and a smaller text link "Return home" (`/`). Nothing below may ever gate, delay or hide those.

**Rotating messages:** two pools of 6 in `COPY.en` (and `COPY.es` for `/es/` URLs): `preFix` (one picked at random on load) and `postFix` (one picked at random when the gear is fixed). They are picked independently of each other and of the gear variant. The HTML default is pre-fix #3 ("This page took a wrong turn, and the gears followed."), because it doesn't ask for a repair and so reads right with JS off, when no gear shows. Under `prefers-reduced-motion` the pre-fix pick is limited to #3 and #6 for the same reason: the gears appear already fixed and can't be clicked. `aria-live` is added to the message only after the initial pick, so only the post-fix swap is announced.

**Gear easter egg:** an optional, discreetly hinted `<button>` under the links, reusing `/assets/gear-base.png` and the homepage hero's 10:7 CW/CCW spin pairing. Each load picks 1 of 6 variants at equal odds (force one with `?gear=loose|stuck|tooth|sync|rusty|offcenter` on any broken URL): **loose** (small gear sits apart and bobs; click/tap/Enter or a drag snaps it into mesh), **stuck** (gear twitches but won't turn; each click nudges it, the 3rd frees it), **tooth** (top tooth masked off with CSS `mask`, gear hiccups round; 1st click floats the tooth back halfway, 2nd seats it), **sync** (both gears turn the same way and the small one shudders; one click reverses it), **rusty** (gear dulled with a CSS `filter` on the same blue image, creaking; 3 clicks polish it back via `--rust`), **offcenter** (gear orbits around an off-center pivot; 3 clicks or drags pull `--off` to 0 and center it). Every variant fixes the same way: each gear's current angle is frozen on its `.ph` wrapper, then it eases up to speed (`gUp*`, 1.2s ease-in) and hands off to a steady loop (`gLoop*`), so there's no snap; one soft accent-colored radial glow pulses behind the stage (`.stage::before`). The only other effect is the post-fix message. No scores, timers, new controls or reveals, ever, and no colors outside the existing accent. The egg is `hidden` until its script runs (no-JS visitors never see a dead control). Under `prefers-reduced-motion` it renders the already-fixed gears as a static, disabled, `aria-hidden` picture with no glow. To add a 7th variant: add an entry to `VARIANTS` (clicks, html built from `gear()`/`PAIR`/`SOLO` so gears carry `data-dir` and a `.ph` wrapper), any per-step effect to `advance()`, its `.v-<name>` CSS (broken state + `.fixed` state; leave the fixed spin to the shared `.stage.fixed [data-dir]` rules), add its `label`/`hint` to `gears` in both `COPY.en` and `COPY.es`, add the name to `names`, and add it to `GEAR_VARIANTS` in `scripts/check_a11y.js`.

## Homepage search suggestions (added Phase 9.10)

The homepage search box (`#homeSearch`) shows a live autocomplete-style dropdown as you type, sourced from a hand-written `TOOLS` array inlined directly in `index.html`'s (and `es/index.html`'s) own `<script>` block — **not** fetched from `/tools` at runtime. `/tools` has no JS data array of its own to source from; its tools are plain server-rendered `<a class="card tool-card">` markup, so duplicating the list inline was the simplest option that keeps the homepage self-contained and instant (no network round-trip per keystroke). This is the same manual-sync duplication pattern already used for the "Related tools" cards on every tool page — keep both in sync by hand, same as that convention, and update this array whenever a tool is added/renamed/removed (see the tool-page checklist above).

Behavior: matches on name+description substring (name-starts-with ranked above name/desc-contains), capped at 6 suggestions, each showing a color-coded category tag reusing the site's existing Image/PDF/Utility → blue/amber/violet mapping. Arrow keys cycle through suggestions with wraparound; Enter navigates to the highlighted suggestion, or falls back to the pre-existing `/tools/?q=...` behavior if nothing is highlighted; Escape/click-outside closes it. Known pre-existing gap, not addressed here: the `⌘K` hint pill in the search box has no mobile-specific hide treatment.

## Multi-language expansion (in progress)

**Model: English is the hub, other languages are spokes.**

- English stays at the root with no prefix: `orisod.com/compress-image` (never move it to `/en/`)
- Other languages get a prefix: `orisod.com/es/compress-image`
- Every page needs reciprocal `hreflang` tags:
  ```html
  <link rel="alternate" hreflang="en" href="https://orisod.com/compress-image">
  <link rel="alternate" hreflang="es" href="https://orisod.com/es/compress-image">
  <link rel="alternate" hreflang="x-default" href="https://orisod.com/compress-image">
  ```
- **Critical:** each Spanish (or future-language) page only needs to reference English + itself — never needs to know about other languages. Only the English version needs a new `hreflang` line added when a brand-new language launches. This keeps the system from becoming O(n²) as languages are added.
- Language switcher: lives in the right side of the site-wide top nav bar (see **Site-wide navigation**), text labels "EN" / "ES" (not flags — flags don't map cleanly to languages). The current language is a non-clickable `<span class="lang-flag active">`, the other is a clickable `<a>`.
- **Status:** Spanish (`/es/`) home, tools, about, privacy, and all 36 tool pages are done and live, including the shared nav/theming pattern (see **Nav/theming propagation** above). No pages are currently pending translation.
- Future languages under consideration (only add if Analytics shows real traffic demand from that country): French, German, Russian, Hebrew (RTL — needs separate CSS handling), Hindi.

## SEO conventions

- Every tool page: 300–600 words of real content below the tool UI (not filler) — What is X / When to use / 4 FAQs. **No "Why Orisod" section** — see **"Why Orisod" section — never re-add** below.
- `sitemap.xml` at repo root lists every page with `<lastmod>` and `<priority>` — update `lastmod` for a URL only when its content meaningfully changes, not for trivial edits
- Related tools should cross-link reciprocally (if A links to B, B should link back to A)
- Google Search Console: all English pages submitted and indexed. Spanish pages need submitting once live.

## "Why Orisod" section — never re-add

**Every tool page's SEO content section is exactly: What is X / When to use / 4 FAQs. There is no "Why Orisod" (or "¿Por qué Orisod?") heading+paragraph anywhere in that structure, full stop — not a stub, not a one-liner, nothing.** This was removed site-wide from all 44 tool pages (88 files, EN+ES) in Phase 9.9 (PR #17, commit `ac4993d`, 2026-08-23): it repeated brand-persuasion copy that duplicated what's already in each page's intro, FAQ, and the dedicated About page, on a site where visitors land with tool-specific intent already.

That removal PR never added this rule to CLAUDE.md, and the page-structure and SEO-conventions bullets above kept saying "why Orisod" was required content for years afterward — so **every tool built after Phase 9.9 (all 23 of them as of 2026-08-31, both the original-17 and 7-tool-expansion batches) re-added the exact same section**, just spelled "Why Orisod" / "Por qué Orisod" instead of the original "Why use Orisod for this?" wording. Caught and removed a second time on 2026-08-31 (46 files: the 23 tools × EN+ES). If you're scaffolding a new tool page from an existing one as a template, **explicitly check the copied page doesn't have this section** — copying a pre-Phase-9.9 page you haven't audited, or copying a page that (like all 23 above) already regressed, will reintroduce it a third time.

If you ever find this section on any tool page again — old or new — remove it the same way: drop the `<h2>...</h2>` line and its one following `<p>...</p>` line and the blank line after it, nothing else changes.

## Editorial & accessibility standards for new pages

These 4 rules apply to every new tool page, blog post, and guide from day
one — the goal is to never need another retroactive cleanup pass on these
categories again. The first documents a convention that's been enforced
across 4 cleanup rounds (Phase 12b PRs #81-87; PRs #88-92; PRs #93-100; and
a third-audit round covering accessibility/JSON-LD/headings) but was never
actually written down until now; the other 3 are new standing rules.

1. **No em dashes in visible content.** Use a comma, colon, parentheses, or
   a period splitting into two sentences instead — never an em dash (—) in
   anything a visitor reads or a screen reader announces. Two standing
   exceptions, permanent, not subject to a future cleanup pass: `<title>`
   and `<meta name="description">` tags are never rewritten for tone at all
   (risk of stripping "Free"/"Online"/"Gratis" from SEO-critical text — a
   Phase 12b decision), and JS string literals inside `<script>` blocks
   (dropzone/progress/error messages) are an accepted gap since DOM-based
   content review doesn't reach them.
2. **Every form control ships with a programmatic label.** Connect every
   `<input>`, `<select>`, `<textarea>`, and slider to a real `<label for=
   "id">` — reuse the control's existing visible label text as the `for`
   target rather than duplicating it in an `aria-label`. Only use
   `aria-label`/`aria-labelledby` when there's genuinely no visible label
   to reference (e.g. an icon-only control). Never rely on placeholder text
   alone — placeholders aren't reliably announced by assistive tech and
   disappear the moment the user types.
3. **Every new tool/post ships with JSON-LD from day one**, matching its
   page type: tool pages get `WebApplication` + `FAQPage` (built from that
   page's own real `.faq-item` Q&A content); blog/guide posts get
   `BlogPosting` (no `FAQPage` — posts don't have genuinely structured FAQ
   markup, and forcing it risks a wasted/ineligible rich result); index
   pages (blog index, `/tools`) get `BreadcrumbList` only, never an
   `ItemList`/`CollectionPage` enumerating every post/tool (the site
   already has 3+ hand-synced duplicates of that list — homepage search
   array, related-cards, `/tools/index.html` itself — a 4th adds staleness
   risk for marginal value). Schema must strictly reflect only what's
   visibly on the page: never invent a rating, review count, publish date,
   or author name that doesn't exist in the visible content — this site
   has none of those, so no tool/post schema should either.
4. **Sequential heading levels only — H1 → H2 → H3, never skip a level.**
   If a tool's settings panel uses H3 sub-labels for control groups, it
   needs a parent H2 container (reuse an existing visible section label as
   the H2 text where one already exists, rather than inventing new copy).
   Watch for CSS: if headings are styled by a bare tag-selector (`h2{...}`)
   rather than a class, adding or changing a heading level without a
   matching scoped class can visually break — a settings-panel H3 promoted
   to H2 without its own class will inherit the larger content-section H2
   style instead of staying compact.

- **Monetization plan (updated 2026-09-29):** Orisod is **permanently ad-free**: a firm product decision, not a "not yet". Google AdSense was considered early on and explicitly dropped; don't propose or build it (or any other display ads) again. The site is funded by optional, voluntary donations via the `/support` page (Stripe), with growth from SEO/organic traffic. Affiliate links (cloud storage, design software, VPN/privacy tools) were floated as an idea and are not active. Paid traffic ads (Facebook/etc.) are not worth it. The same positioning is recorded in `.agents/product-marketing.md`.
- **Trademark note:** "Orisod" is a registered US trademark for cosmetics/supplements (different class from software) — low risk, monitored, not urgent to act on.
- **Reddit/community growth strategy** is tracked in a separate conversation, not this one — don't mix Reddit tactics into this repo's context.
- The person building this (repo owner) is **not a developer** — explanations should stay practical and avoid unnecessary jargon. They've been pasting AI-generated code manually via GitHub's web editor until now; this Claude Code setup is meant to remove that friction.

## Claude Code marketing skills (`.claude/skills/`)

Added 2026-09-28: 18 marketing skills plus their shared `product-marketing` dependency (19 folders), copied from [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (MIT licensed, commit `5b2c000`; license kept at `.claude/skills/LICENSE-marketingskills`). Skills: seo-audit, ai-seo, site-architecture, schema, programmatic-seo, content-strategy, copywriting, copy-editing, cro, competitor-profiling, competitors, analytics, marketing-ideas, marketing-plan, launch, referrals, community-marketing, directory-submissions, and product-marketing. Only a curated subset was copied because most of the source repo targets SaaS signup/pricing/sales funnels, which don't apply to Orisod's free, no-signup, donation-supported, SEO/blog-driven model.

- Every one of these skills first looks for a shared product context file at `.agents/product-marketing.md` or `.claude/product-marketing.md`; the `product-marketing` skill creates it. None exists yet, so the first marketing session should run that skill so the others stop re-asking basic questions about Orisod.
- A few files (ai-seo, analytics, launch, referrals, and reference docs in content-strategy/referrals) link to `../../tools/...` in the source repo's third-party tool registry, which was intentionally not copied. Those links are dead here; the skills work without them.
- These are dev tooling only: `.claude/` has no `index.html`, so it is not part of the live site and the sitemap check ignores it.

## Working conventions for this repo

- New tool → new folder `tool-name/` with `index.html` inside (self-contained: CSS and JS in the same file, no external site JS files)
- **Every new page (tool or blog post) must include the CSS grid/atmosphere background** (`--grid-alpha` tokens + the `body{}` gradient rule — see **Theming** above for the exact values/pattern). Copy the block from any existing page rather than reconstructing it by hand. This was missed on 42 blog posts (84 EN+ES files) until a dedicated 2026-08-24 sweep caught and fixed the gap — don't let it happen again on the next new page.
- **Every tool ships together with its blog/guide post, EN+ES, same hard requirement as shipping the tool itself in both languages — not optional, not a fast-follow (corrected 2026-08-16, superseding an earlier "recommended but not a blocker" note).** One tool = 4 pages published together: `tool-name/`, `es/tool-name/`, `blog/guide-slug/`, `es/blog/guide-slug/`. Exception: if an existing guide already substantively covers the same topic (e.g. a second UI for the same underlying action), update that guide and cross-link it instead of publishing a near-duplicate post — ask the user first if it's not clear-cut, since it's a content-strategy call, not a mechanical one.
- After creating/editing tool pages, remember to also update: `/tools/index.html` (add the card to the right category), `sitemap.xml` (add the URL), any `related tools` reciprocal links on relevant existing pages, `blog/index.html` + `es/blog/index.html` (add the guide's card), the guide's own reciprocal "Related articles" links, and the homepage's inline `TOOLS` search-suggestions array in both `index.html` and `es/index.html` (added Phase 9.10 — hand-maintained duplicate of the `/tools` card data, same manual-sync pattern as the "related tools" cards; see **Homepage search suggestions** below)
- **Every new page must keep the Phase 11.5 nav behavior** (sticky `.site-nav` rule, the "Sticky nav (Phase 11.5)" CSS block, the `--site-nav-h` script after `</header>`, and no hard-coded `active-category` anywhere except the two blog index pages; see **Site-wide navigation**). Copy the nav from any existing page; `.github/workflows/check-nav.yml` runs `scripts/check_nav.py` on every push/PR to `main` and fails the build otherwise.
- **Every page must be added to `sitemap.xml` in the same commit that adds the page** — standing rule, applies to tool pages and blog posts alike (added 2026-08-17 after 2 generic/non-tool blog posts were flagged as a suspected sitemap gap; investigation found they were already present, but the gap prompted adding a CI safety net anyway). `.github/workflows/check-sitemap.yml` runs `scripts/check_sitemap.py` on every push/PR to `main` and fails the build if any folder with an `index.html` (outside `.git`, `.github`, `.claude`, `assets`, `docs`, `scripts`) lacks a matching `<loc>` entry in `sitemap.xml`. There is no sitemap-generation script or content registry — it's a plain hand-maintained file; this check is the guardrail, not a generator.
- **Every blog post has exactly one category (added Phase 9.4): Guides, Tips, or Comparisons** — a how-to/explainer is a Guide, a quick practical trick or reference/cheat-sheet is a Tip, an "X vs Y" or best-option decision post is a Comparison. Pick the single dominant intent; don't invent a 4th category or show more than one badge on a post. As of Phase 9.4's tagging pass the corpus is heavily Guide-skewed (38 Guides / 3 Comparisons / 1 Tip across 42 EN+ES pairs) — that's an honest reflection of the content, not something to rebalance artificially. Shown as a small non-interactive `<span class="blog-cat cat-guide|cat-tip|cat-comparison">` pill (plain label, no cursor:pointer, no hover state — it's not a control) on both the post's own page (right before its `<h1>`) and its index card (first child inside `.blog-card`, before the `<h2>`) in `blog/index.html`/`es/blog/index.html`. Label text is translated ("Guides"/"Tips"/"Comparisons" EN, "Guías"/"Consejos"/"Comparativas" ES); the `cat-guide`/`cat-tip`/`cat-comparison` class names stay in English in both languages. Colors reuse the site's existing tool-category hue assignments (Guides=blue, Tips=amber, Comparisons=violet) but with dedicated per-theme text/background pairs verified at ≥5.9:1 contrast (WCAG AA) rather than reusing the raw `--accent`/icon-box hex values as pill text, which fail contrast as small text (as low as 1.7:1 in light theme) — same rigor as the existing `.disclaimer` box's dark/light color swap, whose amber pair (`#fbbf24`/`#92400e`) this reuses directly. When adding a new blog post going forward, assign it a category and add the badge to both its own page and its index card in the same commit that adds the post.
- Keep the GA4 snippet, the visual design system, and the SEO content structure identical across every new page — consistency across 36+ pages matters more than any individual page being clever
- Commit messages should be clear about what was added/changed (e.g. "Add Spanish version of compress-image tool")
