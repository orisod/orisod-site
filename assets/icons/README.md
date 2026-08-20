# Orisod icon system (Phase 9.5)

Line-icon set matching `docs/icon-style-reference.png`: 24×24 viewBox, `fill="none"`,
`stroke="currentColor"`, 2px stroke width, round caps/joins. Every file is a bare
`<svg>...</svg>` fragment — inline it directly into page markup, don't reference it
with `<img src="...">` (that would block `currentColor` from resolving against the
page's theme).

## Structure

- `assets/icons/<tool-slug>.svg` — one file per tool, named by its URL slug
  (`compress-pdf.svg` → `/compress-pdf/`). Includes both the 44 currently-live tools
  (wired into the site) and the 18 Phase 10 planned tools (stored ahead of time, not
  wired into any page yet since those pages don't exist).
- `assets/icons/actions/*.svg` — 11 reusable generic icons for any tool that isn't
  one of the 62 above, plus one (`wrench.svg`) used as the Utility Tools category-header
  glyph on the homepage and `/tools` catalog. Not tied to a specific tool.

## How the color/theme wiring works

Icons never hardcode color. Each one inherits `color` from its container via
`currentColor`. On the site, the `.icon-box` badge sets `color` per category
(same hex already used for `border-color` on that class — this doesn't change
between themes, matching how the badge border already behaves):

```css
.icon-box.cat-image{color:#2563eb;}   /* blue  */
.icon-box.cat-pdf{color:#f59e0b;}     /* amber */
.icon-box.cat-utility{color:#8b5cf6;} /* violet */
.icon-box svg{width:20px;height:20px;display:block;}
```

So dropping any icon from this set into an existing `.icon-box.cat-*` element
just works in both light and dark theme with no per-icon color code.

## Adding a new tool later (e.g. shipping a Phase 10 tool)

1. If the tool's slug already has a file here (all 18 Phase 10 tools do), inline
   that file's `<svg>...</svg>` straight into the new page's `.icon-box` — done.
2. If it's a genuinely new tool not in this set yet, either:
   - design a new one-off `<tool-slug>.svg` following the same spec (24×24,
     `stroke="currentColor"`, 2px, round caps), or
   - reuse the closest matching file from `assets/icons/actions/` as a
     placeholder until a bespoke icon is designed:

| Action icon | Use for tools shaped like... |
|---|---|
| `compress.svg` | reducing file size |
| `convert.svg` | swapping between two formats |
| `crop-resize.svg` | trimming/cropping content |
| `rotate.svg` | rotating/reorienting |
| `protect-unlock.svg` | privacy, locking, or password features |
| `extract.svg` | pulling data/content out of a file |
| `generate.svg` | creating something new from scratch |
| `merge-split.svg` | combining or dividing files |
| `count-measure.svg` | measuring, counting, or checking dimensions |
| `watermark-stamp.svg` | stamping/overlaying a mark on content |
| `wrench.svg` | generic tool/utility concept — no existing per-tool icon fit, so this was purpose-designed (open-end wrench: an open ring + diagonal handle) rather than reused; kept here as the one deliberate exception to "reuse, don't design new icons" |

Either way, the markup pattern is identical everywhere on the site:

```html
<div class="icon-box cat-pdf">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round"
       stroke-linejoin="round"><!-- paste the tool's icon paths here --></svg>
</div>
```
