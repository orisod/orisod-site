# Orisod — Project Context for Claude Code

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

- Background `#0b0f1a`, text `white`, font `Arial, Helvetica, sans-serif`
- Primary blue button: `background:#2563eb`
- Tool card/box: `background:#111827; border:1px solid #1f2937; border-radius:10px`
- Dropzone pattern: dashed border `#374151`, hover state `border-color:#2563eb`
- Footer: `© Orisod Labs` (home/tools pages also link to About/Privacy)
- Every tool page has: dropzone at top (no scroll needed to start converting) → tool UI → 🏠 Home + View All Tools buttons → SEO content section (what it does / when to use / why Orisod / 4 FAQs) → Related tools (2-3 links) → footer

## Site structure as of now

**Base pages:** `/` (home), `/tools` (catalog, 3 categories), `/about`, `/privacy`

**36 tools**, organized into 3 categories on `/tools`:

**🖼️ Image Tools (20):** webp-to-jpg, heic-to-jpg, png-to-jpg, png-to-webp, jpg-to-webp, webp-to-png, avif-to-jpg-png, gif-to-jpg-png, bmp-to-jpg-png, svg-to-png, resize-image, crop-image, compress-image, rotate-image, social-media-crop, round-image-corners, add-border-to-image, image-color-filters, watermark-adder, blur-area-tool

**📄 PDF Tools (9):** jpg-to-pdf, image-to-pdf, pdf-to-jpg, merge-pdf, split-pdf, compress-pdf, rotate-pdf, pdf-page-organizer, add-page-numbers

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
- Language switcher: fixed position top-right, text labels "EN" / "ES" (not flags — flags don't map cleanly to languages). The current language is a non-clickable `<span class="lang-flag active">`, the other is a clickable `<a>`.
- **Status:** Spanish (`/es/`) home, tools, about, and privacy pages are done. The 36 tool pages still need Spanish versions — this is the current in-progress task.
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
