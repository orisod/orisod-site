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
  - **JSZip** (`jszip/3.10.1/jszip.min.js`) — packaging multi-file downloads as ZIP
  - **qrcodejs** (`qrcodejs/1.0.0/qrcode.min.js`) — QR generation
  - **html2canvas** (`html2canvas/1.4.1/html2canvas.min.js`) — rasterizing rendered HTML/DOM to canvas (used with jsPDF for HTML to PDF)

## Visual design system (must stay consistent across every page)

- Background `#0b0f1a`, text `white`, font `Arial, Helvetica, sans-serif` (dark theme values — see **Theming** below for the light-theme equivalents and how colors are now expressed as CSS custom properties, not raw hex)
- Primary blue button: `background:#2563eb`
- Tool card/box: `background:#111827; border:1px solid #1f2937; border-radius:10px`
- Dropzone pattern: dashed border `#374151`, hover state `border-color:#2563eb`
- Footer: `© Orisod Labs` (home/tools pages also link to About/Privacy)
- Every tool page has: dropzone at top (no scroll needed to start converting) → tool UI → site-wide top nav (see **Site-wide navigation**) → SEO content section (what it does / when to use / why Orisod / 4 FAQs) → Related tools (2-3 cards, see below) → footer
- **Related tools card grid (added 2026-08-16):** replaced the old flat `.related` link list with a `.related-grid` of `.related-card` cards — icon in a rounded-square `.icon-box` container, bold title, muted-color description, right-aligned `→` arrow. 2 columns on desktop, 1 column under 600px. Card content (icon/title/desc) is pulled verbatim from that tool's entry in `/tools/index.html` (or `/es/tools/index.html`) — don't hand-write different copy here, keep them in sync. Icon-box background is **color-coded by category**: image = blue (`rgba(37,99,235,var(--icon-alpha))`, reuses `--accent`), PDF = amber (`rgba(245,158,11,var(--icon-alpha))`), utility = violet (`rgba(139,92,246,var(--icon-alpha))`) — chosen to stay clear of the site's existing semantic red (`#f87171` error) and green (`#4ade80` success) so the tint never reads as a status color. `--icon-alpha` is a per-theme token (`.30` dark / `.24` light) added to each page's `:root` blocks. This same Image/PDF/Utility → blue/amber/violet mapping is the one to reuse if color-coding ever extends to `/tools/` itself — don't invent a second mapping.

## Logo & favicon

**Correction (2026-08-23): the note that used to be here ("Logo removed for now... reverted to plain text branding... do not re-attempt logo integration") was stale.** It described the state right after the first attempt was reverted (commit `04c4e6d`, 2026-08-03) for a transparent-background problem, but a fixed version was tested and then approved for site-wide rollout two weeks later (`a6e8067` "TEST: swap favicon + nav icon + hero logo on homepage (EN only)" → `39e60f4` "Roll out logo/icon refresh site-wide (approved from homepage test)", both 2026-08-17). Nobody updated this section afterward, so it kept contradicting the **Site-wide navigation** section below, which has correctly described the nav bar as including a **logo** all along. The logo is intentional and live: `assets/orisod-icon-detailed.png` (small icon + "Orisod" text) in every page's nav bar, and `assets/orisod-logo-full.png` (full wordmark) in the Home page hero, in both languages — About does not have a hero logo. Don't remove any of this without being asked.

