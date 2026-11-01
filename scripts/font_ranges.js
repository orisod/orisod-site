#!/usr/bin/env node
/**
 * The characters PowerPoint to PDF may draw with the vendored Liberation Sans, read
 * from the fonts' real cmap tables (not guessed from Unicode blocks).
 *
 *   node scripts/font_ranges.js   prints the FONT_RANGES constant for the PowerPoint to PDF pages
 *
 * A code point counts when both Regular (body text) and Bold (titles) map it to a
 * glyph, and it isn't right-to-left: Hebrew is in the font but needs its own
 * right-to-left layout first (a later PR), so it stays a warning for now, like
 * Arabic, and the bidi control characters go with it. Control characters are left out.
 * test_vendor_smoke.js imports supportedRanges() and fails if a page's FONT_RANGES
 * differs from what the vendored fonts give, so after changing the font or this
 * rule, run this script and paste its output into both pages (EN and ES).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FONT_DIR = "assets/vendor/liberation-sans/2.1.5";
export const FONT_FILES = ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"];

// Every code point a TrueType font maps to a glyph, from its Unicode cmap subtables
// (format 4 for the Basic Multilingual Plane, format 12 when present).
export function cmapCodepoints(buf) {
  const u16 = (o) => buf.readUInt16BE(o), u32 = (o) => buf.readUInt32BE(o);
  const tables = u16(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) if (buf.toString("latin1", 12 + i * 16, 16 + i * 16) === "cmap") cmap = u32(12 + i * 16 + 8);
  if (cmap < 0) throw new Error("no cmap table");
  const out = new Set();
  for (let i = 0; i < u16(cmap + 2); i++) {
    const platform = u16(cmap + 4 + i * 8), encoding = u16(cmap + 6 + i * 8), at = cmap + u32(cmap + 8 + i * 8);
    if (!((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0)) continue;
    const format = u16(at);
    if (format === 4) {
      const segs = u16(at + 6) / 2, ends = at + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, offsets = deltas + segs * 2;
      for (let s = 0; s < segs; s++) {
        const end = u16(ends + s * 2), start = u16(starts + s * 2), delta = u16(deltas + s * 2), ro = u16(offsets + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const glyph = ro === 0 ? (c + delta) & 0xffff : u16(offsets + s * 2 + ro + (c - start) * 2);
          if (glyph !== 0 && (ro === 0 || ((glyph + delta) & 0xffff) !== 0)) out.add(c);
        }
      }
    } else if (format === 12) {
      for (let g = 0; g < u32(at + 12); g++) {
        const start = u32(at + 16 + g * 12), end = u32(at + 20 + g * 12), glyph = u32(at + 24 + g * 12);
        for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) out.add(c);
      }
    }
  }
  return out;
}

const RIGHT_TO_LEFT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\u061C\u200F\u202A-\u202E\u2066-\u2069]/u;
const CONTROL = /\p{Cc}/u;

// [[first, last], ...] code point ranges the fonts at `root` cover, under the rule above.
export function supportedRanges(root) {
  const [regular, bold] = FONT_FILES.map((f) => cmapCodepoints(readFileSync(`${root}/${FONT_DIR}/${f}`)));
  const cps = [...regular].filter((c) => bold.has(c) && !RIGHT_TO_LEFT.test(String.fromCodePoint(c)) && !CONTROL.test(String.fromCodePoint(c))).sort((a, b) => a - b);
  const ranges = [];
  for (const c of cps) {
    const last = ranges.at(-1);
    if (last && last[1] === c - 1) last[1] = c;
    else ranges.push([c, c]);
  }
  return ranges;
}

// The constant as written in the pages: one line, hex code points.
export function rangesLiteral(ranges) {
  const hex = (n) => "0x" + n.toString(16).toUpperCase();
  return `const FONT_RANGES = [${ranges.map(([a, b]) => `[${hex(a)},${hex(b)}]`).join(",")}];`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const ranges = supportedRanges(root);
  console.log(rangesLiteral(ranges));
  console.error(`${ranges.length} ranges, ${ranges.reduce((n, [a, b]) => n + b - a + 1, 0)} code points`);
}
