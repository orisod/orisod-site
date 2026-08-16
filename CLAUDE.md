# Orisod — Project Context for Claude Code

## Permanent rule

**Always run `git pull` at the start of every session before making changes**, since manual edits sometimes happen directly on GitHub's web editor.

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

## Visual design system (must stay consistent across every page)

- Background `#0b0f1a`, text `white`, font `Arial, Helvetica, sans-serif` (dark theme values — see **Theming** below for the light-theme equivalents and how colors are now expressed as CSS custom properties, not raw hex)
- Primary blue button: `background:#2563eb`
- Tool card/box: `background:#111827; border:1px solid #1f2937; border-radius:10px`
- Dropzone pattern: dashed border `#374151`, hover state `border-color:#2563eb`
- Footer: `© Orisod Labs` (home/tools pages also link to About/Privacy)
- Every tool page has: dropzone at top (no scroll needed to start converting) → tool UI → site-wide top nav (see **Site-wide navigation**) → SEO content section (what it does / when to use / why Orisod / 4 FAQs) → Related tools (2-3 cards, see below) → footer
- **Related tools card grid (added 2026-08-16):** replaced the old flat `.related` link list with a `.related-grid` of `.related-card` cards — icon in a rounded-square `.icon-box` container, bold title, muted-color description, right-aligned `→` arrow. 2 columns on desktop, 1 column under 600px. Card content (icon/title/desc) is pulled verbatim from that tool's entry in `/tools/index.html` (or `/es/tools/index.html`) — don't hand-write different copy here, keep them in sync. Icon-box background is **color-coded by category**: image = blue (`rgba(37,99,235,var(--icon-alpha))`, reuses `--accent`), PDF = amber (`rgba(245,158,11,var(--icon-alpha))`), utility = violet (`rgba(139,92,246,var(--icon-alpha))`) — chosen to stay clear of the site's existing semantic red (`#f87171` error) and green (`#4ade80` success) so the tint never reads as a status color. `--icon-alpha` is a per-theme token (`.30` dark / `.24` light) added to each page's `:root` blocks. This same Image/PDF/Utility → blue/amber/violet mapping is the one to reuse if color-coding ever extends to `/tools/` itself — don't invent a second mapping.

## Logo & favicon

Logo removed for now — the PNG (navy background, metallic blue "ORISOD" 
text) doesn't have a transparent background, so it looked broken in the 
nav and hero. Reverted to plain text branding ("ORISOD" or "Orisod Labs") 
in both locations until a proper transparent-background version exists 
(ideally SVG). Do not re-attempt logo integration until explicitly requested.