**Favicon — status: done (2026-08-15).** The repo previously had no favicon at all (browsers showed the generic globe icon) despite this file's earlier claim that favicon files "already existed" — that claim was stale/wrong and has been corrected here. The current favicon is a simplified brand mark: a blue (`#2563eb`) ring/"O" monogram on a navy (`#0b0f1a`) rounded-square background — not the gear icon from the full wordmark logo, because at 16×16 a gear's teeth blur into an indistinct blob while the ring stays crisp at every size (verified by rendering both at true 16/32/48px before deciding). Files live at repo root: `favicon.ico` (16/32/48 multi-res), `favicon.svg`, `favicon-16x16.png`, `favicon-32x32.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180×180, flat full-bleed square, no rounding/alpha baked in since iOS applies its own mask), and `site.webmanifest`. Every page's `<head>` links all of these plus a `<meta name="theme-color" content="#2563eb">`, inserted right after the `hreflang="x-default"` line. When adding a new tool/page, copy this same block from any existing page — don't regenerate the icons.

## Site-wide navigation

- Every page (all tool pages, Home, All Tools, About, Privacy, both languages) shares one consolidated top nav bar: **logo** (left, links to Home) — **category links** "All Tools | Image Tools | PDF Tools | Utility Tools" (center) — **language switch + theme toggle** (right).
- This single bar replaced three older, separate patterns: the floating top-right EN/ES box, the per-page "🏠 Home | View All Tools" button row on tool pages, and the old "🏠 Home | All Tools" top-nav on About/Privacy/All Tools pages. Don't reintroduce any of those.
- Category links are plain click-through links — **no hover-triggered dropdowns**, that was explicitly rejected as bad UX.
- Highlighting rule (updated 2026-08-16): the active category/page — including "Blog" on blog pages, which shares this same treatment — renders as bold blue text wrapped in a **rounded capsule** (`background:rgba(37,99,235,.14); border:1px solid var(--accent); border-radius:999px; padding:5px 14px; margin:-5px 0;` on `.site-nav-links span.active-category`), not plain text. The other categories stay normal clickable links. On Home, all three category names render in their normal, non-highlighted link state (neutral — Home doesn't belong to one category). "All Tools" itself is never highlighted.
- **The All Tools page (`/tools`) keeps the full nav-links bar like every other page (reversed 2026-08-18 — it previously omitted category links entirely; see below for why).** Its 4 category links plus Blog stay `<a>` tags (not swapped to a static `<span>` like other pages) and carry `data-filter` attributes; clicking one runs the same client-side filter as the filter pills below (no page reload) and toggles an `active-category` class to match, so the CSS selector on this page only is `.site-nav-links span.active-category, .site-nav-links a.active-category` (other pages keep the plain `span.active-category` selector, since their active category is a real static span). In the unfiltered "All" state, no nav link is highlighted, matching the homepage's no-highlight convention — "All Tools" is never highlighted anywhere on the site.
- The All Tools page additionally has its own **click-based filter pills** (not part of the shared nav bar): "All (N) | Image Tools (20) | PDF Tools (N) | Utility Tools (7)" — N tracks the live tool count above, update both together when adding a tool. Clicking a pill filters/scrolls to that category; clicking "All" shows everything grouped by category and sorted alphabetically within each group (deliberately different from iLovePDF, whose "All" view loses category grouping).

## Theming (light/dark)

- Two themes only: dark (default) and light. A sun/moon toggle button lives in the nav bar; it sets `data-theme="light"` (or removes it for dark) on `<html>` and persists the choice in `localStorage` (key `orisod-theme`). A tiny inline script at the very top of `<head>` reads that value and applies it before first paint, to avoid a flash of the wrong theme.
- Colors are expressed as CSS custom properties defined in `:root` (dark values) and overridden under `:root[data-theme="light"]` — never hardcode a raw hex for something that should flip between themes. Core variables: `--bg`, `--text`, `--card-bg`, `--border`, `--accent`, `--muted-text`, `--dropzone-border`.
- When adding new UI to any page, use the existing variables rather than introducing new hardcoded colors, so it stays correct in both themes automatically.
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

**44 tools**, organized into 3 categories on `/tools`:

**🖼️ Image Tools (20):** webp-to-jpg, heic-to-jpg, png-to-jpg, png-to-webp, jpg-to-webp, webp-to-png, avif-to-jpg-png, gif-to-jpg-png, bmp-to-jpg-png, svg-to-png, resize-image, crop-image, compress-image, rotate-image, social-media-crop, round-image-corners, add-border-to-image, image-color-filters, watermark-adder, blur-area-tool

**📄 PDF Tools (17):** jpg-to-pdf, image-to-pdf, pdf-to-jpg, merge-pdf, split-pdf, compress-pdf, rotate-pdf, pdf-page-organizer, add-page-numbers, edit-pdf-metadata, crop-pdf-pages, resize-pdf-pages, delete-pdf-pages, extract-pdf-text, watermark-pdf, sign-pdf, html-to-pdf

**🛠️ Utility Tools (7):** exif-remover, image-metadata-viewer, favicon-generator, qr-code-generator, image-to-base64, color-picker-from-image, image-dimension-checker

**Discarded (do not build):** "PDF first page to image" — redundant with pdf-to-jpg, which already lets users download any single page individually.

## Homepage search suggestions (added Phase 9.10)

The homepage search box (`#homeSearch`) shows a live autocomplete-style dropdown as you type, sourced from a hand-written `TOOLS` array inlined directly in `index.html`'s (and `es/index.html`'s) own `<script>` block — **not** fetched from `/tools` at runtime. `/tools` has no JS data array of its own to source from; its 44 tools are plain server-rendered `<a class="card tool-card">` markup, so duplicating the list inline was the simplest option that keeps the homepage self-contained and instant (no network round-trip per keystroke). This is the same manual-sync duplication pattern already used for the "Related tools" cards on every tool page — keep both in sync by hand, same as that convention, and update this array whenever a tool is added/renamed/removed (see the tool-page checklist above).

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

- Every tool page: 300–600 words of real content below the tool UI (not filler) — What is X / When to use / Why Orisod / 4 FAQs
- `sitemap.xml` at repo root lists every page with `<lastmod>` and `<priority>` — update `lastmod` for a URL only when its content meaningfully changes, not for trivial edits
- Related tools should cross-link reciprocally (if A links to B, B should link back to A)
- Google Search Console: all English pages submitted and indexed. Spanish pages need submitting once live.

## Business context

- **Monetization plan:** SEO/organic traffic first, then Google AdSense (site already meets AdSense's structural requirements: About, Privacy Policy, real content, Analytics). Affiliate links (cloud storage, design software, VPN/privacy tools) being considered as a faster parallel path. Paid traffic ads (Facebook/etc.) are NOT worth it yet — no monetization is active to make the unit economics work.
- **Trademark note:** "Orisod" is a registered US trademark for cosmetics/supplements (different class from software) — low risk, monitored, not urgent to act on.
- **Reddit/community growth strategy** is tracked in a separate conversation, not this one — don't mix Reddit tactics into this repo's context.
- The person building this (repo owner) is **not a developer** — explanations should stay practical and avoid unnecessary jargon. They've been pasting AI-generated code manually via GitHub's web editor until now; this Claude Code setup is meant to remove that friction.

## Working conventions for this repo

- New tool → new folder `tool-name/` with `index.html` inside (self-contained: CSS and JS in the same file, no external site JS files)
- **Every new page (tool or blog post) must include the CSS grid/atmosphere background** (`--grid-alpha` tokens + the `body{}` gradient rule — see **Theming** above for the exact values/pattern). Copy the block from any existing page rather than reconstructing it by hand. This was missed on 42 blog posts (84 EN+ES files) until a dedicated 2026-08-24 sweep caught and fixed the gap — don't let it happen again on the next new page.
- **Every tool ships together with its blog/guide post, EN+ES, same hard requirement as shipping the tool itself in both languages — not optional, not a fast-follow (corrected 2026-08-16, superseding an earlier "recommended but not a blocker" note).** One tool = 4 pages published together: `tool-name/`, `es/tool-name/`, `blog/guide-slug/`, `es/blog/guide-slug/`. Exception: if an existing guide already substantively covers the same topic (e.g. a second UI for the same underlying action), update that guide and cross-link it instead of publishing a near-duplicate post — ask the user first if it's not clear-cut, since it's a content-strategy call, not a mechanical one.
- After creating/editing tool pages, remember to also update: `/tools/index.html` (add the card to the right category), `sitemap.xml` (add the URL), any `related tools` reciprocal links on relevant existing pages, `blog/index.html` + `es/blog/index.html` (add the guide's card), the guide's own reciprocal "Related articles" links, and the homepage's inline `TOOLS` search-suggestions array in both `index.html` and `es/index.html` (added Phase 9.10 — hand-maintained duplicate of the `/tools` card data, same manual-sync pattern as the "related tools" cards; see **Homepage search suggestions** below)
- **Every page must be added to `sitemap.xml` in the same commit that adds the page** — standing rule, applies to tool pages and blog posts alike (added 2026-08-17 after 2 generic/non-tool blog posts were flagged as a suspected sitemap gap; investigation found they were already present, but the gap prompted adding a CI safety net anyway). `.github/workflows/check-sitemap.yml` runs `scripts/check_sitemap.py` on every push/PR to `main` and fails the build if any folder with an `index.html` (outside `.git`, `.github`, `.claude`, `assets`, `docs`, `scripts`) lacks a matching `<loc>` entry in `sitemap.xml`. There is no sitemap-generation script or content registry — it's a plain hand-maintained file; this check is the guardrail, not a generator.
- **Every blog post has exactly one category (added Phase 9.4): Guides, Tips, or Comparisons** — a how-to/explainer is a Guide, a quick practical trick or reference/cheat-sheet is a Tip, an "X vs Y" or best-option decision post is a Comparison. Pick the single dominant intent; don't invent a 4th category or show more than one badge on a post. As of Phase 9.4's tagging pass the corpus is heavily Guide-skewed (38 Guides / 3 Comparisons / 1 Tip across 42 EN+ES pairs) — that's an honest reflection of the content, not something to rebalance artificially. Shown as a small non-interactive `<span class="blog-cat cat-guide|cat-tip|cat-comparison">` pill (plain label, no cursor:pointer, no hover state — it's not a control) on both the post's own page (right before its `<h1>`) and its index card (first child inside `.blog-card`, before the `<h2>`) in `blog/index.html`/`es/blog/index.html`. Label text is translated ("Guides"/"Tips"/"Comparisons" EN, "Guías"/"Consejos"/"Comparativas" ES); the `cat-guide`/`cat-tip`/`cat-comparison` class names stay in English in both languages. Colors reuse the site's existing tool-category hue assignments (Guides=blue, Tips=amber, Comparisons=violet) but with dedicated per-theme text/background pairs verified at ≥5.9:1 contrast (WCAG AA) rather than reusing the raw `--accent`/icon-box hex values as pill text, which fail contrast as small text (as low as 1.7:1 in light theme) — same rigor as the existing `.disclaimer` box's dark/light color swap, whose amber pair (`#fbbf24`/`#92400e`) this reuses directly. When adding a new blog post going forward, assign it a category and add the badge to both its own page and its index card in the same commit that adds the post.
- Keep the GA4 snippet, the visual design system, and the SEO content structure identical across every new page — consistency across 36+ pages matters more than any individual page being clever
- Commit messages should be clear about what was added/changed (e.g. "Add Spanish version of compress-image tool")