**Favicon — status: done (2026-08-15).** The repo previously had no favicon at all (browsers showed the generic globe icon) despite this file's earlier claim that favicon files "already existed" — that claim was stale/wrong and has been corrected here. The current favicon is a simplified brand mark: a blue (`#2563eb`) ring/"O" monogram on a navy (`#0b0f1a`) rounded-square background — not the gear icon from the full wordmark logo, because at 16×16 a gear's teeth blur into an indistinct blob while the ring stays crisp at every size (verified by rendering both at true 16/32/48px before deciding). Files live at repo root: `favicon.ico` (16/32/48 multi-res), `favicon.svg`, `favicon-16x16.png`, `favicon-32x32.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180×180, flat full-bleed square, no rounding/alpha baked in since iOS applies its own mask), and `site.webmanifest`. Every page's `<head>` links all of these plus a `<meta name="theme-color" content="#2563eb">`, inserted right after the `hreflang="x-default"` line. When adding a new tool/page, copy this same block from any existing page — don't regenerate the icons.

## Site-wide navigation

- Every page (all tool pages, Home, All Tools, About, Privacy, both languages) shares one consolidated top nav bar: **logo** (left, links to Home) — **category links** "All Tools | Image Tools | PDF Tools | Utility Tools" (center) — **language switch + theme toggle** (right).
- This single bar replaced three older, separate patterns: the floating top-right EN/ES box, the per-page "🏠 Home | View All Tools" button row on tool pages, and the old "🏠 Home | All Tools" top-nav on About/Privacy/All Tools pages. Don't reintroduce any of those.
- Category links are plain click-through links — **no hover-triggered dropdowns**, that was explicitly rejected as bad UX.
- Highlighting rule (updated 2026-08-16): the active category/page — including "Blog" on blog pages, which shares this same treatment — renders as bold blue text wrapped in a **rounded capsule** (`background:rgba(37,99,235,.14); border:1px solid var(--accent); border-radius:999px; padding:5px 14px; margin:-5px 0;` on `.site-nav-links span.active-category`), not plain text. The other categories stay normal clickable links. On Home, all three category names render in their normal, non-highlighted link state (neutral — Home doesn't belong to one category). "All Tools" itself is never highlighted.
- **Exception — the All Tools page (`/tools`) itself:** the shared nav bar there omits every category link, including "All Tools" — only logo (left) and language switch + theme toggle (right) remain, with nothing in between. This is because the page's own filter pills (see below) already cover "All Tools | Image Tools | PDF Tools | Utility Tools", and "All Tools" itself is redundant since it's the page you're already on. Every other page keeps the full 4-link nav.
- The All Tools page additionally has its own **click-based filter pills** (not part of the shared nav bar): "All (36) | Image Tools (20) | PDF Tools (9) | Utility Tools (7)". Clicking a pill filters/scrolls to that category; clicking "All" shows everything grouped by category and sorted alphabetically within each group (deliberately different from iLovePDF, whose "All" view loses category grouping).

## Theming (light/dark)

- Two themes only: dark (default) and light. A sun/moon toggle button lives in the nav bar; it sets `data-theme="light"` (or removes it for dark) on `<html>` and persists the choice in `localStorage` (key `orisod-theme`). A tiny inline script at the very top of `<head>` reads that value and applies it before first paint, to avoid a flash of the wrong theme.
- Colors are expressed as CSS custom properties defined in `:root` (dark values) and overridden under `:root[data-theme="light"]` — never hardcode a raw hex for something that should flip between themes. Core variables: `--bg`, `--text`, `--card-bg`, `--border`, `--accent`, `--muted-text`, `--dropzone-border`.
- When adding new UI to any page, use the existing variables rather than introducing new hardcoded colors, so it stays correct in both themes automatically.
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

**40 tools**, organized into 3 categories on `/tools`:

**🖼️ Image Tools (20):** webp-to-jpg, heic-to-jpg, png-to-jpg, png-to-webp, jpg-to-webp, webp-to-png, avif-to-jpg-png, gif-to-jpg-png, bmp-to-jpg-png, svg-to-png, resize-image, crop-image, compress-image, rotate-image, social-media-crop, round-image-corners, add-border-to-image, image-color-filters, watermark-adder, blur-area-tool

**📄 PDF Tools (13):** jpg-to-pdf, image-to-pdf, pdf-to-jpg, merge-pdf, split-pdf, compress-pdf, rotate-pdf, pdf-page-organizer, add-page-numbers, edit-pdf-metadata, crop-pdf-pages, resize-pdf-pages, delete-pdf-pages

**🛠️ Utility Tools (7):** exif-remover, image-metadata-viewer, favicon-generator, qr-code-generator, image-to-base64, color-picker-from-image, image-dimension-checker

**Discarded (do not build):** "PDF first page to image" — redundant with pdf-to-jpg, which already lets users download any single page individually.

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
- After creating/editing tool pages, remember to also update: `/tools/index.html` (add the card to the right category), `sitemap.xml` (add the URL), and any `related tools` reciprocal links on relevant existing pages
- Keep the GA4 snippet, the visual design system, and the SEO content structure identical across every new page — consistency across 36+ pages matters more than any individual page being clever
- Commit messages should be clear about what was added/changed (e.g. "Add Spanish version of compress-image tool")
