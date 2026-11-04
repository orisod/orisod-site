#!/usr/bin/env node
/**
 * Smoke-test the self-hosted libraries in assets/vendor: each one really works
 * on its tool page, in English and Spanish, with no outside script host.
 *
 * CI: the "smoke" job of check-smoke.yml, on every PR and push to main. Run it
 * locally too after adding or updating a library in assets/vendor, or after
 * changing how a page loads one:
 *
 *   node scripts/test_vendor_smoke.js [--root DIR] [case name ...]
 *
 * How it works: a headless Chromium loads each tool page as https://orisod.com/...,
 * and every orisod.com request is answered from the local files, so root-absolute
 * /assets/vendor/ paths resolve exactly as on GitHub Pages. GoatCounter's counting
 * request is answered locally too, so nothing is counted. Every other request is
 * blocked and fails the case (any CDN URL left in scripts/check_vendor.py's
 * REMAINING_CDN would be let through and listed; that list has been empty since
 * Tesseract moved, so every outside request fails).
 *
 * Each case runs one real operation with its library and checks the result, then
 * checks that the page fetched the case's vendor files from /assets/vendor (status
 * 200) and logged no errors. To cover a library moved in a later PR, add an entry
 * to CASES: the vendor files it needs (a list, or a function of the language), the
 * page, and a run(page, lang) that does the operation and throws if the result is
 * wrong. vendorOneOf lists files of which exactly one must load (Tesseract's three
 * core builds, of which the browser picks one); the result names the one it got.
 * A case can also break one vendor file with broken(lang): { path, mode }, where mode
 * "404" answers it with a 404 and "stall" never answers it (with the page's clock
 * under the test's control, so a timeout can be run forward). Its run() gets a third
 * argument with repair(), which serves the file normally from then on (and answers a
 * stalled request late), and held, which resolves once a stalled request arrives.
 *
 * Every case whose vendor files include jsPDF also checks that the page runs exactly
 * JSPDF_VERSION (window.jspdf.jsPDF.version), and autotable's cases that the plugin
 * attached doc.autoTable. A case with noJspdf (the two calendars, which use pdf-lib)
 * fails if the page requests any jsPDF or autotable file or defines window.jspdf.
 * The jsPDF checks also prove they can fail: mustFail(label, fn) runs the same check
 * on a broken copy of the result (an image dropped, an accent lost, a page cut off,
 * another version) and fails the case unless that check throws.
 *
 * A case that fails is run once more. If it passes then, it's reported as flaky (a
 * FLAKY line, a warning annotation and a row in the job summary) and doesn't fail
 * the run; if it fails twice, the run fails. Console warnings are listed (WARN
 * lines and the job summary) but don't fail a case: PDF color filters logs Chrome's
 * willReadFrequently hint (see Phase 14 in CLAUDE.md). In GitHub Actions each
 * failure is also an error annotation pointing at the page file, or at the file and
 * line the browser named for an exception or console error. --root DIR tests a copy
 * of the site instead of the repo.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { crc32, inflateRawSync, inflateSync } from "node:zlib";
import { chromium } from "playwright";
import { FONT_DIR, FONT_FILES, rangesLiteral, supportedRanges } from "./font_ranges.js";
import { GOATCOUNTER, SITE, annotate, cell, localSite, referenceIn, siteRoot, sourceOf, stackLocation, summary, where } from "./browser_check_lib.js";

const REPO_ROOT = siteRoot(import.meta.url);
const localFile = localSite(REPO_ROOT);
const python = process.platform === "win32" ? "python" : "python3";
const REMAINING_CDN = JSON.parse(execFileSync(python, [fileURLToPath(new URL("check_vendor.py", import.meta.url)), "--allowlist"], { encoding: "utf-8" }));

// Text drawn on a PDF's pages: every content stream (inflated when compressed),
// with its <hex> and (literal) strings decoded. Enough for pdf-lib's standard fonts.
function pdfText(bytes) {
  const raw = bytes.toString("latin1");
  let out = "";
  for (const m of raw.matchAll(/<<((?:(?!>>\s*stream)[\s\S])*)>>\s*stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    let data = bytes.subarray(start, end);
    if (/\/FlateDecode/.test(m[1])) {
      try { data = inflateSync(data); } catch { continue; }
    }
    const s = data.toString("latin1");
    for (const t of s.matchAll(/<([0-9A-Fa-f\s]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g))
      out += (t[1] !== undefined ? Buffer.from(t[1].replace(/\s/g, ""), "hex").toString("latin1") : t[2].replace(/\\(.)/g, "$1")) + "\n";
  }
  return out;
}

// How many pages a PDF has, read from its page tree without any PDF library: the
// largest /Count of a /Type /Pages node (the root), looking inside compressed
// object streams too, since pdf-lib saves its objects in them.
function pdfPageCount(bytes) {
  const raw = bytes.toString("latin1");
  const parts = [raw];
  for (const m of raw.matchAll(/<<((?:(?!>>\s*stream)[\s\S])*)>>\s*stream\r?\n/g)) {
    if (!/\/FlateDecode/.test(m[1])) continue;
    const start = m.index + m[0].length;
    try { parts.push(inflateSync(bytes.subarray(start, raw.indexOf("endstream", start))).toString("latin1")); } catch {}
  }
  let count = 0;
  for (const s of parts)
    for (const m of s.matchAll(/<<(?:(?!<<|>>)[\s\S])*\/Type\s*\/Pages\b(?:(?!<<|>>)[\s\S])*>>/g)) {
      const c = m[0].match(/\/Count\s+(\d+)/);
      if (c) count = Math.max(count, +c[1]);
    }
  return count;
}

// A small, valid PDF written by hand (not by pdf-lib), with one line of text per page.
function fixturePdf(label, pages, { size = 24, winAnsi = false } = {}) {
  const objs = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  // WinAnsiEncoding maps latin1 bytes to their letters (á, ñ, ó...); Helvetica's default encoding doesn't.
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica${winAnsi ? " /Encoding /WinAnsiEncoding" : ""} >>`);
  pages.forEach((text, i) => {
    const content = `BT /F1 ${size} Tf 72 700 Td (${label} ${text}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// The JPEG images inside a PDF (its /DCTDecode image streams), in file order.
function pdfJpegs(bytes) {
  const raw = bytes.toString("latin1");
  const out = [];
  for (const m of raw.matchAll(/<<((?:(?!>>\s*stream)[\s\S])*)>>\s*stream\r?\n/g)) {
    if (!/\/Subtype\s*\/Image/.test(m[1]) || !/\/DCTDecode/.test(m[1])) continue;
    const start = m.index + m[0].length;
    const len = +(m[1].match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/) || [])[1];
    out.push(bytes.subarray(start, len ? start + len : raw.indexOf("endstream", start)));
  }
  return out;
}

// Every object of a PDF written with plain objects (no object streams), as jsPDF writes
// them: its number, its dictionary and, for a stream, its raw (still compressed) bytes.
function pdfObjects(bytes) {
  const raw = bytes.toString("latin1");
  const out = [];
  const re = /(\d+) 0 obj\s*/g;
  for (let m; (m = re.exec(raw));) {
    const start = re.lastIndex;
    const end = raw.indexOf("endobj", start);
    const s = raw.indexOf("stream", start);
    if (s >= 0 && s < end) {
      const dict = raw.slice(start, s);
      const len = +(dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/) || [])[1];
      const at = s + 6 + (raw[s + 6] === "\r" ? 2 : 1);
      out.push({ num: +m[1], dict, data: bytes.subarray(at, at + len) });
      re.lastIndex = raw.indexOf("endobj", at + len) + 6;
    } else {
      out.push({ num: +m[1], dict: raw.slice(start, end) });
      re.lastIndex = end + 6;
    }
  }
  return out;
}

// The pages of a PDF made by jsPDF, in order: size in points, the strings each text
// block shows (latin1, so WinAnsi bytes like \xf3 for ó and \x80 for € stay as written;
// one inner list per BT...ET block, so a wrapped paragraph is one list of lines) and the
// images it draws (pixel size, filter and raw bytes; SMask alpha layers aren't drawn).
function jspdfPages(bytes) {
  const objs = new Map(pdfObjects(bytes).map((o) => [o.num, o]));
  const ref = (dict, key) => objs.get(+(dict.match(new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`)) || [])[1]);
  const tree = [...objs.values()].find((o) => /\/Type\s*\/Pages\b/.test(o.dict));
  expect(tree, "the PDF has no page tree");
  const kids = [...tree.dict.match(/\/Kids\s*\[([^\]]*)\]/)[1].matchAll(/(\d+)\s+0\s+R/g)].map((k) => objs.get(+k[1]));
  const unescape = (s) => s.replace(/\\([0-7]{1,3}|[\s\S])/g, (_, e) => /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ({ n: "\n", r: "\r", t: "\t" })[e] ?? e);
  let pageResources = "";
  return kids.map((p) => {
    const box = p.dict.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    const resources = ref(p.dict, "Resources")?.dict ?? p.dict;
    pageResources = resources;
    const content = ref(p.dict, "Contents");
    const ops = (/\/FlateDecode/.test(content.dict) ? inflateSync(content.data) : content.data).toString("latin1");
    const bts = [...ops.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)];
    const blocks = bts.map((b) => [...b[1].matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj/g)].map((t) => unescape(t[1])));
    // The font each text block sets: its BaseFont, encoding, and for an embedded TrueType
    // font whether the program is there (/FontFile2) and its /FontBBox.
    const fonts = bts.map((b) => {
      const key = [...b[1].matchAll(/\/(\w+)\s+[\d.]+\s+Tf/g)].at(-1)?.[1];
      const font = key && ref(resources, key);
      if (!font) return null;
      const descendant = (font.dict.match(/\/DescendantFonts\s*\[\s*(\d+)\s+0\s+R/) || [])[1];
      const descriptor = descendant && ref(objs.get(+descendant).dict, "FontDescriptor");
      return {
        base: (font.dict.match(/\/BaseFont\s*\/([^\s/<>\[\]]+)/) || [])[1],
        encoding: (font.dict.match(/\/Encoding\s*\/([^\s/<>\[\]]+)/) || [])[1],
        fontFile2: !!descriptor && /\/FontFile2\s+\d+\s+0\s+R/.test(descriptor.dict),
        bbox: descriptor ? ((descriptor.dict.match(/\/FontBBox\s*\[([^\]]*)\]/) || [])[1] || "").trim().split(/\s+/).map(Number) : null,
      };
    });
    const images = [...ops.matchAll(/\/([A-Za-z0-9]+)\s+Do\b/g)].map((d) => {
      const img = ref(resources, d[1]);
      expect(img && /\/Subtype\s*\/Image/.test(img.dict), `/${d[1]} isn't an image`);
      return { w: +img.dict.match(/\/Width\s+(\d+)/)[1], h: +img.dict.match(/\/Height\s+(\d+)/)[1], filter: (img.dict.match(/\/Filter\s*\/(\w+)/) || [])[1] || "none", data: img.data };
    });
    // Every text string as drawn, in drawing order: where it starts (x, y), its font size, its text
    // read through the font's ToUnicode map (so a right-to-left line reads in visual order, left
    // to right) and its width from the font's /W widths. Only for embedded (Identity-H) fonts.
    const runs = [];
    for (const b of bts) {
      let x = 0, y = 0, lead = 0, size = 0, font = null, started = false;
      for (const op of b[1].matchAll(/\/(\w+)\s+([\d.]+)\s+Tf|([-\d.]+)\s+TL|([-\d.]+)\s+([-\d.]+)\s+Td|T\*|<([0-9a-fA-F]*)>\s*Tj/g)) {
        if (op[1]) { size = +op[2]; font = cidFont(op[1]); }
        else if (op[3] !== undefined) lead = +op[3];
        else if (op[4] !== undefined) { x = started ? x + +op[4] : +op[4]; y = started ? y + +op[5] : +op[5]; started = true; }
        else if (op[0] === "T*") y -= lead;
        else if (op[6] !== undefined && font) {
          const codes = op[6].match(/.{4}/g) || [];
          runs.push({ x, y, size, bbox: font.bbox, text: codes.map((c) => font.unicode.get(c) ?? "?").join(""),
            width: codes.reduce((w, c) => w + (font.widths.get(parseInt(c, 16)) ?? font.dw), 0) * size / 1000 });
        }
      }
    }
    return { w: +box[1], h: +box[2], blocks, fonts, images, runs };
  });

  // An embedded Type0 font's ToUnicode map (glyph code as 4 hex digits -> text) and glyph widths.
  function cidFont(key) {
    const font = ref(pageResources, key);
    if (!font || !/\/Subtype\s*\/Type0/.test(font.dict)) return null;
    const cmap = ref(font.dict, "ToUnicode");
    const text = (/\/FlateDecode/.test(cmap.dict) ? inflateSync(cmap.data) : cmap.data).toString("latin1");
    const unicode = new Map();
    const hexText = (h) => String.fromCodePoint(...(h.match(/.{4}/g) || []).map((u) => parseInt(u, 16)));
    for (const section of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
      for (const m of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) unicode.set(m[1].toLowerCase(), hexText(m[2]));
    for (const section of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
      for (const m of section[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g))
        for (let c = parseInt(m[1], 16), u = parseInt(m[3], 16); c <= parseInt(m[2], 16); c++, u++) unicode.set(c.toString(16).padStart(4, "0"), String.fromCodePoint(u));
    const descendant = objs.get(+(font.dict.match(/\/DescendantFonts\s*\[\s*(\d+)\s+0\s+R/) || [])[1]);
    const widths = new Map();
    const w = (descendant.dict.match(/\/W\s*\[([\s\S]*?)\]\s*\//) || [])[1] || "";
    for (const m of w.matchAll(/(\d+)\s*\[([^\]]*)\]/g)) m[2].trim().split(/\s+/).forEach((v, i) => widths.set(+m[1] + i, +v));
    const descriptor = ref(descendant.dict, "FontDescriptor");
    const bbox = ((descriptor?.dict.match(/\/FontBBox\s*\[([^\]]*)\]/) || [])[1] || "").trim().split(/\s+/).map(Number);
    return { unicode, widths, bbox, dw: +((descendant.dict.match(/\/DW\s+([\d.]+)/) || [])[1] || 1000) };
  }
}

// Copy of a PDF with one latin1 string replaced by another of the same length, so the
// stream lengths stay right: how a negative check breaks a real result.
function tamper(bytes, from, to) {
  expect(from.length === to.length, "tamper() needs strings of the same length");
  const raw = bytes.toString("latin1");
  const at = raw.indexOf(from);
  expect(at >= 0, `tamper(): "${from}" isn't in the PDF`);
  return Buffer.from(raw.slice(0, at) + to + raw.slice(at + from.length), "latin1");
}

// A negative check: fn runs a real check on a broken result and must throw. Returns a
// line for the case's report; fails the case if the check let the broken result pass.
function mustFail(label, fn) {
  try {
    fn();
  } catch {
    return `negative check "${label}" failed as it should`;
  }
  throw new Error(`negative check "${label}" passed: this check can't catch that regression`);
}

// Width and height from a JPEG's SOF marker, or null if it isn't a JPEG.
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// The files in a ZIP, read from its central directory without any ZIP library.
function zipEntries(bytes) {
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd >= 0, "the download isn't a ZIP");
  const count = bytes.readUInt16LE(eocd + 10);
  let at = bytes.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    expect(bytes.readUInt32LE(at) === 0x02014b50, "broken ZIP central directory");
    const method = bytes.readUInt16LE(at + 10), size = bytes.readUInt32LE(at + 20);
    const nameLen = bytes.readUInt16LE(at + 28), extraLen = bytes.readUInt16LE(at + 30), commentLen = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLen).toString("utf-8");
    const dataAt = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const stored = bytes.subarray(dataAt, dataAt + size);
    out.push({ name, data: method === 8 ? inflateRawSync(stored) : stored });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// A ZIP written by hand (stored, not compressed), from { name: text } entries.
function zipStore(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf-8"), data = Buffer.from(text, "utf-8");
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt32LE(crc32(data), 16);
    dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, data);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dirBytes = Buffer.concat(central), end = Buffer.alloc(22);
  const count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(dirBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirBytes, end]);
}

const OOXML_RELS = (type, target) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`;

// A minimal .xlsx written by hand (not by SheetJS): one sheet, "Fruit" unless named, with these rows.
function fixtureXlsx(rows, sheet = "Fruit") {
  const cell = (v, r, c) => {
    const ref = String.fromCharCode(65 + c) + (r + 1);
    return typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
  };
  return zipStore({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": OOXML_RELS("officeDocument", "xl/workbook.xml"),
    "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + sheet + '" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": OOXML_RELS("worksheet", "worksheets/sheet1.xml"),
    "xl/worksheets/sheet1.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join("")}</row>`).join("") + "</sheetData></worksheet>",
  });
}

// A minimal .docx written by hand (not by docx or mammoth): one paragraph per line.
function fixtureDocx(lines) {
  return zipStore({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": OOXML_RELS("officeDocument", "word/document.xml"),
    "word/document.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      lines.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join("") + "</w:body></w:document>",
  });
}

// A minimal .pptx written by hand: one slide file per entry. A slide is a list of paragraphs, each
// a string (one text run) or { runs: [...], rtl: "1" | "0" } (several runs, PowerPoint's direction
// flag), or { xml } for a slide file written out in full. PowerPoint to PDF only reads
// ppt/slides/slideN.xml.
function fixturePptx(slides) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  };
  const paragraph = (t) => {
    const { runs, rtl } = typeof t === "string" ? { runs: [t] } : t;
    return `<a:p>${rtl === undefined ? "" : `<a:pPr rtl="${rtl}"/>`}${runs.map((r) => `<a:r><a:t>${esc(r)}</a:t></a:r>`).join("")}</a:p>`;
  };
  slides.forEach((texts, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = texts.xml ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>' +
      texts.map((t) => `<p:sp><p:txBody>${paragraph(t)}</p:txBody></p:sp>`).join("") + "</p:spTree></p:cSld></p:sld>";
  });
  return zipStore(files);
}

// A PDF written by hand whose pages are each one uncompressed iw x ih RGB image filling
// a w x h pt MediaBox (with /Rotate when rotate is set): the left half in `left`
// ([r, g, b]), the right half white. Large on purpose, so Compress PDF's Strong mode
// really makes it smaller.
function fixtureImagePdf(pages, left) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] /Count ${pages.length} >>`];
  pages.forEach(({ w, h, iw, ih, rotate }, i) => {
    const pixels = Buffer.alloc(iw * ih * 3, 255);
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw / 2; x++) pixels.set(left, (y * iw + x) * 3);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}]${rotate ? ` /Rotate ${rotate}` : ""} /Resources << /XObject << /Im0 ${5 + i * 3} 0 R >> >> /Contents ${4 + i * 3} 0 R >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    objs.push([`<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`, pixels, "\nendstream"]);
  });
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  let length = parts[0].length;
  const add = (x) => { const b = Buffer.isBuffer(x) ? x : Buffer.from(x, "latin1"); parts.push(b); length += b.length; };
  const offsets = objs.map((o, i) => {
    const at = length;
    add(`${i + 1} 0 obj\n`);
    (Array.isArray(o) ? o : [o]).forEach(add);
    add("\nendobj\n");
    return at;
  });
  const xref = length;
  add(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join(""));
  add(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

// How dark a JPEG is and how far from gray its pixels get (the largest gap between
// two of a pixel's channels), decoded by the browser.
function jpegStats(page, jpeg) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/jpeg;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let dark = 0, spread = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] < 300) dark++;
      spread = Math.max(spread, Math.abs(data[i] - data[i + 1]), Math.abs(data[i + 1] - data[i + 2]), Math.abs(data[i] - data[i + 2]));
    }
    return { dark, total: c.width * c.height, spread };
  }, Buffer.from(jpeg).toString("base64"));
}

// How many of a JPEG's pixels are dark, decoded by the browser.
function darkPixels(page, jpeg) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/jpeg;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 300) dark++;
    return { dark, total: c.width * c.height };
  }, Buffer.from(jpeg).toString("base64"));
}

// A 64x48 HEIC image (598 bytes): white, with a black block over its left half.
// No HEIC encoder runs in a browser, so it was made once from that synthetic image
// (no photo, no metadata) with pillow-heif 1.8.1 (libheif 1.23.6 and x265), 8-bit
// 4:2:0, quality 90, by a different libheif than the one heic2any bundles.
const HEIC_FIXTURE = Buffer.from(
  "AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAX1tZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAA" +
  "AERAAAEAAQAAAAABoQABAAAAAAAAALUAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA/WlwcnAAAADd" +
  "aXBjbwAAAHZodmNDAQNwAAAAkAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQAqQgEBA3AAAAMAkAAAAwAA" +
  "AwAeoCCBBZbq5Ka5uAhoMCAAAAMDIAAAAwAhYgABAAZEAcFzwIkAAAATY29scm5jbHgAAQANAAaAAAAAFGlzcGUAAAAAAAAAQAAAAEAAAAAoY2xh" +
  "cAAAAEAAAAABAAAAMAAAAAEAAAAAAAAAAv////AAAAACAAAAEHBpeGkAAAAAAwgICAAAABhpcG1hAAAAAAAAAAEAAQWBAgMFhAAAAL1tZGF0AAAA" +
  "sSgBrwY4ifLD6b/q/AjYYlf9/+mW+U1Ii2LDQ1tbz6scPu8/4B/d3+xWre8WfmoHqozNLJqzIW3gWW4J8EcNtWpPQanXPnujUGpIdep75z/5oIw6" +
  "Hoz33Guyje/f0MWfWW6NT3nUkOxMq82DMSiLdAZ++gXripNMqlTzbV5RR5wYJ9M8ZXE2l4+p31PCGXIaini47s9/1/zUbXyP5l5lxn/3oADvjc8X" +
  "8JWeMSxX1o+Dlg==", "base64");

// A JPEG drawn by the browser: white, with a black block over its left half.
function fixtureJpeg(page, w, h) {
  return fixtureImage(page, w, h, "image/jpeg");
}

// The same picture in another format the browser encodes (image/png, image/webp).
// With transparent, the right half is left transparent instead of white. With left,
// the left block is that CSS color instead of black.
async function fixtureImage(page, w, h, mime, { transparent = false, left = "#000" } = {}) {
  const b64 = await page.evaluate(([w, h, mime, transparent, left]) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!transparent) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
    ctx.fillStyle = left; ctx.fillRect(0, 0, w / 2, h);
    return c.toDataURL(mime, 0.9).split(",")[1];
  }, [w, h, mime, transparent, left]);
  const bytes = Buffer.from(b64, "base64");
  const magic = { "image/jpeg": "ffd8", "image/png": "89504e47", "image/webp": "52494646" }[mime];
  expect(bytes.toString("hex").startsWith(magic), `the browser didn't encode a ${mime}`);
  return bytes;
}

function expect(ok, message) {
  if (!ok) throw new Error(message);
}

const PDFJS = "/assets/vendor/pdfjs/3.11.174/pdf.min.js";
const PDFJS_WORKER = "/assets/vendor/pdfjs/3.11.174/pdf.worker.min.js";
const JSPDF_VERSION = "4.2.1";
const JSPDF = `/assets/vendor/jspdf/${JSPDF_VERSION}/jspdf.umd.min.js`;
const AUTOTABLE = "/assets/vendor/jspdf-autotable/5.0.9/jspdf.plugin.autotable.min.js";
const XLSX = "/assets/vendor/xlsx/0.20.3/xlsx.full.min.js";

// The page must run exactly the jsPDF the vendor folder holds.
function expectJspdfVersion(version) {
  expect(version === JSPDF_VERSION, `the page runs jsPDF ${version}, not ${JSPDF_VERSION}`);
}

// A calendar page must never ask for jsPDF or autotable (they make their PDFs with pdf-lib).
function expectNoJspdf(requests, global) {
  const asked = requests.filter((u) => /jspdf|autotable/i.test(u));
  expect(!asked.length && global === "undefined", `the page loaded jsPDF (${asked.join(", ") || `window.jspdf is ${global}`})`);
}

// Each page of a jsPDF image PDF draws exactly one image, filling the page: want lists
// each page's size in points and its image's pixel size and filter.
function expectImagePages(pages, want) {
  const got = pages.map((p) => `${p.w}x${p.h} pt: ${p.images.map((i) => `${i.w}x${i.h} ${i.filter}`).join(", ") || "no image"}`);
  const wanted = want.map((x) => `${x.pw}x${x.ph} pt: ${x.w}x${x.h} ${x.filter}`);
  expect(got.join(" | ") === wanted.join(" | "), `pages ${JSON.stringify(got)}, not ${JSON.stringify(wanted)}`);
  for (const p of pages) for (const img of p.images) {
    if (img.filter !== "DCTDecode") continue;
    const size = jpegSize(img.data);
    expect(size && size.w === img.w && size.h === img.h, `an image says ${img.w}x${img.h} but its JPEG is ${size ? `${size.w}x${size.h}` : "unreadable"}`);
  }
}
const JSZIP = "/assets/vendor/jszip/3.10.1/jszip.min.js";

// Liberation Sans, which PowerPoint to PDF fetches only for text outside Windows-1252.
const [FONT_REGULAR, FONT_BOLD] = FONT_FILES.map((f) => `/${FONT_DIR}/${f}`);
const MANIFEST_SHA = Object.fromEntries(JSON.parse(await readFile(`${REPO_ROOT}/assets/vendor/manifest.json`, "utf-8"))
  .libraries.flatMap((lib) => lib.files.map((f) => ["/" + f.path, f.sha256])));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// A PDF's sha256 without what changes on every run (creation and modification dates, file ID).
const stableSha = (bytes) => sha256(Buffer.from(bytes.toString("latin1")
  .replace(/\/(CreationDate|ModDate) \(D:[^)]*\)/g, "").replace(/\/ID \[[^\]]*\]/g, ""), "latin1"));
// What main produced for the Latin-only deck below (before the Liberation Sans change), stamp and date removed:
// PowerPoint to PDF must keep drawing Windows-1252 decks exactly as it did, with the built-in fonts.
// The same for decks without Hebrew that must stay exactly as they were before Hebrew support:
// runs split inside paragraphs (Latin, and Greek/Cyrillic) and the Greek/Cyrillic deck, from main
// after #202 (42d7d1b8). Only paragraphs with Hebrew are grouped and laid out right to left.
const MAIN_SHA = {
  latinSplit: { en: "fbb6a757a33d4f458d2c6f2c780789e3fab0886e5334d8f5ca34448c553c8322", es: "7250a708e3b0b506d6d1f5139dbdba921cb24e8ed32733dce8deed0b1f83258a" },
  lgc: { en: "f2ec0b07b90a031194af765b4b9a43b98c7980eb80030c6daafec951f868dc82", es: "e300be844e2d5967b6757f37c22f8e75f64fa0635717010b101d9f76deb27124" },
  lgcSplit: { en: "cbc88fb932453c55bf1d7d041850e72dc4d2f6f5f7ac4c1b4d944cb0904edd76", es: "2d239fbc06038c1e5e7457d6dfc0fe8cb05bb6688d7d62912b31ef6b9c88ed4b" },
};
const LATIN_SPLIT_DECK = [["Quarterly review", { runs: ["Make sure to ", "always", " check the output"] }, { runs: ["Price: ", "5 €", " per month"] }], ["Second slide", { runs: ["Bold ", "word", " here"] }]];
const LGC_SPLIT_DECK = [["Καλημέρα", { runs: ["Привет, ", "мир", "!"] }, { runs: ["Za", "żółć"] }]];
const LATIN_DECK_SHA = {
  en: "8392021d08c4a992d155d89cb1af1e232cf311bef4188c0537d85f39dabbfe81",
  es: "cd24a4bcd7138429cc8ff150d4e96d73a8afeb29e1f44187d267dba6817676ae",
};

// A TrueType font's bounding box from its head table, in PDF units (1000 per em), as jsPDF writes /FontBBox.
function headBBox(buf) {
  const tables = buf.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    if (buf.toString("latin1", 12 + i * 16, 16 + i * 16) !== "head") continue;
    const at = buf.readUInt32BE(12 + i * 16 + 8), em = buf.readUInt16BE(at + 18);
    return [36, 38, 40, 42].map((o) => Math.round((buf.readInt16BE(at + o) * 1000) / em));
  }
  throw new Error("no head table");
}
// Read when a font check first needs them, so the other cases still run on a copy of the site without the fonts.
const FONT_BBOX = {};
async function loadFontBBoxes() {
  if (!FONT_BBOX.regular) for (const [i, f] of FONT_FILES.entries()) FONT_BBOX[i ? "bold" : "regular"] = headBBox(await readFile(`${REPO_ROOT}/${FONT_DIR}/${f}`));
}

// The text the site's PDF.js reads from a PDF, one entry per line (whitespace runs collapsed),
// with PDF.js loaded into the tool page after its own work is done.
async function pdfjsLines(page, bytes) {
  if (!(await page.evaluate(() => typeof window.pdfjsLib === "object"))) await page.addScriptTag({ url: PDFJS });
  return page.evaluate(async ([b64, worker]) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = worker;
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    const out = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      let y = null, line = "";
      for (const it of (await (await pdf.getPage(n)).getTextContent()).items) {
        const iy = Math.round(it.transform[5]);
        if (y !== null && iy !== y) { out.push(line); line = ""; }
        line += it.str; y = iy;
      }
      out.push(line);
    }
    return out.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  }, [Buffer.from(bytes).toString("base64"), PDFJS_WORKER]);
}

// Upload a deck to PowerPoint to PDF, convert it and return the PDF (or null if no download appeared).
async function convertDeck(page, name, slides, { expectPdf = true } = {}) {
  await page.setInputFiles("#fileInput", { name: `${name}.pptx`, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: fixturePptx(slides) });
  await page.locator("#convertBtn").waitFor({ state: "visible", timeout: 30000 });
  await page.click("#convertBtn");
  if (!expectPdf) return null;
  const link = page.locator(`#result a[download="${name}.pdf"]`);
  await link.waitFor({ timeout: 60000 });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
  return readFile(await download.path());
}

// The warning PowerPoint to PDF shows for characters it can't draw yet. With named scripts it ends
// "The rest of the text converts normally." unless every text run has such a character (short).
const PPTX_WARNING = {
  en: (names, short = false) => names ? `⚠️ Some slides use ${names} characters, which this converter can't show yet. They'll come out as unreadable symbols in the PDF.${short ? "" : " The rest of the text converts normally."}`
    : "⚠️ Some characters in this presentation can't be shown in the PDF yet and will come out as unreadable symbols.",
  es: (names, short = false) => names ? `⚠️ Algunas diapositivas usan caracteres ${names}, que este conversor todavía no puede mostrar. Saldrán como símbolos ilegibles en el PDF.${short ? "" : " El resto del texto se convierte con normalidad."}`
    : "⚠️ Algunos caracteres de esta presentación todavía no se pueden mostrar en el PDF y saldrán como símbolos ilegibles.",
};
const PPTX_FONT_ERROR = {
  en: "The font for this presentation could not load. Check your connection and try again.",
  es: "No se pudo cargar la fuente de esta presentación. Revisa tu conexión e inténtalo de nuevo.",
};
// The warning box's state: shown text (or null when hidden), its role, and the Convert button.
const warnState = (page) => page.evaluate(() => {
  const note = document.getElementById("warnNote"), btn = document.getElementById("convertBtn");
  return { text: getComputedStyle(note).display === "none" ? null : note.textContent, role: note.getAttribute("role"),
    convert: getComputedStyle(btn).display !== "none" && !btn.disabled };
});
function expectWarning(state, want) {
  expect(state.text === want, `the warning box says ${JSON.stringify(state.text)}, not ${JSON.stringify(want)}`);
  expect(state.role === null, `the warning box has role="${state.role}"; warnings aren't alerts`);
  expect(state.convert, "the Convert button isn't available next to the warning");
}

// The Greek, Cyrillic and Latin Extended deck, and the lines PDF.js must read back from it.
const LONG_RU = "Съешь же ещё этих мягких французских булок да выпей чаю, а потом прочитай длинное предложение, которое переносится на новую строку.";
const LGC_DECK = [["Καλημέρα κόσμε", "Привет, мир", "Zażółć gęślą jaźń", "Việt Nam", LONG_RU], ["Ελληνικά και Кириллица", "Українська мова"]];
function expectLgcText(lines, lang) {
  const slide = lang === "es" ? "Diapositiva" : "Slide";
  for (const want of ["Καλημέρα κόσμε", "• Привет, мир", "• Zażółć gęślą jaźń", "• Việt Nam", `${slide} 1`, "Ελληνικά και Кириллица", "• Українська мова", `${slide} 2`])
    expect(lines.includes(want), `PDF.js doesn't read "${want}" back from the PDF: ${JSON.stringify(lines)}`);
  const at = lines.findIndex((l) => l.startsWith("• Съешь"));
  const end = lines.findIndex((l, i) => i >= at && l.endsWith("новую строку."));
  expect(at >= 0 && end > at && lines.slice(at, end + 1).join(" ") === "• " + LONG_RU,
    `the long Cyrillic bullet isn't wrapped into consecutive lines that read back exactly: ${JSON.stringify(lines.slice(Math.max(at, 0), at + 4))}`);
  return end - at + 1;
}
// Every text block draws with embedded Liberation Sans (Identity-H, /FontFile2): titles Bold, the rest Regular.
function expectLiberationFonts(pages) {
  pages.forEach((p, i) => p.fonts.forEach((f, j) => {
    const want = j === 0 ? "bold" : "regular";
    expect(f && f.encoding === "Identity-H" && f.fontFile2, `page ${i + 1}, text block ${j + 1} doesn't use an embedded Identity-H font: ${JSON.stringify(f)}`);
    expect(f.bbox.join() === FONT_BBOX[want].join(), `page ${i + 1}, text block ${j + 1} uses the font with box [${f.bbox}], not Liberation Sans ${want === "bold" ? "Bold" : "Regular"} [${FONT_BBOX[want]}]`);
  }));
}

// The pages Compress PDF (Strong) and PDF color filters redraw: portrait Letter, landscape
// Letter, and portrait Letter turned with /Rotate 90, which viewers show as 792x612 pt.
const RASTER_PAGES = [{ w: 612, h: 792, iw: 300, ih: 388 }, { w: 792, h: 612, iw: 388, ih: 300 }, { w: 612, h: 792, iw: 300, ih: 388, rotate: 90 }];
const RASTER_SHOWN = [[612, 792], [792, 612], [792, 612]];

// A redrawn page keeps its original size in points (within 0.5 pt) and draws one JPEG
// of the render's pixel size: want lists each page's original size and that JPEG's size.
function expectRasterPages(pages, want) {
  const got = pages.map((p) => `${p.w}x${p.h} pt: ${p.images.map((i) => `${i.w}x${i.h} ${i.filter}`).join(", ") || "no image"}`);
  const wanted = want.map((x) => `${x.pw}x${x.ph} pt: ${x.w}x${x.h} DCTDecode`);
  const ok = pages.length === want.length && pages.every((p, i) => Math.abs(p.w - want[i].pw) <= 0.5 && Math.abs(p.h - want[i].ph) <= 0.5 &&
    p.images.length === 1 && p.images[0].w === want[i].w && p.images[0].h === want[i].h && p.images[0].filter === "DCTDecode");
  expect(ok, `pages ${JSON.stringify(got)}, not ${JSON.stringify(wanted)} (page sizes within 0.5 pt of the original)`);
  for (const p of pages) {
    const size = jpegSize(p.images[0].data);
    expect(size && size.w === p.images[0].w && size.h === p.images[0].h, `an image says ${p.images[0].w}x${p.images[0].h} but its JPEG is ${size ? `${size.w}x${size.h}` : "unreadable"}`);
  }
}

// One entry per library (or library pair) that has moved to assets/vendor.
// OCR PDF: upload a 2-page fixture of large, clean Helvetica and run OCR; returns once the .txt is checked.
// The Spanish line has á, ñ and ó, which the English data doesn't read, so passing on /es/ shows the Spanish data ran.
const OCR_WORDS = { en: ["Orisod smoke", "Quick brown fox"], es: ["Orisod prueba", "Canción de mañana"] };
async function ocrUpload(page, lang) {
  const pdf = fixturePdf("", OCR_WORDS[lang], { size: 40, winAnsi: true });
  await page.setInputFiles("#fileInput", { name: "words.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.locator("#ocrBtn").waitFor({ state: "visible", timeout: 30000 });
}
async function ocrRun(page, lang) {
  const words = OCR_WORDS[lang];
  await page.click("#ocrBtn");
  const link = page.locator('#result a[download="words-ocr.txt"]');
  try {
    await link.waitFor({ timeout: 120000 });
  } catch (e) {
    throw new Error(`no .txt download (page says: ${await page.textContent("#errorMsg") || "nothing"})`);
  }
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
  const text = await readFile(await download.path(), "utf-8");
  const at = words.map((w) => text.indexOf(w));
  expect(at.every((i) => i >= 0) && at[0] < at[1], `words-ocr.txt doesn't have ${words.map((w) => `"${w}"`).join(" then ")}: ${JSON.stringify(text.slice(0, 200))}`);
  return `words-ocr.txt has ${words.map((w) => `"${w}"`).join(" and ")} on pages 1 and 2, read with the ${lang === "es" ? "Spanish" : "English"} data`;
}
// The message OCR PDF shows when its engine or language data can't load, and the loading text it replaces.
const OCR_ENGINE_ERROR = {
  en: "The OCR engine could not load. Check your connection and reload the page to try again.",
  es: "No se pudo cargar el motor de OCR. Revisa tu conexión y recarga la página para intentarlo de nuevo.",
};
const OCR_LOADING = { en: "Loading OCR engine...", es: "Cargando el motor de OCR..." };
async function ocrExpectEngineError(page, lang, timeout) {
  try {
    await page.waitForFunction((m) => document.getElementById("errorMsg").textContent === m, OCR_ENGINE_ERROR[lang], { timeout });
  } catch (e) {
    throw new Error(`no engine error (page still says: ${await page.textContent("#progressMsg") || "nothing"}; error line: ${await page.textContent("#errorMsg") || "nothing"})`);
  }
  const state = await page.evaluate(() => ({
    progress: document.getElementById("progressMsg").textContent,
    role: document.getElementById("errorMsg").getAttribute("role"),
    disabled: document.getElementById("ocrBtn").disabled,
    shown: getComputedStyle(document.getElementById("ocrBtn")).display !== "none",
  }));
  expect(state.progress !== OCR_LOADING[lang], `the page still says "${state.progress}" next to the error`);
  expect(state.role === "alert", `the error line has role="${state.role}", not "alert", so it isn't announced`);
  expect(!state.disabled && state.shown, "the Run OCR button isn't available again to retry");
}
const TESSERACT_VENDOR = (lang) => [
  "/assets/vendor/tesseract/7.0.0/tesseract.min.js",
  "/assets/vendor/tesseract/7.0.0/worker.min.js",
  `/assets/vendor/tesseract/7.0.0/lang/${lang === "es" ? "spa" : "eng"}.traineddata.gz`,
];
const TESSERACT_CORES = ["relaxedsimd-lstm", "simd-lstm", "lstm"].map((b) => `/assets/vendor/tesseract/7.0.0/core/tesseract-core-${b}.wasm.js`);

// The Hebrew deck: pure Hebrew, Hebrew with Latin and numbers, shekel amounts, brackets, a long
// wrapped bullet, niqqud, a sentence split into 3 runs and an rtl="1" paragraph starting in Latin.
const LONG_HE = "זהו משפט ארוך בעברית שצריך לעבור לשורה הבאה כי הוא ארוך יותר מרוחב העמוד, ולכן הכלי חייב לחלק אותו לכמה שורות בצורה נכונה ובסדר הנכון.";
const SPLIT_HE = ["זהו ", "משפט", " שמחולק לשלושה חלקים"];
const HEBREW_DECK = [
  ["מצגת לדוגמה", "שלום עולם", "גרסה 2.0 של Orisod זמינה עכשיו", "המחיר הוא 1,250.50 ₪ לשנה או 100 ₪ לחודש", "המחיר (כולל מע״מ) מופיע [בנספח]", LONG_HE],
  ["ניקוד", "שָׁלוֹם עוֹלָם", { runs: SPLIT_HE }, { runs: ["Orisod היא ערכת כלים חינמית"], rtl: "1" }],
];
const HEBREW_READ_BACK = ["מצגת לדוגמה", "• שלום עולם", "• גרסה 2.0 של Orisod זמינה עכשיו", "ניקוד", "• שָׁלוֹם עוֹלָם", "• " + SPLIT_HE.join(""), "• Orisod היא ערכת כלים חינמית"];
function expectHebrewDrawing(pages) {
  const all = pages.flatMap((p) => p.runs);
  const reverse = (t) => [...t].reverse().join("");
  const run = (logical) => all.find((r) => reverse(r.text) === logical);
  // Pure Hebrew lines are drawn in visual order: read right to left they're the text as written.
  for (const want of ["מצגת לדוגמה", "•  שלום עולם", "ניקוד", "•  " + SPLIT_HE.join("")])
    expect(run(want), `no line drawn as the reverse of "${want}": ${JSON.stringify(all.map((r) => r.text))}`);
  // Brackets the right way round, numbers left to right.
  const brackets = all.find((r) => r.text.includes("מ״עמ") || r.text.includes("ללוכ"));
  expect(brackets && brackets.text.indexOf("(") >= 0 && brackets.text.indexOf("(") < brackets.text.indexOf(")") && brackets.text.indexOf("[") < brackets.text.indexOf("]"),
    `brackets are drawn mirrored: ${JSON.stringify(brackets?.text)}`);
  const money = all.find((r) => r.text.includes("₪"));
  expect(money && money.text.includes("1,250.50") && money.text.includes("100"), `the numbers aren't drawn intact: ${JSON.stringify(money?.text)}`);
  // The long bullet wraps into lines in reading order: the top line holds its first words.
  const wrapped = all.filter((r) => LONG_HE.includes(reverse(r.text).replace(/^•  /, ""))).sort((a, b) => b.y - a.y);
  expect(wrapped.length >= 2 && wrapped.map((r) => reverse(r.text)).join(" ") === "•  " + LONG_HE,
    `the long bullet's lines, top to bottom, don't read as the paragraph: ${JSON.stringify(wrapped.map((r) => reverse(r.text)))}`);
  // Right to left lines end at the mirrored margins: titles at 562 pt, bullets (and their wrapped lines) at 548 pt.
  for (const r of all.filter((x) => /[א-ת]/.test(x.text) && !x.text.startsWith("•  O"))) {
    const edge = r.size === 18 ? 562 : 548;
    expect(Math.abs(r.x + r.width - edge) <= 1, `"${reverse(r.text).slice(0, 30)}" ends at ${(r.x + r.width).toFixed(1)} pt, not ${edge} pt`);
  }
  // The rtl="1" paragraph that starts with a Latin word is right-aligned too.
  const flagged = all.find((r) => r.text.includes("Orisod") && r.text.includes("•") && !r.text.includes("2.0"));
  expect(flagged && Math.abs(flagged.x + flagged.width - 548) <= 1, `the rtl="1" paragraph ends at ${flagged && (flagged.x + flagged.width).toFixed(1)} pt, not 548 pt`);
  // The split sentence is one bullet, not three.
  expect(!all.some((r) => reverse(r.text) === "•  " + SPLIT_HE[1]), "the sentence split into runs became separate bullets");
}

// A slide as PowerPoint writes it (title and body placeholders, run properties, a run split where the
// language changes, a line break, a slide-number field, an empty paragraph), Hebrew set right to left.
const REAL_SLIDE_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
  '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="r" rtl="1"/><a:r><a:rPr lang="he-IL" dirty="0"/><a:t>דוח </a:t></a:r>' +
  '<a:r><a:rPr lang="he-IL" b="1" dirty="0"/><a:t>רבעוני</a:t></a:r><a:endParaRPr lang="en-US" dirty="0"/></a:p></p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>' +
  '<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>' +
  '<a:p><a:pPr marL="0" indent="0" algn="r" rtl="1"><a:buNone/></a:pPr><a:r><a:rPr lang="he-IL" dirty="0"/><a:t>גרסה </a:t></a:r>' +
  '<a:r><a:rPr lang="en-US" dirty="0"/><a:t>Orisod</a:t></a:r><a:r><a:rPr lang="he-IL" dirty="0"/><a:t> 2.0 זמינה</a:t></a:r>' +
  '<a:br><a:rPr lang="he-IL" dirty="0"/></a:br><a:r><a:rPr lang="he-IL" dirty="0" err="1"/><a:t>בכל הדפדפנים</a:t></a:r><a:endParaRPr lang="he-IL" dirty="0"/></a:p>' +
  '<a:p><a:pPr rtl="1"/><a:r><a:rPr lang="he-IL" dirty="0"/><a:t>שקופית </a:t></a:r><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum">' +
  '<a:rPr lang="he-IL"/><a:t>1</a:t></a:fld><a:endParaRPr lang="he-IL" dirty="0"/></a:p>' +
  '<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Make sure to </a:t></a:r><a:r><a:rPr lang="en-US" b="1" dirty="0"/><a:t>always</a:t></a:r>' +
  '<a:r><a:rPr lang="en-US" dirty="0"/><a:t> check</a:t></a:r></a:p><a:p><a:endParaRPr lang="he-IL" dirty="0"/></a:p>' +
  '</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';

// Excel to PDF and Liberation Sans: the warning (worded for spreadsheets), the font error, a workbook
// upload and conversion, and the shared font-loader block every page carrying it must keep identical.
const XLSX_WARNING = {
  en: (names, short = false) => names ? `⚠️ Some cells use ${names} characters, which this converter can't show yet. They'll come out as unreadable symbols in the PDF.${short ? "" : " The rest of the text converts normally."}`
    : "⚠️ Some characters in this spreadsheet can't be shown in the PDF yet and will come out as unreadable symbols.",
  es: (names, short = false) => names ? `⚠️ Algunas celdas usan caracteres ${names}, que este conversor todavía no puede mostrar. Saldrán como símbolos ilegibles en el PDF.${short ? "" : " El resto del texto se convierte con normalidad."}`
    : "⚠️ Algunos caracteres de esta hoja de cálculo todavía no se pueden mostrar en el PDF y saldrán como símbolos ilegibles.",
};
const XLSX_FONT_ERROR = {
  en: "The font for this spreadsheet could not load. Check your connection and try again.",
  es: "No se pudo cargar la fuente de esta hoja de cálculo. Revisa tu conexión e inténtalo de nuevo.",
};
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
async function convertWorkbook(page, name, rows, sheet, { expectPdf = true } = {}) {
  await page.setInputFiles("#fileInput", { name: `${name}.xlsx`, mimeType: XLSX_MIME, buffer: fixtureXlsx(rows, sheet) });
  await page.locator("#convertBtn").waitFor({ state: "visible", timeout: 30000 });
  await page.click("#convertBtn");
  if (!expectPdf) return null;
  const link = page.locator(`#result a[download="${name}.pdf"]`);
  await link.waitFor({ timeout: 60000 });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
  return readFile(await download.path());
}
const SHARED_FONT_PAGES = ["powerpoint-to-pdf/index.html", "es/powerpoint-to-pdf/index.html", "excel-to-pdf/index.html", "es/excel-to-pdf/index.html"];
const sharedBlock = (text) => {
  const s = text.replace(/\r\n/g, "\n");
  const a = s.indexOf("// --- Shared font loader: start"), b = s.indexOf("// --- Shared font loader: end.");
  return a < 0 || b < 0 ? null : s.slice(a, b);
};
function expectSameSharedBlock(texts) {
  const blocks = texts.map(sharedBlock);
  expect(blocks.every((x) => x !== null), "a page lost its shared font loader block");
  expect(new Set(blocks).size === 1, `the shared font loader block differs between ${SHARED_FONT_PAGES.join(", ")}`);
}
// What main produced (42d7d1b8 and later; Excel to PDF unchanged since #200) for the Windows-1252
// workbook below, stamp and date removed.
const XLSX_LATIN_SHA = { en: "b94d439598db413e97d5351bb64f6c691f13003739fadcec83584a92c4dd8633", es: "8744b9797f4a86613f47a6c99f0e104b4165caeaa3318add5061e015b1c11528" };
const XLSX_LATIN_ROWS = [["Año", "Región", "Precio €", "Nota"], ["2026", "Señora Muñoz", "1.250,50 €", "Café “crème”"], ["2027", "Œuvre", "5 € • 10 £", "— fin —"]];
const XLSX_LGC_ROWS = [["Γλώσσα", "Пример", "Przykład"], ["Καλημέρα κόσμε", "Привет, мир", "Zażółć gęślą jaźń"], ["Ελληνικά", "Українська", "Việt Nam"]];
const XLSX_SQUARE = '□';

// --- WhatsApp link generator (the pilot of the minimal tool layout). Each check below has a negative
// twin (mustFail) run on a broken copy of what the page gave.
const WA = "/whatsapp-link-generator/";
const LIBPHONE = "/assets/vendor/libphonenumber-js/1.13.15/libphonenumber-max.js";
const QRJS = "/assets/vendor/qrcodejs/1.0.0/qrcode.min.js";
const FLAG = (code) => `/assets/vendor/circle-flags/2.8.3/${code}.svg`;
const WA_QR_MAX = 2328;
const WA_TEXT = {
  en: { copied: "Copied", reason: "Enter a phone number to open the chat.", reasonMessage: "Write a message first. WhatsApp will ask you who to send it to.",
    add9: "Add the 9", mx1: "The 1 after +52 was removed", summary: "Help and details", qrFile: "whatsapp-link-qr.png" },
  es: { copied: "Copiado", reason: "Escribe un número de teléfono para abrir el chat.", reasonMessage: "Escribe un mensaje primero. WhatsApp te preguntará a quién enviarlo.",
    add9: "Agregar el 9", mx1: "Se quitó el 1 después de +52", summary: "Ayuda y detalles", qrFile: "link-whatsapp-qr.png" },
};
const regionName = (page, code) => page.evaluate((c) => new Intl.DisplayNames([document.documentElement.lang], { type: "region" }).of(c), code);
// Pick a country the way a visitor does: type its name in the combobox and press Enter.
async function waCountry(page, code) {
  const name = await regionName(page, code);
  await page.click("#countryInput");
  await page.fill("#countryInput", name);
  await page.keyboard.press("Enter");
  const value = await page.inputValue("#countryInput");
  expect(value.startsWith(name + " (+"), `picking ${code} by typing "${name}" gave "${value}"`);
}
async function waNumber(page, number) {
  await page.fill("#phoneInput", number);
  await page.locator("#phoneInput").blur();
  return page.evaluate(() => ({ href: document.getElementById("openLink").getAttribute("href") || "", status: document.getElementById("phoneStatus").textContent }));
}
// [country picked, what's typed, the digits WhatsApp needs]
const WA_NUMBERS = [
  ["AR", "011 15 2345-6789", "5491123456789"],
  ["AR", "+54 9 11 2345-6789", "5491123456789"],
  ["AR", "0351 15 512 3456", "5493515123456"],
  ["MX", "55 1234 5678", "525512345678"],
  ["MX", "+52 1 55 1234 5678", "525512345678"],
  ["BR", "(11) 91234-5678", "5511912345678"],
  ["GB", "07400 123456", "447400123456"],
  ["ES", "0044 7400 123456", "447400123456"],
  ["US", "0044 7400 123456", "447400123456"],
  ["US", "011 44 7400 123456", "447400123456"],
  ["US", "(415) 555-2671", "14155552671"],
];
function expectNumbers(got) {
  const bad = WA_NUMBERS.map(([cc, input, digits], i) => [cc, input, digits, got[i]]).filter((r) => r[3] !== "https://wa.me/" + r[2]);
  expect(!bad.length, "wrong links: " + bad.map(([cc, input, digits, href]) => `${cc} "${input}" gave ${href || "no link"}, not wa.me/${digits}`).join("; "));
}
const WA_MESSAGE = "Hola *negrita* _cursiva_ ~tachado~ `code` ```mono```\nSegunda línea 🙌 ¿sí?\n<img src=x onerror=\"window.__xss=1\">";
function expectEncoded(href, message) {
  expect(href === "https://wa.me/447400123456?text=" + encodeURIComponent(message), `the link isn't the number plus the encodeURIComponent message: ${href}`);
  expect(new URL(href).searchParams.get("text") === message, "the message doesn't decode back exactly (line breaks, emoji, accents)");
}
function expectPreview(p) {
  const want = ["strong", "em", "s", "code", "code.mono"];
  expect(JSON.stringify(p.tags) === JSON.stringify(want), `preview elements are ${p.tags.join(", ")}, not ${want.join(", ")}`);
  expect(p.text.includes('<img src=x onerror="window.__xss=1">') && !p.xss, "typed markup became an element or ran");
}
function expectNoLink(s, reason) {
  expect(s.openHidden && !s.href && !s.disabledHidden && s.disabled, `"Open in WhatsApp" is live without a number (link hidden ${s.openHidden}, href "${s.href}")`);
  expect(s.reason === reason, `the visible reason is "${s.reason}", not "${reason}"`);
  expect(s.copyDisabled && s.shareDisabled && s.qrDisabled, "copy, share or QR is enabled without a link");
}
const waState = (page) => page.evaluate(() => {
  const $ = (id) => document.getElementById(id);
  return { openHidden: $("openLink").hidden, href: $("openLink").getAttribute("href") || "", disabledHidden: $("openDisabled").hidden,
    disabled: $("openDisabled").disabled, reason: $("openReason").textContent, copyDisabled: $("copyBtn").disabled,
    shareDisabled: $("shareBtn").disabled, qrDisabled: $("qrBtn").disabled, phoneHidden: $("phoneSection").hidden };
});
function expectCopied(c, link, word) {
  expect(c.copied === link, `the clipboard got ${c.copied}, not ${link}`);
  expect(c.status === word && c.live === "polite", `the copy status says "${c.status}" (aria-live ${c.live}), not "${word}"`);
}
function expectQrBlocked(q, lang) {
  expect(q.disabled, "the QR button is enabled for a link too long for a QR code");
  expect(q.note.includes((WA_QR_MAX + 1).toLocaleString(lang)) && q.note.includes(WA_QR_MAX.toLocaleString(lang)), `the QR note doesn't give the length and the limit: ${q.note}`);
}
function pngSize(buf) {
  expect(buf.subarray(1, 4).toString("latin1") === "PNG", "the QR download isn't a PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
async function qrDownload(page) {
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click("#qrBtn")]);
  const png = await readFile(await download.path());
  const pixels = await page.evaluate(async () => {
    const img = document.querySelector("#qrPreview img");
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++;
    const margin = ctx.getImageData(0, 0, 30, 30).data.every((v) => v === 255);
    return { dark: dark / (c.width * c.height), margin, alt: img.alt };
  });
  return { name: download.suggestedFilename(), size: pngSize(png), ...pixels };
}
function expectQrPng(q, lang) {
  expect(q.name === WA_TEXT[lang].qrFile, `the QR file is called ${q.name}`);
  expect(q.size[0] === 592 && q.size[1] === 592, `the QR PNG is ${q.size.join("x")}, not 592x592`);
  expect(q.margin, "the QR code has no white quiet zone");
  expect(q.dark > 0.15 && q.dark < 0.6, `the QR image is ${Math.round(q.dark * 100)}% dark, not a QR code`);
}
function expectFirst(first, code) {
  expect(first === "country-" + code, `the first option is ${first || "nothing"}, not ${code}`);
}
const WA_STRUCTURE = () => {
  const q = (s) => document.querySelector(s);
  const footer = q("footer.site-footer"), details = q("details.more"), guide = q(".how p.guide-link");
  const after = [...document.body.querySelectorAll("*")].filter((el) => (footer.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    && !footer.contains(el) && !["SCRIPT", "STYLE"].includes(el.tagName) && el.getClientRects().length > 0);
  const order = ["nav.breadcrumbs", "h1", "p.lead", "p.affil", ".tool", ".how-grid", ".share-tool", "details.more", "footer.site-footer"].map(q);
  const inOrder = order.every((el, i) => el && (i === 0 || (order[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)));
  return { after: after.map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : el.className ? "." + String(el.className).split(" ")[0] : "")),
    detailsAfterGuide: !!(guide.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING),
    detailsBeforeFooter: !!(details.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING), inOrder,
    // How it works: three steps in an <ol>, the guide line right under them (a real link, outside the block);
    // Related tools: three cards; one <details>, its <summary> the first child, with no role and no control inside.
    steps: document.querySelectorAll(".how-grid .how > ol > li").length,
    guideAfterSteps: !!guide && guide.previousElementSibling === q(".how-grid .how > ol"),
    guideHref: guide?.querySelector("a[href]")?.getAttribute("href") || "", guideInDetails: !!guide && details.contains(guide),
    cards: document.querySelectorAll(".how-grid .related-aside .related-card").length,
    detailsCount: document.querySelectorAll("details.more").length,
    summaryFirst: details.firstElementChild?.tagName === "SUMMARY", summaryRole: details.querySelector("summary").getAttribute("role"),
    // "Share this tool": exactly one, right after the row and before the block, with one control shown.
    shareTools: document.querySelectorAll(".share-tool").length,
    shareAfterRow: !!q(".share-tool") && !!(q(".how-grid").compareDocumentPosition(q(".share-tool")) & Node.DOCUMENT_POSITION_FOLLOWING),
    shareControls: [q("#shareMenu > summary"), q("#shareNative")].filter((el) => el && el.getClientRects().length > 0).length };
};
function expectStructure(s) {
  expect(!s.after.length, `visible elements after the footer: ${s.after.join(", ")}`);
  expect(s.detailsAfterGuide && s.detailsBeforeFooter, "the collapsed block isn't between the guide link and the footer");
  expect(s.inOrder, "the page isn't breadcrumb, H1, description, not-affiliated line, tool, How it works and Related tools, Share this tool, collapsed block, footer");
  expect(s.shareTools === 1 && s.shareAfterRow && s.shareControls === 1, `${s.shareTools} share blocks (after the row ${s.shareAfterRow}), ${s.shareControls} share controls shown`);
  expect(s.steps === 3, `${s.steps} steps in How it works, not 3`);
  expect(s.guideAfterSteps && /\/blog\/send-whatsapp-without-saving-contact\/$/.test(s.guideHref) && !s.guideInDetails,
    `the guide link isn't right under the steps, outside the collapsed block (href "${s.guideHref}")`);
  expect(s.cards === 3, `${s.cards} Related tools cards, not 3`);
  expect(s.detailsCount === 1 && s.summaryFirst && s.summaryRole === null, `${s.detailsCount} <details>, summary first ${s.summaryFirst}, role ${s.summaryRole}`);
}
function expectNotes(n) {
  expect(n.moved === 6, `${6 - n.moved} field notes still in the tool or missing from the collapsed block`);
  expect(n.sections === 6 && n.faqLast, `${n.sections} sections in the collapsed block, FAQ last ${n.faqLast}`);
  expect(n.facts === 0, "a list of notes is still in the tool");
  expect(n.qrHidden, "the QR note shows before there's a link");
}
const WA_FAQ = () => {
  const visible = [...document.querySelectorAll("details.more .faq-item")].map((el) => [el.children[0].textContent.trim(), el.children[1].textContent.trim()]);
  const graph = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => JSON.parse(s.textContent)["@graph"] || []);
  const faq = graph.find((x) => x["@type"] === "FAQPage");
  return { visible, jsonld: faq.mainEntity.map((x) => [x.name, x.acceptedAnswer.text]) };
};
function expectFaq(f) {
  expect(f.visible.length === 4, `${f.visible.length} FAQ items in the collapsed block, not 4`);
  expect(JSON.stringify(f.visible) === JSON.stringify(f.jsonld), "the FAQ text differs from the FAQPage JSON-LD");
}
function expectIndicator(closed, open) {
  expect(closed && open && closed !== open, `the open/closed indicator doesn't change (${closed} / ${open})`);
}
const waOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
function expectNoOverflow(px, when) {
  expect(px <= 0, `the page scrolls sideways by ${px}px at 320 CSS px (${when})`);
}
// "Share this tool": shares the page's own canonical address (never the generated link) with the H1 as its text,
// through a <details> list of links (and Copy, where the browser can copy) or, on touch devices, the Web Share API.
const WA_SHARE = {
  en: { url: "https://orisod.com/whatsapp-link-generator/", title: "WhatsApp Link Generator", toggle: "Share this tool", newTab: " (opens in a new tab)",
    copied: "Tool link copied", copyFail: "Could not copy the tool link", resultShare: "Share",
    labels: ["Share on WhatsApp", "Copy tool link", "Share on Telegram", "Share on Facebook", "Share on X", "Share on LinkedIn", "Share on Reddit", "Share by email"] },
  es: { url: "https://orisod.com/es/whatsapp-link-generator/", title: "Generador de links de WhatsApp", toggle: "Compartir esta herramienta", newTab: " (se abre en una pestaña nueva)",
    copied: "Link de la herramienta copiado", copyFail: "No se pudo copiar el link de la herramienta", resultShare: "Compartir",
    labels: ["Compartir en WhatsApp", "Copiar link de la herramienta", "Compartir en Telegram", "Compartir en Facebook", "Compartir en X", "Compartir en LinkedIn", "Compartir en Reddit", "Compartir por correo"] },
};
const WA_SHARE_ORDER = ["whatsapp", "copy", "telegram", "facebook", "x", "linkedin", "reddit", "email"];
const WA_SHARE_NEW_TAB = ["whatsapp", "telegram", "facebook", "x", "linkedin", "reddit"];
// Share addresses their services no longer document: each needs a record in the page script (see CLAUDE.md).
const WA_SHARE_UNDOCUMENTED = ["facebook", "linkedin", "reddit"];
// Each service's share address, every parameter encoded on its own. WhatsApp, Telegram and X (intent/tweet) are as
// their current first-party documentation gives them; Facebook, LinkedIn and Reddit are undocumented (records in the page).
function waShareHrefs(u, t) {
  const e = encodeURIComponent;
  return {
    whatsapp: `https://wa.me/?text=${e(t + " " + u)}`,
    telegram: `https://t.me/share/url?url=${e(u)}&text=${e(t)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${e(u)}`,
    x: `https://x.com/intent/tweet?text=${e(t)}&url=${e(u)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${e(u)}`,
    reddit: `https://www.reddit.com/submit?url=${e(u)}&title=${e(t)}`,
    email: `mailto:?subject=${e(t)}&body=${e(t + " " + u)}`,
  };
}
const waShareState = (page) => page.evaluate(() => {
  const menu = document.getElementById("shareMenu"), summary = menu.querySelector("summary"), nativeBtn = document.getElementById("shareNative");
  const status = document.getElementById("shareToolStatus"), active = document.activeElement, list = document.getElementById("shareList");
  const shown = (el) => !!el && el.getClientRects().length > 0;
  const name = (el) => el.querySelector(".share-sr")?.textContent || "";
  const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)]; };
  const items = [...list.querySelectorAll(":scope > li > *")].map((el) => ({ kind: el.dataset.share || (el.id === "shareCopy" ? "copy" : "?"),
    tag: el.tagName.toLowerCase(), href: el.getAttribute("href"), target: el.getAttribute("target"), rel: el.getAttribute("rel"),
    name: name(el), tip: el.querySelector(".share-tip")?.textContent || "", box: box(el) }));
  const lr = list.getBoundingClientRect();
  const rows = [...new Set(items.map((i) => i.box[3]))].map((top) => items.filter((i) => i.box[3] === top));
  // Items that overlap each other (none may).
  let overlapping = 0;
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    const [x, y] = [items[a].box, items[b].box];
    if (x[2] < y[2] + y[0] && y[2] < x[2] + x[0] && x[3] < y[3] + y[1] && y[3] < x[3] + x[1]) overlapping++;
  }
  const labelledby = list.getAttribute("aria-labelledby");
  return { open: menu.open, menuShown: shown(menu), nativeShown: shown(nativeBtn), summaryName: name(summary), nativeName: name(nativeBtn),
    summaryFirst: menu.firstElementChild === summary, summaryRole: summary.getAttribute("role"), summaryExpanded: summary.getAttribute("aria-expanded"),
    nativeType: nativeBtn.getAttribute("type"), summaryBox: shown(summary) ? box(summary) : box(nativeBtn), items, overlapping,
    list: { tag: list.tagName.toLowerCase(), role: list.getAttribute("role"), labelledby, label: labelledby ? document.getElementById(labelledby)?.textContent || "" : "",
      labelInSummary: !!labelledby && summary.contains(document.getElementById(labelledby)), liOnly: [...list.children].every((c) => c.tagName === "LI") },
    rows: rows.map((r) => r.length), offCentre: rows.map((r) => Math.abs((r[0].box[2] - lr.left) - (lr.right - (r[r.length - 1].box[2] + r[r.length - 1].box[0])))),
    status: status.textContent, live: status.getAttribute("aria-live"), changes: window.__shareStatusChanges ?? null,
    focus: active === summary ? "summary" : active === nativeBtn ? "native" : active.closest?.("#shareList") ? "list" : active.id || active.tagName,
    resultShare: document.getElementById("shareBtn").textContent.trim(), actionError: document.getElementById("actionError").textContent };
});
// Counts updates to the share status line (one per copy attempt).
const waWatchShareStatus = (page) => page.evaluate(() => {
  window.__shareStatusChanges = 0;
  new MutationObserver((records) => { window.__shareStatusChanges += records.length; })
    .observe(document.getElementById("shareToolStatus"), { childList: true, characterData: true, subtree: true });
});
function expectShareControl(st, lang) {
  const t = WA_SHARE[lang];
  expect(st.summaryName === t.toggle && st.summaryFirst && st.summaryRole === null && st.summaryExpanded === null,
    `the share summary is "${st.summaryName}" (first child ${st.summaryFirst}, role ${st.summaryRole}, aria-expanded ${st.summaryExpanded})`);
  expect(st.summaryName !== st.resultShare && st.resultShare === t.resultShare, `the share control and the result's share button have the names "${st.summaryName}" and "${st.resultShare}"`);
  expect(st.summaryBox[0] >= 48 && st.summaryBox[1] >= 48, `the share control is ${st.summaryBox[0]}x${st.summaryBox[1]}px, under 48px`);
}
function expectShareList(st, lang) {
  const l = st.list;
  expect(l.tag === "ul" && l.role === null && l.liOnly && l.labelInSummary && l.label === WA_SHARE[lang].toggle,
    `the share list is a <${l.tag}> with role ${l.role}, only <li> children ${l.liOnly}, named by "${l.label}" (in the summary ${l.labelInSummary})`);
}
function expectShareLinks(st, lang, kinds = WA_SHARE_ORDER) {
  const t = WA_SHARE[lang], want = waShareHrefs(t.url, t.title);
  expect(JSON.stringify(st.items.map((i) => i.kind)) === JSON.stringify(kinds), `the share list is ${st.items.map((i) => i.kind).join(", ")}, not ${kinds.join(", ")}`);
  for (const i of st.items) {
    const label = t.labels[WA_SHARE_ORDER.indexOf(i.kind)], newTab = WA_SHARE_NEW_TAB.includes(i.kind);
    expect(i.name === label + (newTab ? t.newTab : "") && i.tip === label, `${i.kind} is named "${i.name}" with the tooltip "${i.tip}"`);
    expect(i.box[0] >= 44 && i.box[1] >= 44, `${i.kind} is ${i.box[0]}x${i.box[1]}px, under 44px`);
    if (i.kind === "copy") { expect(i.tag === "button" && i.href === null, "Copy tool link isn't a button"); continue; }
    expect(i.tag === "a" && i.href === want[i.kind], `${i.kind} links to ${i.href}, not ${want[i.kind]}`);
    expect(newTab ? i.target === "_blank" && i.rel === "noopener noreferrer" : i.target === null, `${i.kind} has target ${i.target}, rel ${i.rel}`);
    // Every parameter decodes back to the canonical address or the title, with no query string or fragment of the page's own URL.
    const params = [...new URL(i.href).searchParams.values()];
    expect(params.length && params.every((v) => v === t.url || v === t.title || v === t.title + " " + t.url), `${i.kind}'s parameters are ${JSON.stringify(params)}`);
  }
}
// One line when all 8 fit, otherwise exactly 4 + 4, centred, with no overlap and no sideways scroll.
function expectShareRows(st, px, want, when) {
  expectNoOverflow(px, when);
  expect(JSON.stringify(st.rows) === JSON.stringify(want) && st.offCentre.every((d) => d <= 1) && !st.overlapping,
    `${when}: the share list has lines of ${st.rows.join(" + ")} (not ${want.join(" + ")}), off centre by ${st.offCentre.join(", ")}px, ${st.overlapping} overlapping items`);
}
function expectNoSecret(texts, what) {
  const leaked = texts.filter((x) => x && (x.includes(WA_SECRET.digits) || WA_SECRET.words.some((w) => x.includes(w))));
  expect(!leaked.length, `${what} carries the number or the message: ${leaked.join(", ")}`);
}
function expectOutsideRequests(urls, when) {
  expect(!urls.length, `requests to another host ${when}: ${urls.join(", ")}`);
}
const waOutside = (requests) => requests.filter((u) => !u.startsWith(SITE + "/") && !u.startsWith(GOATCOUNTER) && !/^(data|blob):/.test(u));
// A context of its own (touch emulation, no JavaScript, no clipboard...): the site from the checkout, GoatCounter answered
// locally, any other host recorded and answered with an empty page (only a click on a share link should reach one).
async function waShareContext(browser, lang, options = {}, init = null) {
  const context = await browser.newContext({ locale: lang === "es" ? "es-ES" : "en-US", ...options });
  const outside = [], errors = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(GOATCOUNTER)) return route.fulfill({ status: 204, body: "" });
    if (url.startsWith(SITE + "/")) return route.fulfill(await localFile(url));
    if (/^(data|blob):/.test(url)) return route.continue();
    outside.push(url);
    return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>outside</title>" });
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(SITE + (lang === "es" ? "/es" : "") + WA, { waitUntil: "load" });
  return { context, page, outside, errors };
}
// A stand-in for navigator.share: records each call, then resolves, cancels (AbortError) or fails as window.__shareMode says.
const WA_SHARE_STUB = () => {
  window.__shareCalls = [];
  window.__shareMode = "resolve";
  Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => {
    window.__shareCalls.push(JSON.parse(JSON.stringify(data)));
    await new Promise((r) => setTimeout(r, 50));
    if (window.__shareMode === "abort") throw new DOMException("Share canceled", "AbortError");
    if (window.__shareMode === "fail") throw new DOMException("Permission denied", "NotAllowedError");
  } });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
};
const waContrast = (a, b) => {
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
// One share circle's colours in the current theme: its fill and icon (the halo, a box-shadow, is never counted),
// its focus ring, its transition and the page behind it.
const waShareColours = (page, sel) => page.evaluate((sel) => {
  const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const el = document.querySelector(sel), cs = getComputedStyle(el);
  return { fill: rgb(cs.backgroundColor), icon: rgb(cs.color), page: rgb(getComputedStyle(document.body).backgroundColor), halo: cs.boxShadow !== "none",
    ring: { style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset, color: rgb(cs.outlineColor) }, transition: cs.transitionDuration };
}, sel);
const WA_SHARE_BLUE = [37, 99, 235], WA_SHARE_LIT = [59, 130, 246];
const WA_SHARE_RING = { style: "solid", width: "2px", offset: "3px", color: [37, 99, 235] };
function expectShareColours(c, what, fill) {
  expect(JSON.stringify(c.fill) === JSON.stringify(fill), `${what}: the circle is rgb(${c.fill}), not rgb(${fill})`);
  expect(waContrast(c.icon, c.fill) >= 3, `${what}: the icon is ${waContrast(c.icon, c.fill).toFixed(2)}:1 on the circle`);
  expect(waContrast(c.fill, c.page) >= 3, `${what}: the circle is ${waContrast(c.fill, c.page).toFixed(2)}:1 against the page`);
}
function expectShareRing(c, what) {
  expect(JSON.stringify(c.ring) === JSON.stringify(WA_SHARE_RING) && waContrast(c.ring.color, c.page) >= 3,
    `${what}: the focus ring is ${JSON.stringify(c.ring)}, ${waContrast(c.ring.color, c.page).toFixed(2)}:1 against the page`);
}
// The visible tooltip (if any), and the controls it overlaps: the toggle, every item and the collapsed block's summary.
const waTipCheck = (page) => page.evaluate(() => {
  const box = (el) => el.getBoundingClientRect();
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const tips = [...document.querySelectorAll("#shareTool .share-tip")].filter((t) => getComputedStyle(t).display !== "none");
  const r = tips[0] ? box(tips[0]) : null;
  const controls = [document.querySelector("#shareMenu > summary"), ...document.querySelectorAll("#shareList > li > *"), document.querySelector("details.more > summary")];
  return { count: tips.length, text: tips[0]?.textContent || "", covers: r ? controls.filter((c) => hit(r, box(c))).map((c) => c.dataset.share || c.id || c.tagName.toLowerCase()) : [],
    inPage: !!r && r.left >= 0 && r.right <= document.documentElement.clientWidth };
});
function expectTip(tip, label, when) {
  expect(label === null ? tip.count === 0 : tip.count === 1 && tip.text === label && tip.inPage && !tip.covers.length,
    `${when}: ${tip.count} tooltips shown ("${tip.text}", inside the page ${tip.inPage}, covering ${tip.covers.join(", ") || "nothing"})`);
}
// Tab through every item with the list open: each shows its own tooltip, inside the page, over no control.
async function waEveryTip(page, lang) {
  await page.focus("#shareMenu > summary");
  const tips = [];
  for (let i = 0; i < WA_SHARE_ORDER.length; i++) {
    await page.keyboard.press("Tab");
    tips.push(await waTipCheck(page));
  }
  return tips;
}
function expectEveryTip(tips, lang, when) {
  tips.forEach((tip, i) => expectTip(tip, WA_SHARE[lang].labels[i], `${when}, ${WA_SHARE_ORDER[i]} focused`));
}
// The records the page keeps for undocumented share addresses (JSON inside the share script).
function waShareRecords(block) {
  const m = block.match(/const UNDOCUMENTED_ENDPOINTS = (\{[\s\S]*?\n  \});/);
  return m ? JSON.parse(m[1]) : null;
}
function expectShareRecords(rec) {
  expect(rec && JSON.stringify(Object.keys(rec).sort()) === JSON.stringify([...WA_SHARE_UNDOCUMENTED].sort()), `undocumented endpoint records for ${rec ? Object.keys(rec).join(", ") : "nothing"}, not ${WA_SHARE_UNDOCUMENTED.join(", ")}`);
  for (const [name, r] of Object.entries(rec)) {
    const missing = ["status", "lastVerified", "result", "testedUrl"].filter((k) => typeof r[k] !== "string" || !r[k].trim());
    expect(!missing.length, `the ${name} record lacks ${missing.join(", ")}`);
    expect(r.status === "undocumented" && /^https:\/\/orisod\.com\//.test(r.testedUrl), `the ${name} record says status "${r.status}", testedUrl "${r.testedUrl}"`);
    // A date that isn't in the future, or "not verified" with the result saying the owner must check it.
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(r.lastVerified) && r.lastVerified <= new Date().toISOString().slice(0, 10);
    const unverified = r.lastVerified === "not verified" && r.result.startsWith("not verified by Code, owner to check manually");
    expect(dated || unverified, `the ${name} record's lastVerified is "${r.lastVerified}"`);
  }
}
// Hover-to-open and close after choosing a service: the delays in the page script (HOVER_OPEN_MS, HOVER_CLOSE_MS, COPY_CLOSE_MS).
const WA_HOVER_OPEN = 120, WA_HOVER_CLOSE = 300, WA_COPY_CLOSE = 1200;
const waMenu = (page) => page.evaluate(() => {
  const menu = document.getElementById("shareMenu"), summary = menu.querySelector("summary"), a = document.activeElement;
  return { open: menu.open, focus: a === summary ? "summary" : a.closest?.("#shareList") ? "list" : a.tagName, ring: a === summary && summary.matches(":focus-visible") };
});
// The centre of an element, for moving the mouse onto it.
const waCentre = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
async function waMouseTo(page, sel) {
  await page.locator(sel).scrollIntoViewIfNeeded();
  const [x, y] = await waCentre(page, sel);
  await page.mouse.move(x, y, { steps: 3 });
}
function expectMenu(m, open, when, focus = null, ring = null) {
  expect(m.open === open && (focus === null || m.focus === focus) && (ring === null || m.ring === ring),
    `${when}: the list is ${m.open ? "open" : "closed"} (want ${open ? "open" : "closed"}), focus on ${m.focus}${focus ? ` (want ${focus})` : ""}, visible ring ${m.ring}`);
}
// The placeholders: the message's fixed text and the phone field's example for the chosen country
// (libphonenumber-js's examples.mobile.json in its national format; without it, only the US gets one).
const WA_EXAMPLES = "/assets/vendor/libphonenumber-js/1.13.15/examples.mobile.json";
const WA_MSG_PLACEHOLDER = { en: "Hello, I have a question", es: "Hola, tengo una pregunta" };
const WA_US_FALLBACK = "202 555 0123";
const WA_LABELS = { en: { phoneInput: "Phone number", messageInput: "Message (optional)" }, es: { phoneInput: "Número de teléfono", messageInput: "Mensaje (opcional)" } };
// Territories that share a bigger country's numbering plan: their example is a valid number, but libphonenumber
// (and so the page's status line) names the main country when it reads it back.
const WA_SHARED_PLAN = { AX: "FI", BL: "GP", CC: "AU", CX: "AU", EH: "MA", IM: "GB", MF: "GP", SJ: "NO", VA: "IT" };
const waPick = (page, code) => page.evaluate((c) => document.getElementById("country-" + c).click(), code);
const waPlaceholder = (page) => page.getAttribute("#phoneInput", "placeholder");
// Every country in the list: its placeholder, what the examples file says it should be, and what typing it gives.
async function waEveryExample(page, examples) {
  const codes = await page.evaluate(() => [...document.querySelectorAll("#countryList li")].map((li) => li.id.slice("country-".length)));
  const rows = [];
  for (const code of codes) {
    await waPick(page, code);
    const placeholder = (await waPlaceholder(page)) || "";
    await waNumber(page, placeholder);
    rows.push(await page.evaluate(([code, placeholder, examples]) => {
      const lib = window.libphonenumber, ex = lib.getExampleNumber(code, examples);
      const row = { code, placeholder, want: ex ? ex.formatNational() : "", e164: ex ? ex.number : "",
        href: document.getElementById("openLink").getAttribute("href") || "", error: document.getElementById("phoneError").textContent };
      try { const n = lib.parsePhoneNumber(placeholder, code); row.valid = n.isValid(); row.parsed = n.number; row.country = n.country; } catch (e) { row.valid = false; }
      return row;
    }, [code, placeholder, examples]));
  }
  return rows;
}
function expectExamples(rows) {
  expect(rows.length > 200, `only ${rows.length} countries in the list`);
  const bad = rows.filter((r) => r.placeholder !== r.want || (r.want && (!r.valid || r.parsed !== r.e164 || r.error ||
    r.href !== "https://wa.me/" + r.e164.slice(1) || (r.country !== r.code && WA_SHARED_PLAN[r.code] !== r.country))));
  expect(!bad.length, "examples that fail: " + bad.map((r) => `${r.code} "${r.placeholder}" (want "${r.want}", valid ${r.valid}, read as ${r.country}, link ${r.href || "none"}${r.error ? ", error " + r.error : ""})`).join("; "));
}
// Placeholder text against the field's own background, in the current theme.
const waPlaceholderContrast = (page, sel) => page.evaluate((s) => {
  const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const el = document.querySelector(s);
  let bg = [0, 0, 0];
  for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || c[3] > 0) { bg = c; break; } }
  const fg = rgb(getComputedStyle(el, "::placeholder").color), a = fg.length === 4 ? fg[3] : 1;
  const mixed = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
  const [l1, l2] = [lum(mixed), lum(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}, sel);
function expectContrast(ratio, what) {
  expect(ratio >= 4.5, `${what} placeholder contrast is ${ratio.toFixed(2)}:1, under 4.5:1`);
}
function expectLabels(labels, lang) {
  for (const [id, text] of Object.entries(WA_LABELS[lang])) expect(labels[id] === text, `the ${id} label is "${labels[id]}", not "${text}"`);
}
const waLabels = (page) => page.evaluate(() => Object.fromEntries(["phoneInput", "messageInput"].map((id) => [id, document.querySelector(`label[for="${id}"]`)?.textContent.trim() || ""])));
const WA_SECRET = { digits: "447400123456", words: ["Zanahoria", "secreta"] };
function expectNothingSent(requests, url, start) {
  const leaked = requests.filter((r) => r.includes(WA_SECRET.digits) || WA_SECRET.words.some((w) => r.includes(w)));
  expect(!leaked.length, `a request carried the number or the message: ${leaked.join(", ")}`);
  expect(url === start, `the page URL changed to ${url}`);
}

// The formatting toolbar and the emoji picker (added with the guide diagram, 2026-11-02).
const WA_GUIDE = "/blog/send-whatsapp-without-saving-contact/";
const WA_FMT = {
  en: { cross: "Select text that does not overlap other formatting", mono: "Monospace can't be combined", firstEmoji: "grinning face", heart: "red heart", luggage: "luggage", gestures: "Gestures" },
  es: { cross: "Selecciona texto que no se superponga con otro formato", mono: "El monoespaciado no se puede combinar", firstEmoji: "cara sonriente", heart: "corazón rojo", luggage: "equipaje", gestures: "Gestos" },
};
// Put a value in the message, select [s, e) and reset the input event counter.
async function waSelect(page, value, s, e) {
  await page.fill("#messageInput", value);
  await page.evaluate(([s, e]) => {
    const t = document.getElementById("messageInput");
    if (!window.__waInputs) { window.__waInputs = { n: 0 }; t.addEventListener("input", () => window.__waInputs.n++); }
    t.focus();
    t.setSelectionRange(s, e);
    window.__waInputs.n = 0;
  }, [s, e]);
}
const waMsgState = (page) => page.evaluate(() => {
  const t = document.getElementById("messageInput");
  return { value: t.value, sel: [t.selectionStart, t.selectionEnd], inputs: window.__waInputs ? window.__waInputs.n : 0, focus: document.activeElement.id,
    strong: [...document.querySelectorAll("#bubble strong")].map((x) => x.textContent), link: document.getElementById("linkOutput").value,
    status: document.getElementById("fmtStatus").textContent };
});
async function waFormat(page, kind, value, s, e) {
  await waSelect(page, value, s, e);
  await page.click(`.fmt-btn[data-format="${kind}"]`);
  await page.waitForTimeout(100); // a refusal hint is written 50 ms later
  return waMsgState(page);
}
function expectValue(got, want, what) {
  expect(got.value === want, `${what}: the message is ${JSON.stringify(got.value)}, not ${JSON.stringify(want)}`);
}
function expectOneInput(got, what) {
  expect(got.inputs === 1, `${what}: ${got.inputs} input events, not exactly 1`);
}
// Every emoji one character (one grapheme), no joiner, skin tone or flag, no duplicate emoji or name, 6 categories.
const WA_EMOJI_DATA = () => {
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  const odd = (s) => [...s].some((ch) => { const c = ch.codePointAt(0); return c === 0x200D || (c >= 0x1F3FB && c <= 0x1F3FF) || (c >= 0x1F1E6 && c <= 0x1F1FF); });
  const uniq = (key) => EMOJI.length - new Set(EMOJI.map((x) => x[key])).size;
  const cats = EMOJI_CATEGORIES.map((c) => c.id);
  return { count: EMOJI.length, cats: cats.length, perCat: cats.map((c) => EMOJI.filter((x) => x.category === c).length),
    unknownCat: EMOJI.filter((x) => !cats.includes(x.category)).length, notOne: EMOJI.filter((x) => [...seg.segment(x.emoji)].length !== 1 || odd(x.emoji)).map((x) => x.emoji),
    dup: uniq("emoji") + uniq("name_en") + uniq("name_es"), missingName: EMOJI.filter((x) => !x.name_en || !x.name_es).length };
};
function expectEmojiData(d) {
  expect(d.count === 118 && d.cats === 6 && !d.unknownCat, `${d.count} emojis in ${d.cats} categories (${d.unknownCat} in no category), not 118 in 6`);
  expect(JSON.stringify(d.perCat) === "[18,17,18,28,19,18]", `emojis per category ${d.perCat.join("/")}, not 18/17/18/28/19/18`);
  expect(!d.notOne.length, `not a single emoji (or a joiner, skin tone or flag): ${d.notOne.join(" ")}`);
  expect(!d.dup && !d.missingName, `${d.dup} duplicate emojis or names, ${d.missingName} missing names`);
}
const emojiBlock = (html) => {
  const a = html.indexOf("// Emoji data: start"), b = html.indexOf("// Emoji data: end");
  expect(a >= 0 && b > a, "no emoji data block in the page");
  return html.slice(a, b);
};
function expectSameEmojiData(en, es) {
  expect(emojiBlock(en) === emojiBlock(es), "the EN and ES pages' emoji data blocks differ");
}
function expectTabStops(stops, lang) {
  expect(stops.length === 2 && stops[0].role === "tab" && stops[0].selected && stops[1].cls === "emoji-btn",
    `from the message, Tab reached ${stops.map((s) => s.role || s.cls).join(", ")} before the emoji grid, not the selected tab then the grid (${lang})`);
}
const WA_DIAGRAM = () => [...document.querySelectorAll("figure.wa-flow svg")].map((s) => ({
  cls: s.getAttribute("class"), shown: getComputedStyle(s).display !== "none", hidden: s.getAttribute("aria-hidden") === "true",
  role: s.getAttribute("role"), label: s.getAttribute("aria-label") }));
function expectOneDiagram(svgs, snapImgs, width) {
  expect(svgs.length === 2 && svgs[0].label && svgs[0].label === svgs[1].label && svgs.every((s) => s.role === "img"), `the two diagrams don't share role="img" and one aria-label`);
  const shown = svgs.filter((s) => s.shown);
  expect(shown.length === 1 && !shown[0].hidden && svgs.filter((s) => !s.shown).every((s) => s.hidden), `at ${width}px: ${shown.length} diagrams shown, aria-hidden ${svgs.map((s) => s.hidden).join("/")}`);
  expect(snapImgs === 1, `at ${width}px the accessibility tree exposes ${snapImgs} diagrams, not 1`);
  expect(shown[0].cls === (width < 640 ? "wa-flow-stacked" : "wa-flow-wide"), `at ${width}px the ${shown[0].cls} diagram is shown`);
}

const CASES = [
  {
    name: "spark-md5",
    page: "/hash-checksum-generator/",
    vendor: ["/assets/vendor/spark-md5/3.0.2/spark-md5.min.js"],
    async run(page) {
      await page.fill("#textInput", "abc");
      const row = page.locator('.hash-row[data-algo="MD5"] .hash-value');
      await row.waitFor({ timeout: 10000 });
      const md5 = (await row.textContent()).trim();
      expect(md5 === "900150983cd24fb0d6963f7d28e17f72", `MD5("abc") was ${md5}`);
      return `MD5("abc") = ${md5}`;
    },
  },
  {
    name: "qrcodejs",
    page: "/qr-code-generator/",
    vendor: ["/assets/vendor/qrcodejs/1.0.0/qrcode.min.js"],
    async run(page) {
      await page.fill("#textInput", "https://orisod.com/");
      await page.click("#generateBtn");
      const link = page.locator('#result a[download="qrcode.png"]');
      await link.waitFor({ timeout: 10000 });
      const href = await link.getAttribute("href");
      expect(href.startsWith("data:image/png;base64,"), "the download link isn't a PNG");
      const info = await page.evaluate(() => {
        const c = document.querySelector("#qrCanvasWrap canvas");
        const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 150) dark++;
        return { w: c.width, h: c.height, dark: dark / (c.width * c.height) };
      });
      expect(info.w > 100 && info.w === info.h, `QR canvas is ${info.w}x${info.h}`);
      expect(info.dark > 0.25 && info.dark < 0.75, `QR canvas is ${Math.round(info.dark * 100)}% dark, not a QR code`);
      return `${info.w}x${info.h} QR image, ${Math.round(info.dark * 100)}% dark modules, PNG download offered`;
    },
  },
  {
    name: "suncalc",
    page: "/hebrew-calendar-generator/",
    vendor: ["/assets/vendor/suncalc/1.9.0/suncalc.min.js"],
    noJspdf: true,
    async run(page, lang) {
      await page.fill("#citySearchInput", "Jerus");
      const city = page.locator("#citySuggestions .city-suggestion").first();
      await city.waitFor({ timeout: 15000 });
      await city.click();
      const chosen = await page.inputValue("#citySearchInput");
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#downloadBtn")]);
      const bytes = await readFile(await download.path());
      expect(bytes.subarray(0, 5).toString() === "%PDF-", "the download isn't a PDF");
      const text = pdfText(bytes);
      const word = lang === "es" ? "Velas" : "Candles";
      const times = text.match(new RegExp(`${word} \\d{1,2}:\\d{2}`, "g")) || [];
      expect(times.length >= 40, `the PDF has ${times.length} "${word} <time>" lines`);
      return `${chosen}: ${download.suggestedFilename()}, ${bytes.length} bytes, ${times.length} candle-lighting times (e.g. "${times[0]}")`;
    },
  },
  {
    name: "turndown + turndown-plugin-gfm",
    page: "/convert-to-markdown/",
    vendor: ["/assets/vendor/turndown/7.2.4/turndown.js", "/assets/vendor/turndown-plugin-gfm/1.0.2/turndown-plugin-gfm.js"],
    async run(page) {
      await page.click('#modeRow [data-mode="html"]');
      await page.fill("#htmlInput", "<h2>Fruit</h2><table><thead><tr><th>Name</th><th>Qty</th></tr></thead>" +
        "<tbody><tr><td>Apple</td><td>3</td></tr><tr><td>Pear</td><td>5</td></tr></tbody></table>");
      await page.waitForFunction(() => document.getElementById("markdownOutput").value.includes("| Pear"), null, { timeout: 10000 });
      const md = await page.inputValue("#markdownOutput");
      const want = "## Fruit\n\n| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n| Pear | 5 |";
      expect(md === want, `Markdown was:\n${md}`);
      return "HTML table became a pipe table (## Fruit | Name | Qty | ...)";
    },
  },
  {
    name: "pdf-lib (Merge PDF)",
    page: "/merge-pdf/",
    vendor: ["/assets/vendor/pdf-lib/1.17.1/pdf-lib.min.js"],
    async run(page) {
      const a = { name: "a.pdf", mimeType: "application/pdf", buffer: fixturePdf("Fixture A", ["page 1", "page 2"]) };
      const b = { name: "b.pdf", mimeType: "application/pdf", buffer: fixturePdf("Fixture B", ["page 1", "page 2", "page 3"]) };
      const want = pdfPageCount(a.buffer) + pdfPageCount(b.buffer);
      expect(want === 5, `the fixtures have ${want} pages, not 2 + 3`);
      await page.setInputFiles("#fileInput", [a, b]);
      await page.click("#mergeBtn");
      const link = page.locator('#result a[download="merged.pdf"]');
      await link.waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      expect(bytes.subarray(0, 5).toString() === "%PDF-", "the download isn't a PDF");
      const pages = pdfPageCount(bytes);
      expect(pages === want, `merged.pdf has ${pages} pages, not ${want}`);
      const order = pdfText(bytes).trim().split("\n");
      const wantOrder = ["Fixture A page 1", "Fixture A page 2", "Fixture B page 1", "Fixture B page 2", "Fixture B page 3"];
      expect(order.join("|") === wantOrder.join("|"), `merged pages read ${JSON.stringify(order)}`);
      return `2-page + 3-page PDF merged into ${pages} pages, in order (${bytes.length} bytes)`;
    },
  },
  {
    name: "pdf-lib (Calendar generator)",
    page: "/calendar-generator/",
    vendor: ["/assets/vendor/pdf-lib/1.17.1/pdf-lib.min.js"],
    noJspdf: true,
    async run(page, lang) {
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#downloadBtn")]);
      const year = (download.suggestedFilename().match(/^calendar(?:io)?-(\d{4})\.pdf$/) || [])[1];
      expect(year, `the download is called ${download.suggestedFilename()}`);
      const bytes = await readFile(await download.path());
      expect(bytes.subarray(0, 5).toString() === "%PDF-", "the download isn't a PDF");
      const pages = pdfPageCount(bytes);
      expect(pages === 12, `the calendar PDF has ${pages} pages, not 12`);
      const months = lang === "es" ? ["Enero", "Diciembre"] : ["January", "December"];
      const text = pdfText(bytes);
      for (const m of months) expect(text.includes(`${m} ${year}`), `the PDF has no "${m} ${year}" heading`);
      return `${download.suggestedFilename()}: ${pages} pages, "${months[0]} ${year}" to "${months[1]} ${year}" (${bytes.length} bytes)`;
    },
  },
  {
    name: "PDF.js (Extract PDF Text)",
    page: "/extract-pdf-text/",
    vendor: [PDFJS, PDFJS_WORKER],
    worker: PDFJS_WORKER,
    async run(page) {
      const pdf = fixturePdf("Fixture", ["alpha", "bravo", "charlie"]);
      await page.setInputFiles("#fileInput", { name: "text.pdf", mimeType: "application/pdf", buffer: pdf });
      await page.click("#extractBtn");
      await page.waitForFunction(() => document.getElementById("textArea").value.includes("charlie"), null, { timeout: 30000 });
      const text = await page.inputValue("#textArea");
      const found = ["Fixture alpha", "Fixture bravo", "Fixture charlie"].map((s) => text.indexOf(s));
      expect(found.every((at, i) => at >= 0 && (i === 0 || at > found[i - 1])), `extracted text was:\n${text}`);
      return `3-page PDF: "Fixture alpha", "Fixture bravo", "Fixture charlie" extracted in order`;
    },
  },
  {
    name: "PDF.js (Compare PDFs)",
    page: "/compare-pdfs/",
    vendor: [PDFJS, PDFJS_WORKER],
    worker: PDFJS_WORKER,
    async run(page) {
      const a = fixturePdf("Line", ["one", "two"]);
      const b = fixturePdf("Line", ["one", "three"]);
      await page.setInputFiles("#fileInputA", { name: "a.pdf", mimeType: "application/pdf", buffer: a });
      await page.setInputFiles("#fileInputB", { name: "b.pdf", mimeType: "application/pdf", buffer: b });
      await page.click("#compareBtn");
      await page.locator("#diffLines .diff-line").first().waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("#downloadDiffBtn")]);
      const lines = (await readFile(await download.path(), "utf-8")).split("\n");
      for (const want of ["  Line one", "- Line two", "+ Line three"])
        expect(lines.includes(want), `the diff has no "${want}" line:\n${lines.join("\n")}`);
      return `diff of two 2-page PDFs: "Line one" unchanged, "- Line two", "+ Line three"`;
    },
  },
  {
    name: "PDF.js + pdf-lib (PDF Page Organizer)",
    page: "/pdf-page-organizer/",
    vendor: [PDFJS, PDFJS_WORKER, "/assets/vendor/pdf-lib/1.17.1/pdf-lib.min.js"],
    worker: PDFJS_WORKER,
    async run(page) {
      const pdf = fixturePdf("Fixture", ["page 1", "page 2", "page 3"]);
      await page.setInputFiles("#fileInput", { name: "three.pdf", mimeType: "application/pdf", buffer: pdf });
      await page.locator("#saveBtn").waitFor({ state: "visible", timeout: 30000 });
      const thumbs = await page.evaluate(async () => {
        const out = [];
        for (const img of document.querySelectorAll("#pagesGrid .page-card img")) {
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const { data } = ctx.getImageData(0, 0, c.width, c.height);
          let dark = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 300) dark++;
          out.push(dark);
        }
        return out;
      });
      expect(thumbs.length === 3, `${thumbs.length} thumbnails, not 3`);
      expect(thumbs.every((d) => d > 5), `a thumbnail is blank (dark pixels: ${thumbs.join(", ")})`);
      await page.locator("#pagesGrid .page-card").nth(1).locator(".delete-btn").click();
      await page.click("#saveBtn");
      const link = page.locator('#result a[download="three-organized.pdf"]');
      await link.waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      const pages = pdfPageCount(bytes);
      const text = pdfText(bytes).trim().split("\n");
      expect(pages === 2 && text.join("|") === "Fixture page 1|Fixture page 3", `saved PDF: ${pages} pages, ${JSON.stringify(text)}`);
      return `3 thumbnails drawn by PDF.js (${thumbs.join("/")} text pixels); page 2 removed, saved PDF has pages 1 and 3`;
    },
  },
  {
    name: "jsPDF (JPG to PDF)",
    page: "/jpg-to-pdf/",
    vendor: [JSPDF],
    async run(page) {
      const a = await fixtureJpeg(page, 400, 300);
      const b = await fixtureJpeg(page, 300, 500);
      await page.setInputFiles("#fileInput", [
        { name: "a.jpg", mimeType: "image/jpeg", buffer: a },
        { name: "b.jpg", mimeType: "image/jpeg", buffer: b },
      ]);
      await page.click("#convertBtn");
      const link = page.locator('#result a[download="converted.pdf"]');
      await link.waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      expect(bytes.subarray(0, 5).toString() === "%PDF-", "the download isn't a PDF");
      const pages = pdfPageCount(bytes);
      expect(pages === 2, `converted.pdf has ${pages} pages, not 2`);
      const boxes = [...bytes.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => `${+m[1]}x${+m[2]}`);
      expect(boxes.join("|") === "400x300|300x500", `page sizes ${JSON.stringify(boxes)}, not 400x300 and 300x500`);
      const jpegs = pdfJpegs(bytes);
      expect(jpegs.length === 2 && jpegs[0].equals(a) && jpegs[1].equals(b), `the PDF's ${jpegs.length} images aren't the two uploaded JPEGs, in order`);
      return `2 JPEGs became a 2-page PDF (400x300 and 300x500 pt pages, both images embedded unchanged, ${bytes.length} bytes)`;
    },
  },
  {
    // JPG to PDF hands jsPDF the file's own bytes, and jsPDF reads their real format:
    // a PNG named .jpg must still become one page with the whole picture.
    name: "jsPDF (JPG to PDF, a PNG named .jpg)",
    page: "/jpg-to-pdf/",
    vendor: [JSPDF],
    async run(page) {
      const png = await fixtureImage(page, 160, 120, "image/png");
      await page.setInputFiles("#fileInput", { name: "really-a-png.jpg", mimeType: "image/jpeg", buffer: png });
      await page.click("#convertBtn");
      const link = page.locator('#result a[download="converted.pdf"]');
      await link.waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      const check = (b) => {
        const pages = jspdfPages(b);
        // jsPDF stores PNG pixels as plain RGB (no filter): check the left edge is black and the right edge white.
        expectImagePages(pages, [{ pw: 160, ph: 120, w: 160, h: 120, filter: "none" }]);
        const px = pages[0].images[0].data;
        expect(px.length === 160 * 120 * 3, `the image holds ${px.length} bytes, not 160x120 RGB`);
        expect(px[0] + px[1] + px[2] === 0 && px[159 * 3] + px[159 * 3 + 1] + px[159 * 3 + 2] === 765, "the image isn't black on the left and white on the right");
      };
      check(bytes);
      const negative = mustFail("an image of the wrong width", () => check(tamper(bytes, "/Width 160", "/Width 161")));
      return `really-a-png.jpg became a 1-page 160x120 pt PDF drawing its 160x120 RGB pixels; ${negative}`;
    },
  },
  {
    name: "jsPDF (Image to PDF)",
    page: "/image-to-pdf/",
    vendor: [JSPDF],
    async run(page) {
      const files = [
        { name: "a.jpg", mimeType: "image/jpeg", buffer: await fixtureJpeg(page, 400, 300) },
        { name: "b.png", mimeType: "image/png", buffer: await fixtureImage(page, 200, 150, "image/png", { transparent: true }) },
        { name: "c.webp", mimeType: "image/webp", buffer: await fixtureImage(page, 120, 160, "image/webp") },
      ];
      await page.setInputFiles("#fileInput", files);
      await page.click("#convertBtn");
      const link = page.locator('#result a[download="converted.pdf"]');
      await link.waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      // Every format is redrawn on white and stored as a JPEG of the picture's own size, on a page of that size.
      const want = [[400, 300], [200, 150], [120, 160]].map(([w, h]) => ({ pw: w, ph: h, w, h, filter: "DCTDecode" }));
      const pages = jspdfPages(bytes);
      expectImagePages(pages, want);
      for (const [i, p] of pages.entries()) {
        const { dark, total } = await jpegStats(page, p.images[0].data);
        expect(dark / total > 0.4 && dark / total < 0.6, `page ${i + 1}'s image is ${Math.round((100 * dark) / total)}% dark, not its black left half`);
      }
      const negative = mustFail("a page without its image", () => expectImagePages(jspdfPages(tamper(bytes, "/I2 Do", "/I2 Dx")), want));
      return `JPG, transparent PNG and WebP became 3 pages (400x300, 200x150, 120x160 pt), each one JPEG of that size, half dark; ${negative}`;
    },
  },
  {
    // Strong mode redraws each page with PDF.js at 1.5x and stores it as a JPEG through jsPDF,
    // drawn into a page of the original's size (the 1.5x only sets the image's resolution).
    name: "PDF.js + jsPDF (Compress PDF, Strong)",
    page: "/compress-pdf/",
    vendor: [PDFJS, PDFJS_WORKER, JSPDF],
    worker: PDFJS_WORKER,
    async run(page) {
      const pdf = fixtureImagePdf(RASTER_PAGES, [0, 0, 0]);
      await page.setInputFiles("#fileInput", { name: "scan.pdf", mimeType: "application/pdf", buffer: pdf });
      await page.check('input[name="compressMode"][value="strong"]', { force: true });
      await page.locator("#compressBtn:not([disabled])").waitFor({ timeout: 30000 });
      await page.click("#compressBtn");
      const link = page.locator('#result a[download="scan-compressed.pdf"]');
      await link.waitFor({ timeout: 60000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      expect(bytes.length < pdf.length, `scan-compressed.pdf is ${bytes.length} bytes, not smaller than the ${pdf.length}-byte original`);
      const want = RASTER_SHOWN.map(([pw, ph]) => ({ pw, ph, w: pw * 1.5, h: ph * 1.5 }));
      const pages = jspdfPages(bytes);
      expectRasterPages(pages, want);
      for (const [i, p] of pages.entries()) {
        const { dark, total } = await jpegStats(page, p.images[0].data);
        expect(dark / total > 0.4 && dark / total < 0.6, `page ${i + 1} is ${Math.round((100 * dark) / total)}% dark, not the scan's black left half`);
      }
      const negatives = [
        mustFail("a page without its image", () => expectRasterPages(jspdfPages(tamper(bytes, "/I1 Do", "/I1 Dx")), want)),
        mustFail("pages at the 1.5x render size", () => expectRasterPages(pages.map((p) => ({ ...p, w: p.w * 1.5, h: p.h * 1.5 })), want)),
      ];
      return `3-page scan (${pdf.length} bytes) became scan-compressed.pdf (${bytes.length} bytes): pages 612x792, 792x612 and the /Rotate 90 page 792x612 pt like the original, each one 1.5x JPEG, half dark; ${negatives.join("; ")}`;
    },
  },
  {
    name: "PDF.js + jsPDF (PDF color filters)",
    page: "/pdf-color-filters/",
    vendor: [PDFJS, PDFJS_WORKER, JSPDF],
    worker: PDFJS_WORKER,
    async run(page, lang) {
      const pdf = fixtureImagePdf(RASTER_PAGES, [220, 30, 30]);
      await page.setInputFiles("#fileInput", { name: "red.pdf", mimeType: "application/pdf", buffer: pdf });
      await page.locator('[data-filter="grayscale"]').waitFor({ state: "visible", timeout: 30000 });
      await page.click('[data-filter="grayscale"]');
      await page.locator("#applyBtn:not([disabled])").waitFor({ timeout: 30000 });
      await page.click("#applyBtn");
      const name = lang === "es" ? "red-filtrado.pdf" : "red-filtered.pdf";
      const link = page.locator(`#result a[download="${name}"]`);
      await link.waitFor({ timeout: 60000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      // Pages are redrawn at 2x (RENDER_SCALE) and drawn into a page of the original's size.
      const want = RASTER_SHOWN.map(([pw, ph]) => ({ pw, ph, w: pw * 2, h: ph * 2 }));
      const pages = jspdfPages(bytes);
      expectRasterPages(pages, want);
      // Black & White: the red half must come out a dark gray, with no channel far from the others.
      const gray = ({ dark, total, spread }) => expect(spread <= 12 && dark / total > 0.4 && dark / total < 0.6, `the page is ${Math.round((100 * dark) / total)}% dark with channels up to ${spread} apart, not a gray version of the red half`);
      const stats = [];
      for (const p of pages) stats.push(await jpegStats(page, p.images[0].data));
      stats.forEach(gray);
      const red = await jpegStats(page, await fixtureImage(page, 200, 259, "image/jpeg", { left: "rgb(220,30,30)" }));
      const negatives = [
        mustFail("the red page left in color", () => gray(red)),
        mustFail("pages at the 2x render size", () => expectRasterPages(pages.map((p) => ({ ...p, w: p.w * 2, h: p.h * 2 })), want)),
      ];
      return `${name}: pages 612x792, 792x612 and the /Rotate 90 page 792x612 pt like the original, each one 2x JPEG, the red half now gray (channels at most ${Math.max(...stats.map((x) => x.spread))} apart); ${negatives.join("; ")}`;
    },
  },
  {
    // Text drawn with jsPDF's built-in Helvetica: accents and € must be written as their
    // WinAnsi bytes (ó \xf3, ñ \xf1, í \xed, € \x80, • \x95), and a long bullet wrapped
    // into several lines of one paragraph.
    name: "JSZip + jsPDF (PowerPoint to PDF)",
    page: "/powerpoint-to-pdf/",
    vendor: [JSZIP, JSPDF],
    async run(page, lang, ctl) {
      const long = "A long bullet that has to wrap onto more than one line of the PDF page, because its words run far past the width that the slide text is allowed to use.";
      const pptx = fixturePptx([["Smoke deck: Canción de mañana", "Precio: 5 € por día", long], ["Second slide", "Last point"]]);
      await page.setInputFiles("#fileInput", { name: "deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: pptx });
      await page.locator("#convertBtn").waitFor({ state: "visible", timeout: 30000 });
      await page.click("#convertBtn");
      const link = page.locator('#result a[download="deck.pdf"]');
      await link.waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      const slide = lang === "es" ? "Diapositiva" : "Slide";
      const check = (pages) => {
        expect(pages.map((p) => `${p.w}x${p.h}`).join("|") === "612x792|612x792", `pages are ${pages.map((p) => `${p.w}x${p.h}`).join(", ")}, not two Letter pages`);
        const lines = pages[0].blocks.flat();
        expect(lines.includes("Smoke deck: Canci\xf3n de ma\xf1ana"), `page 1 has no "Canci\\xf3n de ma\\xf1ana" title: ${JSON.stringify(lines)}`);
        expect(lines.includes("\x95  Precio: 5 \x80 por d\xeda"), `page 1 has no "\\x95  Precio: 5 \\x80 por d\\xeda" bullet: ${JSON.stringify(lines)}`);
        const wrapped = pages[0].blocks.find((b) => b[0].startsWith("\x95  A long bullet"));
        expect(wrapped && wrapped.length >= 2 && wrapped.join(" ") === "\x95  " + long, `the long bullet isn't wrapped into lines of one paragraph: ${JSON.stringify(wrapped)}`);
        pages.forEach((p, i) => expect(p.blocks.at(-1).join() === `${slide} ${i + 1}`, `page ${i + 1} doesn't end with "${slide} ${i + 1}"`));
        return wrapped.length;
      };
      const wrappedLines = check(jspdfPages(bytes));
      const unwrapped = jspdfPages(bytes).map((p) => ({ ...p, blocks: p.blocks.map((b) => [b.join(" ")]) }));
      const negatives = [
        mustFail("ó written as a plain o", () => check(jspdfPages(tamper(bytes, "Canci\xf3n", "Cancion")))),
        mustFail("€ not written as \\x80", () => check(jspdfPages(tamper(bytes, "5 \x80 por", "5 E por")))),
        mustFail("the long bullet on one line", () => check(unwrapped)),
      ];
      // Windows-1252 only: no font file is fetched and the PDF is exactly what main produced.
      const noFont = (requests) => expect(!requests.some((u) => u.includes("/assets/vendor/liberation-sans/")), `the page fetched Liberation Sans for a Windows-1252 deck: ${requests.filter((u) => u.includes("liberation")).join(", ")}`);
      const sameAsMain = (b) => expect(stableSha(b) === LATIN_DECK_SHA[lang], `deck.pdf (stamp and date removed) has sha256 ${stableSha(b)}, not main's ${LATIN_DECK_SHA[lang]}`);
      noFont(ctl.requests);
      sameAsMain(bytes);
      expect((await warnState(page)).text === null, "a Windows-1252 deck shows the unsupported-characters warning");
      negatives.push(
        mustFail("a font request", () => noFont([...ctl.requests, SITE + FONT_REGULAR])),
        mustFail("a PDF one byte off main's", () => sameAsMain(tamper(bytes, "Smoke deck", "Smoke deck".replace("S", "Z")))),
      );
      return `deck.pdf: 2 Letter pages, "Canci\\xf3n de ma\\xf1ana" and "5 \\x80" in WinAnsi, the long bullet wrapped into ${wrappedLines} lines, "${slide} 1/2" footers; no font fetched, identical to main's PDF apart from stamp and date; ${negatives.join("; ")}`;
    },
  },
  {
    // Greek, Cyrillic and Latin Extended (with Vietnamese): the page fetches Liberation Sans and draws
    // the whole deck with it, titles in Bold. FONT_RANGES must be what the vendored fonts' cmaps give.
    name: "JSZip + jsPDF + Liberation Sans (PowerPoint to PDF, Greek, Cyrillic, Latin Extended)",
    page: "/powerpoint-to-pdf/",
    vendor: [JSZIP, JSPDF, FONT_REGULAR, FONT_BOLD],
    async run(page, lang, ctl) {
      const served = {};
      page.on("response", async (r) => {
        const path = new URL(r.url()).pathname;
        if (path === FONT_REGULAR || path === FONT_BOLD) served[path] = { status: r.status(), sha: sha256(await r.body()) };
      });
      const ranges = await page.evaluate(() => FONT_RANGES);
      const sameRanges = (got) => expect(rangesLiteral(got) === rangesLiteral(supportedRanges(REPO_ROOT)),
        `the page's FONT_RANGES (${got.length} ranges) isn't what the vendored Liberation Sans cmaps give; run node scripts/font_ranges.js and paste its output into both pages`);
      sameRanges(ranges);
      const bytes = await convertDeck(page, "greek", LGC_DECK);
      for (const f of [FONT_REGULAR, FONT_BOLD])
        expect(served[f]?.status === 200 && served[f].sha === MANIFEST_SHA[f], `${f} was served with ${JSON.stringify(served[f])}, not HTTP 200 and the manifest's sha256`);
      expect(ctl.requests.filter((u) => u.includes("/liberation-sans/")).length === 2, "the two font files weren't fetched exactly once each");
      const pages = jspdfPages(bytes);
      await loadFontBBoxes();
      expectLiberationFonts(pages);
      const lines = await pdfjsLines(page, bytes);
      const wrapped = expectLgcText(lines, lang);
      expect((await warnState(page)).text === null, "a deck the font covers shows the unsupported-characters warning");
      const sameAsMain = (b) => expect(stableSha(b) === MAIN_SHA.lgc[lang], `greek.pdf (stamp and date removed) has sha256 ${stableSha(b)}, not main's ${MAIN_SHA.lgc[lang]}`);
      sameAsMain(bytes);
      const garbled = lines.map((l) => (l === "• Привет, мир" ? "•    @ 8 2 5 B ,   < 8 @ !" : l));
      const negatives = [
        mustFail("a line in the old garbled text", () => expectLgcText(garbled, lang)),
        mustFail("the font program removed", () => expectLiberationFonts(jspdfPages(tamper(bytes, "/FontFile2", "/FontFileX")))),
        mustFail("titles in Regular", () => expectLiberationFonts(pages.map((p) => ({ ...p, fonts: p.fonts.map((f) => ({ ...f, bbox: FONT_BBOX.regular })) })))),
        mustFail("FONT_RANGES missing a range", () => sameRanges(ranges.slice(1))),
        mustFail("a PDF one byte off main's", () => sameAsMain(tamper(bytes, "/FontFile2", "/FontFilf2"))),
      ];
      return `greek.pdf: ${pages.length} pages drawn with embedded Liberation Sans (titles Bold, text Regular, Identity-H), both fonts HTTP 200 with the manifest sha256, PDF.js reads every Greek, Cyrillic, Polish and Vietnamese line back exactly, the long Cyrillic bullet wraps into ${wrapped} lines, identical to main's PDF apart from stamp and date; FONT_RANGES (${ranges.length} ranges) matches the fonts' cmaps; ${bytes.length} bytes; ${negatives.join("; ")}`;
    },
  },
  {
    // Greek with Arabic: the font is fetched for the Greek, and the Arabic gets the warning.
    name: "JSZip + jsPDF + Liberation Sans (PowerPoint to PDF, Greek and Arabic)",
    page: "/powerpoint-to-pdf/",
    vendor: [JSZIP, JSPDF, FONT_REGULAR, FONT_BOLD],
    async run(page, lang) {
      const want = PPTX_WARNING[lang](lang === "es" ? "árabes" : "Arabic");
      await page.setInputFiles("#fileInput", { name: "mixed.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: fixturePptx([["Καλημέρα κόσμε", "مرحبا بالعالم", "Ελληνικά"]]) });
      await page.waitForFunction(() => getComputedStyle(document.getElementById("warnNote")).display !== "none", null, { timeout: 15000 }).catch(() => {});
      expectWarning(await warnState(page), want);
      const bytes = await convertDeck(page, "mixed", [["Καλημέρα κόσμε", "مرحبا بالعالم", "Ελληνικά"]]);
      const lines = await pdfjsLines(page, bytes);
      const greek = (l) => expect(l.includes("Καλημέρα κόσμε") && l.includes("• Ελληνικά"), `PDF.js doesn't read the Greek back: ${JSON.stringify(l)}`);
      greek(lines);
      const after = await warnState(page);
      expectWarning(after, want);
      const negatives = [
        mustFail("the warning without the script name", () => expectWarning({ ...after, text: after.text.replace(lang === "es" ? "árabes" : "Arabic", "") }, want)),
        mustFail("the Greek garbled", () => greek(lines.map((l) => l.replace("Καλημέρα", "š±»·¼-Á±")))),
      ];
      return `mixed.pdf: Greek drawn with Liberation Sans and read back exactly; the warning names ${lang === "es" ? "árabes" : "Arabic"} on selection and after converting; ${negatives.join("; ")}`;
    },
  },
  {
    // The warning on file selection, for each script the converter can't draw yet, and none for decks it can.
    name: "PowerPoint to PDF warnings for unsupported characters",
    page: "/powerpoint-to-pdf/",
    vendor: [JSZIP, JSPDF],
    async run(page, lang, ctl) {
      const es = lang === "es";
      // [label, text runs, script names (null: no warning, "": generic), short: every run has an unsupported character]
      const decks = [
        ["Hebrew", ["שלום עולם"], null],
        ["Arabic", ["مرحبا بالعالم"], es ? "árabes" : "Arabic", true],
        ["Chinese", ["你好，世界"], es ? "chinos" : "Chinese", true],
        ["Japanese", ["こんにちは、世界"], es ? "japoneses" : "Japanese", true],
        ["Korean", ["안녕하세요"], es ? "coreanos" : "Korean", true],
        ["several", ["שלום", "مرحبا", "안녕하세요"], es ? "árabes y coreanos" : "Arabic and Korean", false],
        ["Hebrew and Latin", ["שלום עולם", "Hello world"], null],
        ["Hebrew and Arabic", ["שלום עולם", "مرحبا بالعالم"], es ? "árabes" : "Arabic", false],
        ["symbols", ["Done ✓"], ""],
        ["Latin", ["Café crème, 5 €"], null],
        ["Greek", ["Καλημέρα κόσμε"], null],
      ];
      const noWarning = (state, label) => expect(state.text === null && state.convert, `the ${label} deck shows ${JSON.stringify(state.text)}; it needs no warning`);
      const seen = [];
      for (const [label, texts, names, short] of decks) {
        await page.setInputFiles("#fileInput", { name: `${label}.pptx`, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: fixturePptx([texts]) });
        if (names === null) {
          // No signal for "scan finished, nothing found": give the (tiny) deck's scan time to run.
          await page.waitForTimeout(1000);
          const state = await warnState(page);
          noWarning(state, label);
          seen.push({ label, state });
        } else {
          await page.waitForFunction(() => getComputedStyle(document.getElementById("warnNote")).display !== "none", null, { timeout: 15000 }).catch(() => {});
          const state = await warnState(page);
          expectWarning(state, PPTX_WARNING[lang](names, short));
          seen.push({ label, state, names, short });
        }
      }
      // Choosing a file only reads it: the font is fetched when converting, and only if needed.
      expect(!ctl.requests.some((u) => u.includes("/liberation-sans/")), "choosing a file fetched Liberation Sans");
      const named = seen.find((x) => x.label === "several");
      const arabic = seen.find((x) => x.label === "Arabic"), withHebrew = seen.find((x) => x.label === "Hebrew and Arabic");
      const negatives = [
        mustFail("the full warning on an Arabic-only deck", () => expectWarning({ ...arabic.state, text: PPTX_WARNING[lang](arabic.names, false) }, PPTX_WARNING[lang](arabic.names, true))),
        mustFail("the short warning on a Hebrew + Arabic deck", () => expectWarning({ ...withHebrew.state, text: PPTX_WARNING[lang](withHebrew.names, true) }, PPTX_WARNING[lang](withHebrew.names, false))),
        mustFail("Hebrew named in the warning", () => expectWarning({ ...withHebrew.state, text: PPTX_WARNING[lang](es ? "hebreos y árabes" : "Hebrew and Arabic", false) }, PPTX_WARNING[lang](withHebrew.names, false))),
        mustFail("a warning on the Hebrew deck", () => noWarning({ ...seen.find((x) => x.label === "Hebrew").state, text: PPTX_WARNING[lang](es ? "hebreos" : "Hebrew", true) }, "Hebrew")),
        mustFail("a warning missing a script name", () => expectWarning({ ...named.state, text: named.state.text.replace(es ? "árabes y " : "Arabic and ", "") }, PPTX_WARNING[lang](named.names, false))),
        mustFail("a warning with role=alert", () => expectWarning({ ...named.state, role: "alert" }, PPTX_WARNING[lang](named.names, false))),
        mustFail("a warning on the Greek deck", () => noWarning({ ...seen.find((x) => x.label === "Greek").state, text: PPTX_WARNING[lang]("") }, "Greek")),
      ];
      return `warnings on selection: ${seen.filter((x) => x.names !== undefined).map((x) => (x.names || "(generic)") + (x.short ? " (short)" : x.names ? " (full)" : "")).join(" / ")}; none for the Hebrew, Hebrew + Latin, Latin and Greek decks; Convert stays available; ${negatives.join("; ")}`;
    },
  },
  {
    // The font answers 404: the page must say so in its error line and make no PDF at all.
    name: "PowerPoint to PDF font 404",
    page: "/powerpoint-to-pdf/",
    broken: () => ({ path: FONT_REGULAR, mode: "404" }),
    vendor: [JSZIP, JSPDF],
    async run(page, lang) {
      await convertDeck(page, "greek", LGC_DECK, { expectPdf: false });
      await page.waitForFunction((m) => document.getElementById("errorMsg").textContent === m, PPTX_FONT_ERROR[lang], { timeout: 30000 })
        .catch(() => {});
      const state = await page.evaluate(() => ({
        error: document.getElementById("errorMsg").textContent, role: document.getElementById("errorMsg").getAttribute("role"),
        links: document.querySelectorAll("#result a").length, progress: document.getElementById("progressMsg").textContent,
        convert: !document.getElementById("convertBtn").disabled,
      }));
      const check = (st) => {
        expect(st.error === PPTX_FONT_ERROR[lang], `the error line says ${JSON.stringify(st.error)}, not the font error`);
        expect(st.role === "alert", `the error line has role="${st.role}", not "alert"`);
        expect(st.links === 0, `a download link appeared (${st.links}) although the font didn't load`);
        expect(!st.progress && st.convert, "the page still shows progress, or Convert isn't available again to retry");
      };
      check(state);
      const negatives = [
        mustFail("a PDF made without the font", () => check({ ...state, links: 1 })),
        mustFail("no error shown", () => check({ ...state, error: "" })),
      ];
      return `font 404: error line says "${state.error}" (role="alert"), no PDF offered, Convert available again; ${negatives.join("; ")}`;
    },
  },
  {
    // Hebrew, right to left: drawn in visual order (checked through the font's ToUnicode map, read left
    // to right as drawn), brackets the right way round, numbers intact, wrapped lines in reading
    // order, right-aligned like the left edge mirrored, a sentence split into runs kept whole.
    name: "JSZip + jsPDF + Liberation Sans (PowerPoint to PDF, Hebrew right to left)",
    page: "/powerpoint-to-pdf/",
    vendor: [JSZIP, JSPDF, FONT_REGULAR, FONT_BOLD],
    async run(page, lang, ctl) {
      await page.setInputFiles("#fileInput", { name: "hebrew.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: fixturePptx(HEBREW_DECK) });
      await page.waitForTimeout(1000);
      expect((await warnState(page)).text === null, "a Hebrew deck shows the unsupported-characters warning");
      const bytes = await convertDeck(page, "hebrew", HEBREW_DECK);
      expect(ctl.requests.filter((u) => u.includes("/liberation-sans/")).length === 2, "the two font files weren't fetched");
      expect((await warnState(page)).text === null, "the warning appeared after converting a Hebrew deck");
      const pages = jspdfPages(bytes);
      expectHebrewDrawing(pages);
      const lines = await pdfjsLines(page, bytes);
      const read = (l) => HEBREW_READ_BACK.forEach((want) => expect(l.includes(want), `PDF.js doesn't read "${want}" back: ${JSON.stringify(l)}`));
      read(lines);
      // Breaking copies of the real result, one way each, must fail the same checks.
      const edit = (fn) => pages.map((p) => ({ ...p, runs: p.runs.map((r) => fn({ ...r })) }));
      const reverse = (t) => [...t].reverse().join("");
      const negatives = [
        mustFail("Hebrew drawn in logical order", () => expectHebrewDrawing(edit((r) => (r.text.includes("םולש") ? { ...r, text: reverse(r.text) } : r)))),
        mustFail("mirrored brackets", () => expectHebrewDrawing(edit((r) => ({ ...r, text: r.text.replace("(", "\0").replace(")", "(").replace("\0", ")") })))),
        mustFail("a broken number", () => expectHebrewDrawing(edit((r) => ({ ...r, text: r.text.replace("1,250.50", "05.052,1") })))),
        mustFail("the wrapped lines swapped", () => expectHebrewDrawing(pages.map((p) => {
          const i = p.runs.findIndex((r) => reverse(r.text).startsWith("•  " + LONG_HE.slice(0, 12)));
          if (i < 0) return p;
          const runs = p.runs.map((r) => ({ ...r }));
          [runs[i].y, runs[i + 1].y] = [runs[i + 1].y, runs[i].y];
          return { ...p, runs };
        }))),
        mustFail("Hebrew left-aligned", () => expectHebrewDrawing(edit((r) => (/[א-ת]/.test(r.text) ? { ...r, x: 64 } : r)))),
        mustFail("the split sentence in three bullets", () => expectHebrewDrawing(edit((r) => (reverse(r.text) === "•  " + SPLIT_HE.join("") ? { ...r, text: reverse("•  " + SPLIT_HE[1]) } : r)))),
        mustFail("a line read back in the wrong order", () => read(lines.map((l) => (l === "• שלום עולם" ? "• םלוע םולש" : l)))),
      ];
      return `hebrew.pdf: no warning, both fonts fetched; pure Hebrew drawn in visual order, ( before ), "100" and "1,250.50" intact, the long bullet wrapped into lines in reading order, right edges at 562/548 pt, the split sentence one bullet, the rtl="1" paragraph right-aligned; PDF.js reads ${HEBREW_READ_BACK.length} lines back exactly; ${negatives.join("; ")}`;
    },
  },
  {
    // A left-to-right slide with one Hebrew word: the word reads right to left in place, the line stays left-aligned.
    name: "JSZip + jsPDF + Liberation Sans (PowerPoint to PDF, Hebrew word in a left-to-right line)",
    page: "/powerpoint-to-pdf/",
    vendor: [JSZIP, JSPDF, FONT_REGULAR, FONT_BOLD],
    async run(page) {
      const deck = [["Product overview", "Our product is called שלום in Hebrew, version 2.0", "Plain English bullet"]];
      const bytes = await convertDeck(page, "ltr", deck);
      const check = (pages) => {
        const run = pages[0].runs.find((r) => r.text.includes("Our product"));
        expect(run && run.text === "•  Our product is called םולש in Hebrew, version 2.0", `the line is drawn as ${JSON.stringify(run?.text)}, not with the Hebrew word in visual order inside a left-to-right line`);
        expect(Math.abs(run.x - 64) <= 1, `the line starts at ${run.x.toFixed(1)} pt, not left-aligned at 64 pt`);
      };
      const pages = jspdfPages(bytes);
      check(pages);
      const lines = await pdfjsLines(page, bytes);
      expect(lines.includes("• Our product is called שלום in Hebrew, version 2.0"), `PDF.js reads ${JSON.stringify(lines)}`);
      const edit = (fn) => pages.map((p) => ({ ...p, runs: p.runs.map((r) => (r.text.includes("Our product") ? fn({ ...r }) : r)) }));
      const negatives = [
        mustFail("the Hebrew word in logical order", () => check(edit((r) => ({ ...r, text: r.text.replace("םולש", "שלום") })))),
        mustFail("the line right-aligned", () => check(edit((r) => ({ ...r, x: 548 - r.width })))),
      ];
      return `ltr.pdf: "Our product is called שלום in Hebrew, version 2.0" drawn left-aligned at 64 pt with the Hebrew word in visual order, PDF.js reads it back exactly; ${negatives.join("; ")}`;
    },
  },
  {
    // Decks without Hebrew must come out exactly as before Hebrew support, also when their paragraphs
    // are split into several runs (those stay one bullet per run, as always).
    name: "JSZip + jsPDF (PowerPoint to PDF, decks without Hebrew unchanged)",
    page: "/powerpoint-to-pdf/",
    vendor: [JSZIP, JSPDF],
    async run(page, lang) {
      const latin = await convertDeck(page, "latin-split", LATIN_SPLIT_DECK);
      const lgc = await convertDeck(page, "lgc-split", LGC_SPLIT_DECK);
      const lgcFull = await convertDeck(page, "greek", LGC_DECK);
      const same = (b, key) => expect(stableSha(b) === MAIN_SHA[key][lang], `${key} (stamp and date removed) has sha256 ${stableSha(b)}, not main's ${MAIN_SHA[key][lang]}`);
      same(latin, "latinSplit");
      same(lgc, "lgcSplit");
      same(lgcFull, "lgc");
      const negatives = [
        mustFail("a Latin PDF one byte off main's", () => same(tamper(latin, "Quarterly", "Quarterlz"), "latinSplit")),
        mustFail("a Greek/Cyrillic PDF one byte off main's", () => same(tamper(lgc, "/FontFile2", "/FontFilf2"), "lgcSplit")),
      ];
      return `Latin and Greek/Cyrillic decks with runs split inside paragraphs, and the Greek/Cyrillic deck: all identical to main's PDFs apart from stamp and date; ${negatives.join("; ")}`;
    },
  },
  {
    // A slide written the way PowerPoint writes it (placeholders, run properties with languages,
    // a run split for spelling, a line break, a slide-number field, an empty paragraph, rtl="1"
    // with algn="r"): Hebrew paragraphs become whole lines; the English one stays one bullet per run.
    name: "JSZip + jsPDF + Liberation Sans (PowerPoint to PDF, real PowerPoint slide structure)",
    page: "/powerpoint-to-pdf/",
    vendor: [JSZIP, JSPDF, FONT_REGULAR, FONT_BOLD],
    async run(page, lang) {
      const bytes = await convertDeck(page, "real", [{ xml: REAL_SLIDE_XML }]);
      const want = ["דוח רבעוני", "• גרסה Orisod 2.0 זמינה בכל הדפדפנים", "• שקופית 1", "• Make sure to", "• always", "• check"];
      const check = (lines) => {
        want.forEach((w) => expect(lines.includes(w), `PDF.js doesn't read "${w}" back: ${JSON.stringify(lines)}`));
        expect(!lines.includes("• רבעוני") && !lines.includes("• Orisod"), `a Hebrew paragraph was split into runs: ${JSON.stringify(lines)}`);
      };
      const lines = await pdfjsLines(page, bytes);
      check(lines);
      const pages = jspdfPages(bytes);
      const title = pages[0].runs.find((r) => r.size === 18);
      expect(title && Math.abs(title.x + title.width - 562) <= 1, `the right-to-left title ends at ${title && (title.x + title.width).toFixed(1)} pt, not 562 pt`);
      const negatives = [
        mustFail("the title split into its two runs", () => check([...lines.filter((l) => l !== "דוח רבעוני"), "דוח", "• רבעוני"])),
        mustFail("the line break lost", () => check(lines.map((l) => l.replace("זמינה בכל", "זמינהבכל")))),
      ];
      return `real.pdf: title "דוח רבעוני" (2 runs) whole and right-aligned, "גרסה Orisod 2.0 זמינה בכל הדפדפנים" (4 runs and a line break) one bullet, "שקופית 1" with its slide-number field, the English paragraph one bullet per run as always, the empty paragraph skipped; ${negatives.join("; ")}`;
    },
  },
  {
    name: "html2canvas + jsPDF (HTML to PDF)",
    page: "/html-to-pdf/",
    vendor: ["/assets/vendor/html2canvas/1.4.1/html2canvas.min.js", JSPDF],
    async run(page, lang) {
      await page.fill("#htmlInput", '<div id="smoke" style="width:300px;height:200px;background:#000"></div><p>Smoke test</p>');
      await page.waitForFunction(() => !!document.getElementById("previewFrame").contentDocument.getElementById("smoke"), null, { timeout: 10000 });
      await page.click("#convertBtn");
      const name = lang === "es" ? "html-a-pdf.pdf" : "html-to-pdf.pdf";
      const link = page.locator(`#result a[download="${name}"]`);
      await link.waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      expect(bytes.subarray(0, 5).toString() === "%PDF-", "the download isn't a PDF");
      const pages = pdfPageCount(bytes);
      expect(pages === 1, `${name} has ${pages} pages, not 1`);
      const jpegs = pdfJpegs(bytes);
      expect(jpegs.length === 1, `${name} has ${jpegs.length} images, not 1`);
      const size = jpegSize(jpegs[0]);
      const { dark, total } = await darkPixels(page, jpegs[0]);
      // The black 300x200 block, drawn at html2canvas's scale 2, is 240,000 pixels.
      expect(dark > 200000 && dark < total / 2, `the rendered page has ${dark} dark pixels of ${total}; the black block isn't there`);
      return `${name}: 1 page, html2canvas drew a ${size.w}x${size.h} image with the black block (${dark} dark pixels)`;
    },
  },
  {
    name: "PDF.js + JSZip (PDF to JPG)",
    page: "/pdf-to-jpg/",
    vendor: [PDFJS, PDFJS_WORKER, JSZIP],
    worker: PDFJS_WORKER,
    async run(page) {
      const pdf = fixturePdf("Fixture", ["page 1", "page 2", "page 3"]);
      await page.setInputFiles("#fileInput", { name: "three.pdf", mimeType: "application/pdf", buffer: pdf });
      await page.locator("#convertBtn:not([disabled])").waitFor({ timeout: 30000 });
      await page.click("#convertBtn");
      await page.locator("#downloadAllWrap").waitFor({ state: "visible", timeout: 60000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("#downloadAllBtn")]);
      expect(download.suggestedFilename() === "three.zip", `the ZIP is called ${download.suggestedFilename()}`);
      const files = zipEntries(await readFile(await download.path()));
      expect(files.length === 3, `the ZIP has ${files.length} files, not 3`);
      for (const f of files) {
        const size = jpegSize(f.data);
        expect(/\.jpg$/.test(f.name) && size && size.w === 1224 && size.h === 1584, `${f.name} isn't a 1224x1584 JPEG`);
        const { dark } = await darkPixels(page, f.data);
        expect(dark > 50, `${f.name} is blank (${dark} dark pixels)`);
      }
      return `three.zip: ${files.map((f) => f.name).join(", ")}, each a 1224x1584 JPEG with its page's text`;
    },
  },
  {
    name: "pdf-lib + JSZip (Split PDF)",
    page: "/split-pdf/",
    vendor: ["/assets/vendor/pdf-lib/1.17.1/pdf-lib.min.js", JSZIP],
    async run(page) {
      const pdf = fixturePdf("Fixture", ["page 1", "page 2", "page 3"]);
      await page.setInputFiles("#fileInput", { name: "three.pdf", mimeType: "application/pdf", buffer: pdf });
      await page.locator("#splitAllBtn").waitFor({ state: "visible", timeout: 30000 });
      await page.click("#splitAllBtn");
      const link = page.locator('#result a[download="three-split.zip"]');
      await link.waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const files = zipEntries(await readFile(await download.path()));
      const got = files.map((f) => `${f.name}: ${pdfPageCount(f.data)} page, ${pdfText(f.data).trim()}`);
      const want = [1, 2, 3].map((n) => `three-page-${n}.pdf: 1 page, Fixture page ${n}`);
      expect(got.join("|") === want.join("|"), `three-split.zip holds ${JSON.stringify(got)}`);
      return `three-split.zip: three-page-1.pdf to three-page-3.pdf, one page each, with the right text`;
    },
  },
  {
    name: "SheetJS + jspdf-autotable + jsPDF (Excel to PDF)",
    page: "/excel-to-pdf/",
    vendor: [XLSX, JSPDF, AUTOTABLE],
    async run(page) {
      const rows = [["Name", "Qty"], ["Apple", 3], ["Pear", 5], ["Smokeberry", 7]];
      await page.setInputFiles("#fileInput", { name: "fruit.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fixtureXlsx(rows) });
      await page.locator("#convertBtn").waitFor({ state: "visible", timeout: 30000 });
      await page.click("#convertBtn");
      const link = page.locator('#result a[download="fruit.pdf"]');
      await link.waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      expect(bytes.subarray(0, 5).toString() === "%PDF-", "the download isn't a PDF");
      // autotable draws each cell as its own text, so the rows read in order, cell by cell.
      const text = pdfText(bytes).split("\n").map((s) => s.trim()).filter(Boolean).join(" ");
      const want = rows.flat().join(" ");
      expect(text.includes(want), `fruit.pdf text is "${text}", without "${want}"`);
      return `fruit.pdf: ${pdfPageCount(bytes)} page, table text "${want}"`;
    },
  },
  {
    // A table too long for one page: autotable must carry it over several pages, repeat
    // the header row on each, and keep every row (the last one included) in order.
    name: "SheetJS + jspdf-autotable + jsPDF (Excel to PDF, multi-page table)",
    page: "/excel-to-pdf/",
    vendor: [XLSX, JSPDF, AUTOTABLE],
    async run(page, lang) {
      const head = ["Row", "Item", "Region", "Qty", "Note"];
      const rows = Array.from({ length: 120 }, (_, i) => [`Row ${i + 1}`, `Item ${i + 1}`, ["North", "South", "East", "West"][i % 4], (i + 1) * 3, i === 119 ? "Last row" : "ok"]);
      await page.setInputFiles("#fileInput", { name: "long.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fixtureXlsx([head, ...rows]) });
      await page.locator("#convertBtn").waitFor({ state: "visible", timeout: 30000 });
      await page.click("#convertBtn");
      const link = page.locator('#result a[download="long.pdf"]');
      await link.waitFor({ timeout: 30000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      const title = `${lang === "es" ? "Hoja" : "Sheet"}: Fruit`;
      const check = (pages) => {
        expect(pages.length >= 3, `the table fills ${pages.length} pages, not several`);
        expect(pages.every((p) => p.w === 792 && p.h === 612), "the pages aren't landscape Letter");
        expect(pages[0].blocks.flat().includes(title), `page 1 has no "${title}" heading`);
        pages.forEach((p, i) => {
          const cells = p.blocks.flat();
          expect(head.every((h) => cells.includes(h)), `page ${i + 1} doesn't repeat the header row`);
        });
        const ids = pages.flatMap((p) => p.blocks.flat().filter((s) => /^Row \d+$/.test(s)));
        expect(ids.join("|") === rows.map((r) => r[0]).join("|"), `the table's rows read ${ids.length ? `${ids[0]} ... ${ids.at(-1)} (${ids.length})` : "nothing"}, not Row 1 to Row 120 in order`);
        const last = pages.at(-1).blocks.flat();
        expect(last.includes("Row 120") && last.includes("Last row") && last.includes("360"), "the last page doesn't hold the last row");
      };
      const pages = jspdfPages(bytes);
      check(pages);
      expect(pages.length === pdfPageCount(bytes), "the page tree and the pages read disagree");
      const negatives = [
        mustFail("the last page cut off", () => check(pages.slice(0, -1))),
        mustFail("a page without the header row", () => check(pages.map((p, i) => (i === 1 ? { ...p, blocks: p.blocks.filter((b) => !b.includes("Region")) } : p)))),
      ];
      return `long.pdf: 120 rows over ${pages.length} landscape pages, header repeated on each, Row 1 to Row 120 in order, "Last row" on the last page; ${negatives.join("; ")}`;
    },
  },
  {
    // Greek, Cyrillic and Latin Extended cells and sheet name: Liberation Sans is fetched and every
    // text is drawn with it (header row in Bold), read back exactly through the font's ToUnicode map.
    name: "SheetJS + jspdf-autotable + jsPDF + Liberation Sans (Excel to PDF, Greek, Cyrillic, Latin Extended)",
    page: "/excel-to-pdf/",
    vendor: [XLSX, JSPDF, AUTOTABLE, FONT_REGULAR, FONT_BOLD],
    async run(page, lang, ctl) {
      const served = {};
      page.on("response", async (r) => {
        const path = new URL(r.url()).pathname;
        if (path === FONT_REGULAR || path === FONT_BOLD) served[path] = { status: r.status(), sha: sha256(await r.body()) };
      });
      const pagesText = await Promise.all(SHARED_FONT_PAGES.map((f) => readFile(`${REPO_ROOT}/${f}`, "utf-8")));
      expectSameSharedBlock(pagesText);
      const bytes = await convertWorkbook(page, "scripts", XLSX_LGC_ROWS, "Ελληνικά");
      for (const f of [FONT_REGULAR, FONT_BOLD])
        expect(served[f]?.status === 200 && served[f].sha === MANIFEST_SHA[f], `${f} was served with ${JSON.stringify(served[f])}, not HTTP 200 and the manifest's sha256`);
      expect(ctl.requests.filter((u) => u.includes("/liberation-sans/")).length === 2, "the two font files weren't fetched exactly once each");
      expect((await warnState(page)).text === null, "a workbook the font covers shows the unsupported-characters warning");
      await loadFontBBoxes();
      const heading = `${lang === "es" ? "Hoja" : "Sheet"}: Ελληνικά`;
      const check = (pages) => {
        const runs = pages.flatMap((p) => p.runs);
        const find = (t) => runs.find((r) => r.text === t);
        expect(find(heading), `no "${heading}" heading drawn with Liberation Sans: ${JSON.stringify(runs.map((r) => r.text))}`);
        for (const [i, row] of XLSX_LGC_ROWS.entries()) for (const cell of row) {
          const run = find(cell);
          expect(run, `the cell "${cell}" isn't drawn exactly (read through ToUnicode): ${JSON.stringify(runs.map((r) => r.text))}`);
          const want = i === 0 ? "bold" : "regular";
          expect(run.bbox.join() === FONT_BBOX[want].join(), `"${cell}" is drawn with the font box [${run.bbox}], not Liberation Sans ${want === "bold" ? "Bold" : "Regular"}`);
        }
        expect(pages.every((p) => p.fonts.every((f) => f && f.encoding === "Identity-H" && f.fontFile2)), "a text block doesn't use the embedded Identity-H Liberation Sans");
      };
      const pages = jspdfPages(bytes);
      check(pages);
      const edit = (fn) => pages.map((p) => ({ ...p, runs: p.runs.map((r) => fn({ ...r })) }));
      const negatives = [
        mustFail("a cell in the old garbled text", () => check(edit((r) => (r.text === "Привет, мир" ? { ...r, text: "@825B, <8@!" } : r)))),
        mustFail("the font program removed", () => check(jspdfPages(tamper(bytes, "/FontFile2", "/FontFileX")))),
        mustFail("the header row in Regular", () => check(edit((r) => (r.text === "Γλώσσα" ? { ...r, bbox: FONT_BBOX.regular } : r)))),
        mustFail("a shared font loader block that differs", () => expectSameSharedBlock([...pagesText.slice(0, 3), pagesText[3].replace("const FONT_TIMEOUT_MS = 60000;", "const FONT_TIMEOUT_MS = 30000;")])),
      ];
      return `scripts.pdf: heading and all 9 cells drawn with embedded Liberation Sans and read back exactly through ToUnicode, header row Bold, both fonts HTTP 200 with the manifest sha256, no warning; the shared font loader block is identical on the four pages; ${negatives.join("; ")}`;
    },
  },
  {
    // A Windows-1252 workbook: no font fetched, and the PDF is exactly what main produced.
    name: "SheetJS + jspdf-autotable + jsPDF (Excel to PDF, Windows-1252 workbook unchanged)",
    page: "/excel-to-pdf/",
    vendor: [XLSX, JSPDF, AUTOTABLE],
    async run(page, lang, ctl) {
      const bytes = await convertWorkbook(page, "latin", XLSX_LATIN_ROWS, "Ventas");
      const noFont = (requests) => expect(!requests.some((u) => u.includes("/liberation-sans/")), "the page fetched Liberation Sans for a Windows-1252 workbook");
      const same = (b) => expect(stableSha(b) === XLSX_LATIN_SHA[lang], `latin.pdf (stamp and date removed) has sha256 ${stableSha(b)}, not main's ${XLSX_LATIN_SHA[lang]}`);
      noFont(ctl.requests);
      same(bytes);
      expect((await warnState(page)).text === null, "a Windows-1252 workbook shows the unsupported-characters warning");
      const negatives = [
        mustFail("a font request", () => noFont([...ctl.requests, SITE + FONT_REGULAR])),
        mustFail("a PDF one byte off main's", () => same(tamper(bytes, "Ventas", "Ventaz"))),
      ];
      return `latin.pdf: no font fetched, no warning, identical to main's PDF apart from stamp and date; ${negatives.join("; ")}`;
    },
  },
  {
    // Hebrew isn't laid out right to left in this tool: it's named in the warning and never drawn as Hebrew letters
    // (with the built-in font it's unreadable as before; with Liberation Sans each letter becomes a white square).
    name: "SheetJS + jspdf-autotable + jsPDF (Excel to PDF, Hebrew cells)",
    page: "/excel-to-pdf/",
    vendor: [XLSX, JSPDF, AUTOTABLE],
    async run(page, lang) {
      const es = lang === "es";
      const hebrewDrawn = (pages) => pages.flatMap((p) => p.runs.map((r) => r.text)).filter((t) => /[א-ת]/.test(t));
      const noHebrew = (pages) => expect(!hebrewDrawn(pages).length, `Hebrew letters were drawn: ${JSON.stringify(hebrewDrawn(pages))}`);
      // Hebrew only: no font (nothing else needs it), the warning names Hebrew, no Hebrew glyphs.
      await page.setInputFiles("#fileInput", { name: "hebrew.xlsx", mimeType: XLSX_MIME, buffer: fixtureXlsx([["שם", "עיר"], ["שלום עולם", "תל אביב"]]) });
      await page.waitForFunction(() => getComputedStyle(document.getElementById("warnNote")).display !== "none", null, { timeout: 15000 }).catch(() => {});
      const only = await warnState(page);
      expectWarning(only, XLSX_WARNING[lang](es ? "hebreos" : "Hebrew"));
      const onlyPdf = jspdfPages(await convertWorkbook(page, "hebrew", [["שם", "עיר"], ["שלום עולם", "תל אביב"]]));
      noHebrew(onlyPdf);
      // Hebrew next to Greek: Liberation Sans is loaded for the Greek, and the Hebrew is drawn as squares.
      const rows = [["Ελληνικά", "עברית"], ["Καλημέρα", "שלום"]];
      await page.setInputFiles("#fileInput", { name: "mixed.xlsx", mimeType: XLSX_MIME, buffer: fixtureXlsx(rows) });
      await page.waitForFunction(() => getComputedStyle(document.getElementById("warnNote")).display !== "none", null, { timeout: 15000 }).catch(() => {});
      expectWarning(await warnState(page), XLSX_WARNING[lang](es ? "hebreos" : "Hebrew"));
      const mixed = jspdfPages(await convertWorkbook(page, "mixed", rows));
      noHebrew(mixed);
      const squares = mixed.flatMap((p) => p.runs.map((r) => r.text)).filter((t) => t.includes(XLSX_SQUARE));
      expect(squares.includes(XLSX_SQUARE.repeat(4)) && squares.includes(XLSX_SQUARE.repeat(5)), `the Hebrew cells aren't drawn as white squares: ${JSON.stringify(squares)}`);
      expect(mixed.flatMap((p) => p.runs.map((r) => r.text)).includes("Καλημέρα"), "the Greek cell isn't drawn");
      const negatives = [
        mustFail("Hebrew drawn reversed", () => noHebrew([{ runs: [{ text: "םולש" }] }])),
        mustFail("a warning without Hebrew", () => expectWarning({ ...only, text: null }, XLSX_WARNING[lang](es ? "hebreos" : "Hebrew"))),
      ];
      return `Hebrew-only workbook: warning names ${es ? "hebreos" : "Hebrew"}, no font, no Hebrew glyph drawn; Hebrew + Greek: font loaded, Greek drawn, Hebrew cells drawn as white squares, warning names ${es ? "hebreos" : "Hebrew"}; ${negatives.join("; ")}`;
    },
  },
  {
    // Scripts Liberation Sans doesn't cover: the warning names them, short when no text converts normally.
    name: "SheetJS + jspdf-autotable + jsPDF (Excel to PDF, warnings for unsupported characters)",
    page: "/excel-to-pdf/",
    vendor: [XLSX, JSPDF, AUTOTABLE],
    async run(page, lang, ctl) {
      const es = lang === "es";
      const books = [
        ["Arabic and Korean", [["Name", "Note"], ["مرحبا", "안녕하세요"]], "Fruit", es ? "árabes y coreanos" : "Arabic and Korean", false],
        ["only Arabic", [["مرحبا"], ["بالعالم"]], "عربي", es ? "árabes" : "Arabic", true],
        ["Japanese", [["Name"], ["こんにちは世界"]], "Fruit", es ? "japoneses" : "Japanese", false],
        ["symbols", [["Status"], ["Done ✓"]], "Fruit", "", false],
        ["Greek", [["Name"], ["Καλημέρα"]], "Fruit", null],
      ];
      const seen = [];
      for (const [label, rows, sheet, names, short] of books) {
        await page.setInputFiles("#fileInput", { name: "book.xlsx", mimeType: XLSX_MIME, buffer: fixtureXlsx(rows, sheet) });
        if (names === null) {
          await page.waitForTimeout(1000);
          const state = await warnState(page);
          expect(state.text === null && state.convert, `the ${label} workbook shows ${JSON.stringify(state.text)}; it needs no warning`);
          continue;
        }
        await page.waitForFunction(() => getComputedStyle(document.getElementById("warnNote")).display !== "none", null, { timeout: 15000 }).catch(() => {});
        const state = await warnState(page);
        expectWarning(state, XLSX_WARNING[lang](names, short));
        seen.push({ label, state, names, short });
      }
      expect(!ctl.requests.some((u) => u.includes("/liberation-sans/")), "choosing a file fetched Liberation Sans");
      const both = seen[0], arabic = seen[1];
      const negatives = [
        mustFail("the short form when a text converts", () => expectWarning({ ...both.state, text: XLSX_WARNING[lang](both.names, true) }, XLSX_WARNING[lang](both.names, false))),
        mustFail("the full form when nothing converts", () => expectWarning({ ...arabic.state, text: XLSX_WARNING[lang](arabic.names, false) }, XLSX_WARNING[lang](arabic.names, true))),
        mustFail("a warning with role=alert", () => expectWarning({ ...both.state, role: "alert" }, XLSX_WARNING[lang](both.names, false))),
      ];
      return `warnings on selection: ${seen.map((x) => (x.names || "(generic)") + (x.short ? " (short)" : x.names ? " (full)" : "")).join(" / ")}; none for Greek; Convert stays available; ${negatives.join("; ")}`;
    },
  },
  {
    // The font answers 404: the spreadsheet font error in the alert line, and no PDF.
    name: "Excel to PDF font 404",
    page: "/excel-to-pdf/",
    broken: () => ({ path: FONT_REGULAR, mode: "404" }),
    vendor: [XLSX, JSPDF, AUTOTABLE],
    async run(page, lang) {
      await convertWorkbook(page, "scripts", XLSX_LGC_ROWS, "Ελληνικά", { expectPdf: false });
      await page.waitForFunction((m) => document.getElementById("errorMsg").textContent === m, XLSX_FONT_ERROR[lang], { timeout: 30000 }).catch(() => {});
      const state = await page.evaluate(() => ({
        error: document.getElementById("errorMsg").textContent, role: document.getElementById("errorMsg").getAttribute("role"),
        links: document.querySelectorAll("#result a").length, progress: document.getElementById("progressMsg").textContent,
        convert: !document.getElementById("convertBtn").disabled,
      }));
      const check = (st) => {
        expect(st.error === XLSX_FONT_ERROR[lang], `the error line says ${JSON.stringify(st.error)}, not the font error`);
        expect(st.role === "alert", `the error line has role="${st.role}", not "alert"`);
        expect(st.links === 0, `a download link appeared (${st.links}) although the font didn't load`);
        expect(!st.progress && st.convert, "the page still shows progress, or Convert isn't available again to retry");
      };
      check(state);
      const negatives = [
        mustFail("a PDF made without the font", () => check({ ...state, links: 1 })),
        mustFail("the presentation wording", () => check({ ...state, error: PPTX_FONT_ERROR[lang] })),
      ];
      return `font 404: error line says "${state.error}" (role="alert"), no PDF offered, Convert available again; ${negatives.join("; ")}`;
    },
  },
  {
    name: "mammoth + html2canvas + jsPDF (Word to PDF)",
    page: "/word-to-pdf/",
    vendor: ["/assets/vendor/mammoth/1.12.1/mammoth.browser.min.js", "/assets/vendor/html2canvas/1.4.1/html2canvas.min.js", JSPDF],
    async run(page) {
      const docx = fixtureDocx(["Smoke heading for Word to PDF", "Fixture paragraph one", "Fixture paragraph two"]);
      await page.setInputFiles("#fileInput", { name: "smoke.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx });
      await page.locator("#convertBtn").waitFor({ state: "visible", timeout: 30000 });
      await page.click("#convertBtn");
      const link = page.locator('#result a[download="smoke.pdf"]');
      await link.waitFor({ timeout: 60000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      expect(bytes.subarray(0, 5).toString() === "%PDF-", "the download isn't a PDF");
      const html = await page.$eval("#renderTarget .docx-content", (el) => el.innerHTML);
      expect(html.includes("<p>Fixture paragraph two</p>"), `mammoth's HTML was: ${html.slice(0, 200)}`);
      const pages = pdfPageCount(bytes);
      expect(pages === 1, `smoke.pdf has ${pages} pages, not 1`);
      const jpegs = pdfJpegs(bytes);
      expect(jpegs.length === 1, `smoke.pdf has ${jpegs.length} images, not 1`);
      const size = jpegSize(jpegs[0]);
      const { dark } = await darkPixels(page, jpegs[0]);
      expect(dark > 1000, `the rendered page has only ${dark} dark pixels; mammoth's text isn't on it`);
      return `smoke.pdf: 1 page; mammoth turned the 3 paragraphs into <p>s, drawn as a ${size.w}x${size.h} page image (${dark} dark pixels)`;
    },
  },
  {
    name: "PDF.js + docx (PDF to Word)",
    page: "/pdf-to-word/",
    vendor: [PDFJS, PDFJS_WORKER, "/assets/vendor/docx/9.7.1/index.iife.js"],
    worker: PDFJS_WORKER,
    async run(page) {
      const pdf = fixturePdf("Fixture", ["alpha", "bravo"]);
      await page.setInputFiles("#fileInput", { name: "words.pdf", mimeType: "application/pdf", buffer: pdf });
      await page.locator("#convertBtn").waitFor({ state: "visible", timeout: 30000 });
      await page.click("#convertBtn");
      const link = page.locator('#result a[download="words.docx"]');
      await link.waitFor({ timeout: 60000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const files = zipEntries(await readFile(await download.path()));
      const names = files.map((f) => f.name);
      for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"])
        expect(names.includes(part), `words.docx has no ${part} (files: ${names.join(", ")})`);
      const xml = files.find((f) => f.name === "word/document.xml").data.toString("utf-8");
      const found = ["Fixture alpha", "Fixture bravo"].map((s) => xml.indexOf(s));
      expect(found[0] >= 0 && found[1] > found[0], `word/document.xml doesn't have "Fixture alpha" then "Fixture bravo"`);
      return `words.docx: a valid Word file (${files.length} parts) whose document.xml has "Fixture alpha" and "Fixture bravo" in order`;
    },
  },
  {
    name: "heic2any (HEIC to JPG)",
    page: "/heic-to-jpg/",
    vendor: ["/assets/vendor/heic2any/0.0.4/heic2any.min.js"],
    // heic2any starts its decoder as a Web Worker from a blob: URL holding code inside
    // heic2any.min.js (libheif and libde265 included), so it fetches no file of its own.
    blobWorker: true,
    async run(page) {
      await page.setInputFiles("#fileInput", { name: "smoke.heic", mimeType: "image/heic", buffer: HEIC_FIXTURE });
      await page.locator("#convertBtn:not([disabled])").waitFor({ timeout: 30000 });
      await page.click("#convertBtn");
      const link = page.locator('#results a[download="smoke.jpg"]');
      await link.waitFor({ timeout: 60000 });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), link.click()]);
      const bytes = await readFile(await download.path());
      const size = jpegSize(bytes);
      expect(size, "smoke.jpg isn't a JPEG");
      expect(size.w === 64 && size.h === 48, `smoke.jpg is ${size.w}x${size.h}, not 64x48`);
      // libheif's decoded picture: the left half must come out black and the right half white.
      const halves = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = "data:image/jpeg;base64," + b64;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const mean = (x, w) => { const d = ctx.getImageData(x, 0, w, c.height).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2]; return t / (d.length / 4) / 3; };
        return [mean(0, 28), mean(36, 28)];
      }, bytes.toString("base64"));
      expect(halves[0] < 40 && halves[1] > 215, `smoke.jpg halves average ${halves.map(Math.round).join(" and ")}, not black and white`);
      return `smoke.jpg: a 64x48 JPEG, left half black and right half white (averages ${halves.map(Math.round).join(" / ")}), decoded by heic2any's libheif`;
    },
  },
  {
    name: "Tesseract (OCR PDF)",
    page: "/ocr-pdf/",
    // Its worker, one of the three LSTM core builds (the browser's pick) and the page's language data.
    vendor: TESSERACT_VENDOR,
    vendorOneOf: TESSERACT_CORES,
    // Tesseract starts its worker from a blob: URL that importScripts() the vendored worker.min.js.
    blobWorker: true,
    async run(page, lang) {
      await ocrUpload(page, lang);
      return ocrRun(page, lang);
    },
  },
  {
    // The language data answers 404: the page must show its engine error, not stay on the loading text,
    // and pressing Run OCR again once the file is back must work.
    name: "OCR PDF language data 404",
    page: "/ocr-pdf/",
    broken: (lang) => ({ path: TESSERACT_VENDOR(lang)[2], mode: "404" }),
    vendor: TESSERACT_VENDOR,
    vendorOneOf: TESSERACT_CORES,
    blobWorker: true,
    async run(page, lang, ctl) {
      await ocrUpload(page, lang);
      await page.click("#ocrBtn");
      await ocrExpectEngineError(page, lang, 60000);
      ctl.repair();
      const done = await ocrRun(page, lang);
      expect(!(await page.textContent("#errorMsg")), "the engine error is still shown after a successful retry");
      return `engine error shown and announced (role="alert") after a 404 on the language data; retry: ${done}`;
    },
  },
  {
    // The language data never arrives: the engine error must appear once the page's timeout has passed
    // (not before), and a retry must work. The stalled request is answered late, after the timeout.
    name: "OCR PDF language data stalls",
    page: "/ocr-pdf/",
    broken: (lang) => ({ path: TESSERACT_VENDOR(lang)[2], mode: "stall" }),
    vendor: TESSERACT_VENDOR,
    vendorOneOf: TESSERACT_CORES,
    blobWorker: true,
    async run(page, lang, ctl) {
      await ocrUpload(page, lang);
      const timeout = await page.evaluate(() => ENGINE_TIMEOUT_MS);
      await page.click("#ocrBtn");
      await ctl.held;
      await page.clock.fastForward(timeout - 5000);
      await page.waitForTimeout(1000);
      const early = await page.evaluate(() => [document.getElementById("progressMsg").textContent, document.getElementById("errorMsg").textContent]);
      expect(early[0] === OCR_LOADING[lang] && !early[1], `5 seconds before the timeout the page says "${early[0]}" / "${early[1]}", not still loading`);
      await page.clock.fastForward(10000);
      await ocrExpectEngineError(page, lang, 10000);
      ctl.repair();
      const done = await ocrRun(page, lang);
      expect(!(await page.textContent("#errorMsg")), "the engine error is still shown after a successful retry");
      return `still loading 5 s before the ${timeout / 1000} s timeout, engine error shown after it; retry: ${done}`;
    },
  },
  {
    name: "libphonenumber-js (WhatsApp link generator, numbers)",
    page: WA,
    vendor: [LIBPHONE, QRJS],
    async run(page, lang) {
      const got = [];
      for (const [cc, input] of WA_NUMBERS) {
        await waCountry(page, cc);
        got.push((await waNumber(page, input)).href);
      }
      expectNumbers(got);
      // Argentina without the 9: a hint and a button, never a block.
      await waCountry(page, "AR");
      const plain = await waNumber(page, "11 2345 6789");
      expect(plain.href === "https://wa.me/541123456789", `an Argentine number without the 9 gave ${plain.href || "no link"}; the link must still be made`);
      const add = page.locator("#addNineBtn");
      expect((await add.textContent()) === WA_TEXT[lang].add9, `the button says "${await add.textContent()}"`);
      await add.click();
      const nine = await page.getAttribute("#openLink", "href");
      expect(nine === "https://wa.me/5491123456789", `"${WA_TEXT[lang].add9}" gave ${nine}`);
      expect(!(await page.locator("#addNineBtn").count()), "the add-the-9 hint is still shown after adding the 9");
      // Mexico's old 1 after +52: dropped, with a note.
      await waCountry(page, "MX");
      const mx = await waNumber(page, "+52 1 55 1234 5678");
      expect(mx.status.includes(WA_TEXT[lang].mx1), `no note about the dropped 1: "${mx.status}"`);
      return `${WA_NUMBERS.length} numbers give the right wa.me links (Argentina 0/15/9, Mexico's 1 dropped with a note, Brazil, UK, 00 and 011 as +, US); ` +
        `"${WA_TEXT[lang].add9}" turns wa.me/541123456789 into wa.me/5491123456789; ` +
        mustFail("a wrong digit", () => expectNumbers(got.map((h, i) => (i === 3 ? h.replace(/8$/, "9") : h)))) + "; " +
        mustFail("011 under Argentina read as international", () => expectNumbers(got.map((h, i) => (i === 0 ? "https://wa.me/11523456789" : h))));
    },
  },
  {
    name: "WhatsApp link generator (message, preview, actions)",
    page: WA,
    vendor: [LIBPHONE, QRJS],
    async run(page, lang) {
      const t = WA_TEXT[lang];
      const empty = await waState(page);
      expectNoLink(empty, t.reason);
      await waCountry(page, "GB");
      await waNumber(page, "07400 123456");
      await page.fill("#messageInput", WA_MESSAGE);
      const href = await page.getAttribute("#openLink", "href");
      expectEncoded(href, WA_MESSAGE);
      const attrs = await page.evaluate(() => { const a = document.getElementById("openLink"); return [a.target, a.rel, a.hidden]; });
      expect(attrs[0] === "_blank" && attrs[1] === "noopener noreferrer" && !attrs[2], `the open link is ${attrs.join(" / ")}`);
      const preview = await page.evaluate(() => {
        const b = document.getElementById("bubble");
        return { tags: [...b.querySelectorAll("*")].map((e) => e.tagName.toLowerCase() + (e.className ? "." + e.className : "")), text: b.textContent, xss: window.__xss };
      });
      expectPreview(preview);
      // Copy and share, with the browser's clipboard and share sheet replaced by recorders.
      await page.evaluate(() => {
        window.__copied = null; window.__shared = null;
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__copied = text; } } });
        Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => { window.__shared = data; } });
      });
      await page.click("#copyBtn");
      await page.waitForFunction(() => document.getElementById("copyStatus").textContent !== "", null, { timeout: 5000 });
      const copy = await page.evaluate(() => ({ copied: window.__copied, status: document.getElementById("copyStatus").textContent, live: document.getElementById("copyStatus").getAttribute("aria-live") }));
      expectCopied(copy, href, t.copied);
      await page.click("#shareBtn");
      const shared = await page.evaluate(() => window.__shared);
      expect(shared && shared.url === href, `Share was given ${JSON.stringify(shared)}`);
      // No-number mode: WhatsApp asks who to send the message to.
      await page.click(".mode button >> nth=1");
      await page.fill("#messageInput", "");
      const any = await waState(page);
      expect(any.phoneHidden && any.reason === t.reasonMessage && any.openHidden, `no-number mode without a message: ${JSON.stringify(any)}`);
      await page.fill("#messageInput", "Hi there");
      const anyHref = await page.getAttribute("#openLink", "href");
      expect(anyHref === "https://wa.me/?text=Hi%20there", `no-number mode gave ${anyHref}`);
      return `link ${href.slice(0, 48)}... decodes back exactly; preview has strong, em, s, code and monospace, typed <img> stays text; ` +
        `copied with "${copy.status}" announced; shared; no-number mode gives wa.me/?text=; ` +
        [mustFail("a live link with no number", () => expectNoLink({ ...empty, openHidden: false, href: "https://wa.me/" }, t.reason)),
          mustFail("encoded with escape()", () => expectEncoded("https://wa.me/447400123456?text=" + escape(WA_MESSAGE), WA_MESSAGE)),
          mustFail("an element made from typed text", () => expectPreview({ ...preview, tags: [...preview.tags, "img"] })),
          mustFail("no announcement", () => expectCopied({ ...copy, status: "" }, href, t.copied))].join("; ");
    },
  },
  {
    name: "qrcodejs (WhatsApp link generator, QR code)",
    page: WA,
    vendor: [LIBPHONE, QRJS],
    async run(page, lang) {
      await waCountry(page, "GB");
      await waNumber(page, "07400 123456");
      await page.fill("#messageInput", "Hello");
      const short = await qrDownload(page);
      expectQrPng(short, lang);
      // The longest link qrcodejs can encode at level M still works; one character more is refused with a reason.
      const base = "https://wa.me/447400123456?text=";
      const fill = "a".repeat(WA_QR_MAX - base.length);
      await page.fill("#messageInput", fill);
      expect((await page.inputValue("#linkOutput")).length === WA_QR_MAX, "the test link isn't exactly at the limit");
      expectQrPng(await qrDownload(page), lang);
      await page.fill("#messageInput", fill + "a");
      const over = await page.evaluate(() => ({ disabled: document.getElementById("qrBtn").disabled, note: document.getElementById("qrNote").textContent }));
      expectQrBlocked(over, lang);
      const libFails = await page.evaluate((text) => {
        try { new QRCode(document.createElement("div"), { text, width: 64, height: 64, correctLevel: QRCode.CorrectLevel.M }); return false; } catch (e) { return true; }
      }, base + fill + "a");
      expect(libFails, `qrcodejs encodes ${WA_QR_MAX + 1} characters, so the limit in the page is out of date`);
      return `592x592 PNG ${short.name} with a quiet zone (${Math.round(short.dark * 100)}% dark); a ${WA_QR_MAX}-character link still works, ` +
        `${WA_QR_MAX + 1} is refused with "${over.note}" (qrcodejs itself fails there); ` +
        mustFail("an over-limit link offered as a QR code", () => expectQrBlocked({ ...over, disabled: false }, lang));
    },
  },
  {
    name: "circle-flags (WhatsApp link generator, country picker)",
    page: WA,
    vendor: [LIBPHONE, QRJS, FLAG("pe")],
    async run(page, lang) {
      await page.focus("#countryInput");
      await page.keyboard.press("ArrowDown");
      const opened = await page.evaluate(() => ({ expanded: document.getElementById("countryInput").getAttribute("aria-expanded"),
        active: document.getElementById("countryInput").getAttribute("aria-activedescendant"), shown: !document.getElementById("countryList").hidden }));
      expect(opened.expanded === "true" && opened.shown && opened.active, `ArrowDown didn't open the list: ${JSON.stringify(opened)}`);
      await page.keyboard.press("ArrowDown");
      const moved = await page.getAttribute("#countryInput", "aria-activedescendant");
      expect(moved && moved !== opened.active, "ArrowDown doesn't move the active option");
      await page.keyboard.press("Escape");
      expect((await page.getAttribute("#countryInput", "aria-expanded")) === "false", "Escape didn't close the list");
      const first = () => page.evaluate(() => { const li = [...document.querySelectorAll("#countryList li")].find((x) => !x.hidden); return li ? li.id : null; });
      // Accents and case are ignored ("peru" finds Perú), and a calling code finds its countries.
      await page.fill("#countryInput", "peru");
      const peru = await first();
      expectFirst(peru, "PE");
      await page.keyboard.press("Enter");
      const name = await regionName(page, "PE");
      expect((await page.inputValue("#countryInput")) === `${name} (+51)`, `picked "${await page.inputValue("#countryInput")}"`);
      await page.waitForFunction(() => { const f = document.getElementById("countryFlag"); return !f.hidden && f.complete && f.naturalWidth > 0; }, null, { timeout: 5000 });
      expect((await page.getAttribute("#countryFlag", "src")) === FLAG("pe") && (await page.getAttribute("#countryFlag", "alt")) === "", "the flag isn't the vendored pe.svg with an empty alt");
      await page.fill("#countryInput", "+44");
      expectFirst(await first(), "GB");
      await page.fill("#countryInput", "+1");
      const shared = await page.evaluate(() => [...document.querySelectorAll("#countryList li")].filter((x) => !x.hidden).map((x) => x.id));
      expect(shared.includes("country-US") && shared.includes("country-CA") && shared.includes("country-DO"), `+1 lists ${shared.length} countries, not the US, Canada and the Dominican Republic separately`);
      await page.fill("#countryInput", "zzzz");
      expect(await page.isVisible("#countryEmpty"), "no message when no country matches");
      await page.keyboard.press("Escape");
      expect((await page.inputValue("#countryInput")) === `${name} (+51)`, "Escape didn't restore the chosen country");
      return `ArrowDown opens and moves, Escape closes; "peru" finds ${name}, flag pe.svg loaded with an empty alt; +44 finds the UK; +1 lists ${shared.length} countries separately; ` +
        mustFail("an accented search that finds nothing", () => expectFirst(null, "PE"));
    },
  },
  {
    name: "WhatsApp link generator (remembered country, privacy)",
    page: WA,
    vendor: [LIBPHONE, QRJS],
    async run(page, lang, ctl) {
      const start = page.url();
      // The first browser language's region is the default (en-US, es-ES).
      const home = await regionName(page, lang === "es" ? "ES" : "US");
      const initial = await page.inputValue("#countryInput");
      expect(initial.startsWith(home + " (+"), `the default country is "${initial}", not ${home}`);
      await waCountry(page, "MX");
      expect((await page.evaluate(() => localStorage.getItem("orisod-wa-country"))) === "MX", "the chosen country wasn't saved as orisod-wa-country");
      await page.reload();
      const mexico = await regionName(page, "MX");
      const restored = await page.inputValue("#countryInput");
      const expectRestored = (value) => expect(value.startsWith(mexico + " (+"), `after a reload the country is "${value}", not ${mexico}`);
      expectRestored(restored);
      // A first browser language without a region: no country is guessed.
      await page.evaluate(() => localStorage.removeItem("orisod-wa-country"));
      await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["es"] }));
      await page.reload();
      expect((await page.inputValue("#countryInput")) === "", "a country was guessed from a language with no region");
      // This page's storage blocked (its own key throws): it still works and nothing breaks.
      await page.addInitScript(() => {
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (k) { if (String(k).startsWith("orisod-wa")) throw new DOMException("blocked", "SecurityError"); return get.call(this, k); };
        Storage.prototype.setItem = function (k, v) { if (String(k).startsWith("orisod-wa")) throw new DOMException("blocked", "SecurityError"); return set.call(this, k, v); };
      });
      await page.reload();
      await waCountry(page, "GB");
      // A whole session with a number and a message: nothing that carries either leaves the page.
      await waNumber(page, "07400 123456");
      await page.fill("#messageInput", `${WA_SECRET.words.join(" ")} 🙌`);
      expect((await page.getAttribute("#openLink", "href")).includes(WA_SECRET.digits), "no link with storage blocked");
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } });
        Object.defineProperty(navigator, "share", { configurable: true, value: async () => {} });
      });
      await page.click("#copyBtn");
      await page.click("#shareBtn");
      await qrDownload(page);
      await page.click(".mode button >> nth=1");
      await page.click(".mode button >> nth=0");
      await page.waitForTimeout(700);
      expectNothingSent(ctl.requests, page.url(), start);
      await page.evaluate(() => history.replaceState(null, "", location.pathname + "?text=Zanahoria"));
      const changed = page.url();
      return `default ${home} from the browser language, MX saved and restored, no guess for "es", works with storage blocked; ` +
        `${ctl.requests.length} requests, none with the number or the message, URL unchanged; ` +
        [mustFail("the saved country not restored", () => expectRestored(initial)),
          mustFail("history.replaceState adding ?text=", () => expectNothingSent(ctl.requests, changed, start)),
          mustFail("a request with the number", () => expectNothingSent([...ctl.requests, "https://orisod.goatcounter.com/count?p=/x&q=447400123456"], start, start))].join("; ");
    },
  },
  {
    name: "WhatsApp link generator (placeholders)",
    page: WA,
    vendor: [LIBPHONE, QRJS, WA_EXAMPLES],
    async run(page, lang) {
      const examples = JSON.parse(await readFile(`${REPO_ROOT}${WA_EXAMPLES}`, "utf-8"));
      expect((await page.getAttribute("#messageInput", "placeholder")) === WA_MSG_PLACEHOLDER[lang], "the message placeholder isn't the approved text");
      const labels = await waLabels(page);
      expectLabels(labels, lang);
      // Both themes: the placeholders stay readable against the field.
      await page.addStyleTag({ content: "*{transition:none !important}" });
      const contrast = {};
      for (const theme of ["dark", "light"]) {
        await page.evaluate((t) => (t === "light" ? document.documentElement.setAttribute("data-theme", "light") : document.documentElement.removeAttribute("data-theme")), theme);
        for (const id of ["phoneInput", "messageInput"]) expectContrast(contrast[theme + " " + id] = await waPlaceholderContrast(page, "#" + id), `${theme} ${id}`);
      }
      // Changing the country changes the example, in its own national format.
      await waPick(page, "US");
      await page.waitForFunction(() => document.getElementById("phoneInput").placeholder === "(201) 555-0123");
      await waPick(page, "GB");
      const gb = await waPlaceholder(page);
      expect(gb === "07400 123456", `the United Kingdom's placeholder is "${gb}"`);
      // A placeholder is not a value: Argentina and Mexico with an empty field give no link, note or hint.
      for (const code of ["AR", "MX"]) {
        await waPick(page, code);
        await waNumber(page, "");
        const s = await page.evaluate(() => ({ href: document.getElementById("openLink").getAttribute("href") || "", status: document.getElementById("phoneStatus").textContent,
          add9: document.querySelectorAll("#addNineBtn").length, value: document.getElementById("phoneInput").value }));
        expect(!s.href && !s.status && !s.add9 && !s.value, `${code} with only its placeholder gave a link, a note or a value: ${JSON.stringify(s)}`);
      }
      // Every country in the list: type its example as it is shown.
      const rows = await waEveryExample(page, examples);
      expectExamples(rows);
      const shared = rows.filter((r) => r.country && r.country !== r.code).map((r) => `${r.code} as ${r.country}`);
      // No country chosen (a first browser language with no region): no placeholder; the label stays.
      await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["es"] }));
      await page.evaluate(() => localStorage.removeItem("orisod-wa-country"));
      await page.reload();
      await page.waitForLoadState("networkidle");
      expect((await page.inputValue("#countryInput")) === "", "a country was chosen on load");
      const none = await waPlaceholder(page);
      expect(!none, `with no country the phone placeholder is "${none}"`);
      expectLabels(await waLabels(page), lang);
      const withData = rows.filter((r) => r.want).length;
      return `${withData} of ${rows.length} countries have an example and each typed as shown is valid and gives its wa.me link with no error ` +
        `(read back as the main country: ${shared.join(", ")}); the placeholder follows the country (US "(201) 555-0123", UK "07400 123456"), ` +
        `none with no country, labels kept, Argentina and Mexico ignore it; contrast ${Object.entries(contrast).map(([k, v]) => `${k} ${v.toFixed(1)}:1`).join(", ")}; ` +
        mustFail("a US-format example under another country", () => expectExamples(rows.map((r) => (r.code === "GB" ? { ...r, placeholder: "(201) 555-0123" } : r)))) + "; " +
        mustFail("an example that gives no link", () => expectExamples(rows.map((r) => (r.code === "DE" ? { ...r, href: "" } : r)))) + "; " +
        mustFail("an example read as another country", () => expectExamples(rows.map((r) => (r.code === "ES" ? { ...r, country: "PT" } : r)))) + "; " +
        mustFail("a missing label", () => expectLabels({ ...labels, phoneInput: "" }, lang)) + "; " +
        mustFail("a faint placeholder", () => expectContrast(3.2, "test"));
    },
  },
  {
    name: "WhatsApp link generator (placeholders, examples file missing)",
    page: WA,
    vendor: [LIBPHONE, QRJS],
    broken: () => ({ path: WA_EXAMPLES, mode: "404" }),
    async run(page) {
      await page.waitForLoadState("networkidle");
      await waPick(page, "US");
      const us = await waPlaceholder(page);
      expect(us === WA_US_FALLBACK, `without the examples the United States placeholder is "${us}", not "${WA_US_FALLBACK}"`);
      const s = await waNumber(page, us);
      expect(s.href === "https://wa.me/12025550123", `typing the fallback example gave ${s.href || "no link"}`);
      const others = [];
      for (const code of ["GB", "MX", "AR", "CA"]) {
        await waPick(page, code);
        others.push([code, (await waPlaceholder(page)) || ""]);
      }
      const expectNoneElsewhere = (o) => expect(o.every(([, p]) => !p), "a country other than the US has a placeholder without the examples: " + o.filter(([, p]) => p).map(([c, p]) => `${c} "${p}"`).join(", "));
      expectNoneElsewhere(others);
      return `the United States shows "${WA_US_FALLBACK}" (wa.me/12025550123 when typed), the UK, Mexico, Argentina and Canada (also +1) show none; ` +
        mustFail("a US example under Canada", () => expectNoneElsewhere([...others, ["CA", WA_US_FALLBACK]]));
    },
  },
  {
    name: "WhatsApp link generator (minimal layout, collapsed block)",
    page: WA,
    vendor: [LIBPHONE, QRJS],
    async run(page, lang) {
      const structure = await page.evaluate(WA_STRUCTURE);
      expectStructure(structure);
      // The operational notes live in the collapsed block (6 sections, FAQ last), not in the tool; the QR note shows only with a link.
      const notes = await page.evaluate(() => {
        const d = document.querySelector("details.more"), tool = document.querySelector(".tool");
        const ids = ["countryHint", "phoneHint", "fmtHelp", "messageHint", "emojiHelp", "emojiLengthNote"];
        return { moved: ids.filter((id) => d.contains(document.getElementById(id)) && !tool.contains(document.getElementById(id))).length,
          sections: d.querySelectorAll(".seo-content > h2").length, faqLast: d.querySelector(".seo-content > h2:last-of-type").nextElementSibling?.className === "faq-item",
          facts: tool.querySelectorAll("ul:not(.combo-list)").length, qrHidden: document.getElementById("qrNote").hidden };
      });
      expectNotes(notes);
      const summary = page.locator("details.more > summary");
      const closed = await page.evaluate(() => {
        const d = document.querySelector("details.more"), s = d.querySelector("summary");
        return { open: d.open, text: d.textContent, label: s.textContent.trim(), height: s.getBoundingClientRect().height,
          interactive: s.querySelectorAll("a, button, input, select, textarea, [tabindex]").length, arrow: getComputedStyle(s, "::before").transform };
      });
      expect(!closed.open, "the collapsed block is open on load");
      expect(closed.label === WA_TEXT[lang].summary && closed.height >= 44 && !closed.interactive, `summary "${closed.label}", ${closed.height}px, ${closed.interactive} controls inside`);
      const faq = await page.evaluate(WA_FAQ);
      expect(faq.visible.every(([q, a]) => closed.text.includes(q) && closed.text.includes(a)), "the FAQ text isn't in the page while the block is closed");
      expectFaq(faq);
      await summary.focus();
      await page.keyboard.press("Enter");
      const afterEnter = await page.evaluate(() => ({ open: document.querySelector("details.more").open, arrow: getComputedStyle(document.querySelector("details.more > summary"), "::before").transform }));
      expect(afterEnter.open, "Enter on the summary didn't open the block");
      // The arrow turns with a 0.2 s transition: read it once that's over.
      await page.waitForTimeout(400);
      afterEnter.arrow = await page.evaluate(() => getComputedStyle(document.querySelector("details.more > summary"), "::before").transform);
      expectIndicator(closed.arrow, afterEnter.arrow);
      await page.keyboard.press("Space");
      expect(!(await page.evaluate(() => document.querySelector("details.more").open)), "Space on the summary didn't close the block");
      const ring = await page.evaluate(() => getComputedStyle(document.querySelector("details.more > summary")).outlineStyle);
      expect(ring === "solid", `the focused summary has no visible focus ring (outline ${ring})`);
      // 200% zoom at 320 CSS px: no sideways scrolling, also with the form filled, the list and the block open.
      await page.setViewportSize({ width: 320, height: 640 });
      const widths = [["empty", await waOverflow(page)]];
      await waCountry(page, "AR");
      await waNumber(page, "11 2345 6789");
      const qrShown = await page.evaluate(() => { const n = document.getElementById("qrNote"); return !n.hidden && n.getClientRects().length > 0 && n.textContent.length > 0; });
      expect(qrShown, "the QR note isn't shown once there's a link");
      await page.fill("#messageInput", "https://example.org/" + "x".repeat(300) + "\n*bold* " + "y".repeat(200));
      widths.push(["filled", await waOverflow(page)]);
      await page.click("#qrBtn");
      widths.push(["QR shown", await waOverflow(page)]);
      await page.focus("#countryInput");
      await page.keyboard.press("ArrowDown");
      widths.push(["country list open", await waOverflow(page)]);
      await page.keyboard.press("Escape");
      await summary.click();
      widths.push(["block open", await waOverflow(page)]);
      for (const [when, px] of widths) expectNoOverflow(px, when);
      // Negatives on the live page: the block moved after the footer, a 400px element at 320px.
      await page.evaluate(() => document.querySelector("footer.site-footer").after(document.querySelector("details.more")));
      const moved = await page.evaluate(WA_STRUCTURE);
      await page.evaluate(() => { const d = document.createElement("div"); d.style.width = "400px"; d.style.height = "1px"; document.querySelector(".tool").append(d); });
      const wide = await waOverflow(page);
      // Without JavaScript the block is still there, closed, and opens with a click.
      const noJs = await page.context().browser().newContext({ javaScriptEnabled: false });
      await noJs.route("**/*", async (route) => {
        const url = route.request().url();
        return url.startsWith(SITE + "/") ? route.fulfill(await localFile(url)) : route.abort();
      });
      const plain = await noJs.newPage();
      await plain.goto(SITE + (lang === "es" ? "/es" : "") + WA, { waitUntil: "load" });
      const wasOpen = await plain.evaluate(() => document.querySelector("details.more").open);
      await plain.click("details.more > summary");
      const nowOpen = await plain.evaluate(() => ({ open: document.querySelector("details.more").open, faq: document.querySelectorAll("details.more .faq-item").length }));
      await noJs.close();
      expect(!wasOpen && nowOpen.open && nowOpen.faq === 4, `without JavaScript the block was open ${wasOpen}, opened ${nowOpen.open}, ${nowOpen.faq} FAQ items`);
      return `footer last; How it works with 3 steps and the guide link under them, 3 Related tools cards, one block with its summary first; ` +
        `the field notes in the block's 6 sections, the QR note only once there's a link; closed on load with its text in the page; "${closed.label}" ${Math.round(closed.height)}px; ` +
        `Enter opens, Space closes, the arrow turns, focus ring shown; FAQ equals the FAQPage JSON-LD; no sideways scroll at 320 px (${widths.map((w) => w[0]).join(", ")}); works without JavaScript; ` +
        [mustFail("the block moved after the footer", () => expectStructure(moved)),
          mustFail("a fourth step", () => expectStructure({ ...structure, steps: 4 })),
          mustFail("the guide link inside the block", () => expectStructure({ ...structure, guideInDetails: true })),
          mustFail("two Related tools cards", () => expectStructure({ ...structure, cards: 2 })),
          mustFail("a summary with role=button", () => expectStructure({ ...structure, summaryRole: "button" })),
          mustFail("a hint left in the tool", () => expectNotes({ ...notes, moved: 5 })),
          mustFail("the QR note shown with no link", () => expectNotes({ ...notes, qrHidden: false })),
          mustFail("a FAQ answer that differs from the JSON-LD", () => expectFaq({ ...faq, jsonld: faq.jsonld.map((x, i) => (i === 2 ? [x[0], x[1] + " Extra."] : x)) })),
          mustFail("an indicator that doesn't change", () => expectIndicator(closed.arrow, closed.arrow)),
          mustFail("a 400px element at 320 px", () => expectNoOverflow(wide, "with a 400px element"))].join("; ");
    },
  },
  {
    name: "WhatsApp link generator (share this tool)",
    page: WA,
    vendor: [LIBPHONE, QRJS],
    async run(page, lang, ctl) {
      const t = WA_SHARE[lang], prefix = lang === "es" ? "/es" : "";
      // Opened with a query string and a fragment: neither may reach a share link.
      await page.goto(SITE + prefix + WA + "?x=1#y");
      await page.waitForLoadState("networkidle");
      const atLoad = waOutside(ctl.requests);
      const structure = await page.evaluate(WA_STRUCTURE);
      expectStructure(structure);
      const closed = await waShareState(page);
      expect(!closed.open && closed.menuShown && !closed.nativeShown, `on a desktop the share list is open ${closed.open}, shown ${closed.menuShown}, native button ${closed.nativeShown}`);
      expectShareControl(closed, lang);
      expectShareList(closed, lang);
      expect(closed.live === "polite" && closed.status === "", `the share status line is aria-live ${closed.live} with "${closed.status}" on load`);
      // Enter opens, Space closes; the icon changes (a cross while open).
      const icon = () => page.evaluate(() => [...document.querySelectorAll("#shareMenu > summary svg")].map((x) => getComputedStyle(x).display).join(" "));
      const closedIcon = await icon();
      await page.focus("#shareMenu > summary");
      await page.keyboard.press("Enter");
      const openIcon = await icon();
      expect((await waShareState(page)).open, "Enter on the share summary didn't open it");
      expectIndicator(closedIcon, openIcon);
      await page.keyboard.press("Space");
      expect(!(await waShareState(page)).open, "Space on the share summary didn't close it");
      await page.keyboard.press("Enter");
      const opened = await waShareState(page);
      expectShareLinks(opened, lang);
      expectShareRows(opened, await waOverflow(page), [8], "1280px");
      // Every tooltip at 1280px: its own name, inside the page, over no control.
      const tips1280 = await waEveryTip(page, lang);
      expectEveryTip(tips1280, lang, "1280px");
      // The first Escape hides the tooltip (focus stays on the item), the second closes the list and focuses the summary.
      await page.keyboard.press("Escape");
      const esc1 = { ...(await waShareState(page)), tip: await waTipCheck(page) };
      expect(esc1.open && esc1.focus === "list" && esc1.tip.count === 0, `after one Escape the list is open ${esc1.open}, focus on ${esc1.focus}, ${esc1.tip.count} tooltips`);
      await page.keyboard.press("Escape");
      const esc2 = await waShareState(page);
      expect(!esc2.open && esc2.focus === "summary", `after a second Escape the list is open ${esc2.open}, focus on ${esc2.focus}`);
      // Hover shows the tooltip and keeps it while the pointer moves into the space under the list; Escape hides it.
      await page.click("#shareMenu > summary");
      await page.hover('#shareList a[data-share="telegram"]');
      const hoverTip = await waTipCheck(page);
      expectTip(hoverTip, t.labels[2], "Telegram hovered");
      const slot = await page.evaluate(() => { const r = document.getElementById("shareList").getBoundingClientRect(); return [r.left + r.width / 2, r.bottom - 20]; });
      await page.mouse.move(slot[0], slot[1], { steps: 4 });
      expectTip(await waTipCheck(page), t.labels[2], "pointer moved onto the tooltip");
      await page.keyboard.press("Escape");
      const hoverEsc = { ...(await waTipCheck(page)), open: (await waShareState(page)).open };
      expect(hoverEsc.count === 0 && hoverEsc.open, `after Escape on a hover tooltip: ${hoverEsc.count} tooltips, list open ${hoverEsc.open}`);
      await page.mouse.move(0, 0);
      // The tool's number and message never reach the share links, the copied text or the shared data.
      await waCountry(page, "GB");
      await waNumber(page, "07400 123456");
      await page.fill("#messageInput", `${WA_SECRET.words.join(" ")} 🙌`);
      if (!(await waShareState(page)).open) await page.click("#shareMenu > summary");
      const atOpen = waOutside(ctl.requests);
      // Copy: success and failure each update the status line once.
      await waWatchShareStatus(page);
      await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (x) => { window.__toolCopied = x; } } }));
      await page.click("#shareCopy");
      await page.waitForFunction(() => document.getElementById("shareToolStatus").textContent !== "");
      await page.waitForTimeout(200);
      const copied = { ...(await waShareState(page)), text: await page.evaluate(() => window.__toolCopied) };
      const expectCopy = (st, text, changes) => expect(st.status === text && st.changes === changes, `the status says "${st.status}" after ${st.changes} updates, not "${text}" after ${changes}`);
      expectCopy(copied, t.copied, 1);
      expect(copied.text === t.url, `Copy tool link copied ${copied.text}, not ${t.url}`);
      expectShareLinks(copied, lang);
      expectNoSecret([...copied.items.map((i) => i.href), copied.text], "Share this tool");
      await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("denied", "NotAllowedError"); } } }));
      await page.click("#shareCopy");
      await page.waitForFunction((x) => document.getElementById("shareToolStatus").textContent === x, t.copyFail);
      await page.waitForTimeout(200);
      const failed = await waShareState(page);
      expectCopy(failed, t.copyFail, 2);
      const atCopy = waOutside(ctl.requests);
      for (const [when, urls] of [["at load", atLoad], ["on opening the list", atOpen], ["on copying", atCopy]]) expectOutsideRequests(urls, when);
      await page.mouse.move(0, 0);
      // The lit state: 180 ms normally, none under reduced motion.
      const telegram = '#shareList a[data-share="telegram"]';
      const normalMotion = (await waShareColours(page, telegram)).transition;
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reducedMotion = (await waShareColours(page, telegram)).transition;
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const expectMotion = (normal, reduced) => expect(/^0\.18s/.test(normal) && reduced.split(",").every((d) => parseFloat(d) === 0), `transition ${normal}, under reduced motion ${reduced}`);
      expectMotion(normalMotion, reducedMotion);
      // Both themes, measured without the halo: plain, hovered (lit), focused (lit, with the unchanged solid ring).
      await page.addStyleTag({ content: "*{transition:none !important}" });
      const colours = [];
      let litDark = null;
      for (const theme of ["dark", "light"]) {
        await page.evaluate((x) => (x === "light" ? document.documentElement.setAttribute("data-theme", "light") : document.documentElement.removeAttribute("data-theme")), theme);
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.activeElement.blur());
        const plain = await waShareColours(page, telegram);
        expectShareColours(plain, theme, WA_SHARE_BLUE);
        expect(!plain.halo, `${theme}: a halo with no hover or focus`);
        await page.hover(telegram);
        const lit = await waShareColours(page, telegram);
        expectShareColours(lit, theme + " hovered", WA_SHARE_LIT);
        expect(lit.halo, `${theme}: no halo when hovered`);
        if (theme === "dark") litDark = lit;
        await page.mouse.move(0, 0);
        await page.focus("#shareCopy");
        await page.keyboard.press("Tab");
        const focused = await waShareColours(page, telegram);
        expectShareColours(focused, theme + " focused", WA_SHARE_LIT);
        expectShareRing(focused, theme + " focused");
        await page.hover(telegram);
        const both = await waShareColours(page, telegram);
        expectShareRing(both, theme + " focused and hovered");
        colours.push(`${theme}: plain icon ${waContrast(plain.icon, plain.fill).toFixed(2)}:1, circle ${waContrast(plain.fill, plain.page).toFixed(2)}:1; ` +
          `lit icon ${waContrast(lit.icon, lit.fill).toFixed(2)}:1, circle ${waContrast(lit.fill, lit.page).toFixed(2)}:1; ring ${waContrast(focused.ring.color, focused.page).toFixed(2)}:1`);
      }
      await page.evaluate(() => { document.documentElement.removeAttribute("data-theme"); document.activeElement.blur(); });
      await page.mouse.move(0, 0);
      // 390 and 320 CSS px (320 is a 640px window at 200% zoom): 4 + 4, centred, 44px targets, no overlap, every tooltip clear.
      const narrow = {};
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 700 });
        const st = await waShareState(page);
        expectShareLinks(st, lang);
        expectShareRows(st, await waOverflow(page), [4, 4], width + "px");
        const tips = await waEveryTip(page, lang);
        expectEveryTip(tips, lang, width + "px");
        expectNoOverflow(await waOverflow(page), width + "px with a tooltip shown");
        narrow[width] = { st, tips };
        await page.keyboard.press("Escape");
      }
      // No hover style where the device can't hover (a touch screen without navigator.share keeps the list).
      const touch = await waShareContext(page.context().browser(), lang, { hasTouch: true }, () => { Object.defineProperty(navigator, "share", { configurable: true, value: undefined }); });
      await touch.page.addStyleTag({ content: "*{transition:none !important}" });
      await touch.page.click("#shareMenu > summary");
      await touch.page.hover(telegram);
      const noHover = { ...(await waShareColours(touch.page, telegram)), media: await touch.page.evaluate(() => matchMedia("(hover: none)").matches) };
      await touch.context.close();
      const expectNoHoverStyle = (c) => expect(c.media && JSON.stringify(c.fill) === JSON.stringify(WA_SHARE_BLUE) && !c.halo, `under (hover: none) a hovered circle is rgb(${c.fill}) with halo ${c.halo}`);
      expectNoHoverStyle(noHover);
      // Without JavaScript: the same links in the HTML, no Copy button, the list opens with a click.
      const noJs = await waShareContext(page.context().browser(), lang, { javaScriptEnabled: false });
      const wasOpen = await noJs.page.evaluate(() => document.getElementById("shareMenu").open);
      await noJs.page.click("#shareMenu > summary");
      const plainJs = await waShareState(noJs.page);
      await noJs.context.close();
      expect(!wasOpen && plainJs.open && plainJs.menuShown && !plainJs.nativeShown, `without JavaScript the list was open ${wasOpen}, opened ${plainJs.open}`);
      expectShareLinks(plainJs, lang, WA_SHARE_ORDER.filter((k) => k !== "copy"));
      expectShareList(plainJs, lang);
      // A browser without the Clipboard API: no Copy button.
      const noClip = await waShareContext(page.context().browser(), lang, {}, () => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); });
      const without = await waShareState(noClip.page);
      await noClip.context.close();
      expectShareLinks(without, lang, WA_SHARE_ORDER.filter((k) => k !== "copy"));
      // Only a click on a link reaches the service: one navigation, to exactly that address.
      const nav = await waShareContext(page.context().browser(), lang);
      await nav.page.click("#shareMenu > summary");
      const before = [...nav.outside];
      const [popup] = await Promise.all([nav.page.waitForEvent("popup"), nav.page.click('#shareList a[data-share="reddit"]')]);
      await popup.waitForLoadState();
      const reddit = waShareHrefs(t.url, t.title).reddit;
      const clicked = [...nav.outside];
      await nav.context.close();
      expect(!before.length && clicked.length === 1 && clicked[0] === reddit, `clicking Reddit requested ${JSON.stringify(clicked)} (before: ${JSON.stringify(before)})`);
      const extra = [...touch.errors, ...noJs.errors, ...noClip.errors, ...nav.errors];
      expect(!extra.length, `errors in the extra contexts: ${extra.join("; ")}`);
      const coverAt = (tips, i, what) => tips.map((x, n) => (n === i ? { ...x, covers: [what] } : x));
      return `one share control, "${t.toggle}", distinct from the result's "${t.resultShare}"; a <ul> named by the summary text; closed on load, Enter opens, Space closes, the icon changes; ` +
        `${opened.items.length} items in order, each href the expected address for ${t.url} (opened with ?x=1#y); 1280px one line, 390px and 320px 4 + 4 with no overlap or sideways scroll; ` +
        `every tooltip (${3 * WA_SHARE_ORDER.length} checked) inside the page and over no control; Escape hides the tooltip, then closes the list and focuses the summary; ` +
        `hover tooltip kept on the way to it; copy announced once ("${t.copied}", then "${t.copyFail}"); no number or message anywhere; ` +
        `no outside request at load, opening or copying, one on clicking Reddit; transition ${normalMotion}, ${reducedMotion} under reduced motion; ${colours.join("; ")}; no hover style under (hover: none); ` +
        `no Copy without JavaScript or the Clipboard API; ` +
        [mustFail("a summary with role=button", () => expectShareControl({ ...closed, summaryRole: "button" }, lang)),
          mustFail("aria-expanded added to the summary", () => expectShareControl({ ...closed, summaryExpanded: "false" }, lang)),
          mustFail("the same name as the result's share button", () => expectShareControl({ ...closed, summaryName: closed.resultShare }, lang)),
          mustFail("a list with role=menu", () => expectShareList({ ...closed, list: { ...closed.list, role: "menu" } }, lang)),
          mustFail("a list without its name", () => expectShareList({ ...closed, list: { ...closed.list, labelledby: null, label: "", labelInSummary: false } }, lang)),
          mustFail("two share controls", () => expectStructure({ ...structure, shareControls: 2 })),
          mustFail("the share block after the collapsed block", () => expectStructure({ ...structure, inOrder: false })),
          mustFail("the page's query string shared", () => expectShareLinks({ ...opened, items: opened.items.map((i) => (i.kind === "facebook" ? { ...i, href: i.href.replace("%2F", "%2F%3Fx%3D1") } : i)) }, lang)),
          mustFail("the fragment shared", () => expectShareLinks({ ...opened, items: opened.items.map((i) => (i.kind === "x" ? { ...i, href: i.href + "%23y" } : i)) }, lang)),
          mustFail("an unencoded Reddit title", () => expectShareLinks({ ...opened, items: opened.items.map((i) => (i.kind === "reddit" ? { ...i, href: `https://www.reddit.com/submit?url=${encodeURIComponent(t.url)}&title=${t.title}` } : i)) }, lang)),
          mustFail("the other language's address", () => expectShareLinks(opened, lang === "es" ? "en" : "es")),
          mustFail("Reddit and email swapped", () => expectShareLinks({ ...opened, items: [...opened.items.slice(0, 6), opened.items[7], opened.items[6]] }, lang)),
          mustFail("a new-tab link without its hidden text", () => expectShareLinks({ ...opened, items: opened.items.map((i) => (i.kind === "reddit" ? { ...i, name: t.labels[6] } : i)) }, lang)),
          mustFail("the number in a share link", () => expectNoSecret([opened.items[0].href + WA_SECRET.digits], "Share this tool")),
          mustFail("the status updated twice", () => expectCopy(copied, t.copied, 2)),
          mustFail("Copy without the Clipboard API", () => expectShareLinks(copied, lang, WA_SHARE_ORDER.filter((k) => k !== "copy"))),
          mustFail("a request at load", () => expectOutsideRequests(["https://www.facebook.com/tr"], "at load")),
          mustFail("5 + 3 at 320px", () => expectShareRows({ ...narrow[320].st, rows: [5, 3] }, 0, [4, 4], "test")),
          mustFail("two lines at 1280px", () => expectShareRows({ ...opened, rows: [4, 4] }, 0, [8], "test")),
          mustFail("overlapping items", () => expectShareRows({ ...narrow[390].st, overlapping: 1 }, 0, [4, 4], "test")),
          mustFail("a tooltip over the toggle", () => expectEveryTip(coverAt(narrow[320].tips, 0, "summary"), lang, "test")),
          mustFail("a last-row tooltip over its neighbour", () => expectEveryTip(coverAt(narrow[390].tips, 7, "reddit"), lang, "test")),
          mustFail("a tooltip left after Escape", () => expectTip(hoverTip, null, "test")),
          mustFail("a 30px link", () => expectShareLinks({ ...opened, items: opened.items.map((i, n) => (n === 3 ? { ...i, box: [30, 30, i.box[2], i.box[3]] } : i)) }, lang)),
          mustFail("a faint lit icon", () => expectShareColours({ ...litDark, icon: [150, 180, 250] }, "test", WA_SHARE_LIT)),
          mustFail("a lit circle too close to the page", () => expectShareColours({ ...litDark, page: [70, 110, 200] }, "test", WA_SHARE_LIT)),
          mustFail("a changed focus ring", () => expectShareRing({ ...litDark, ring: { ...WA_SHARE_RING, style: "dotted" } }, "test")),
          mustFail("a transition under reduced motion", () => expectMotion(normalMotion, "0.18s, 0.18s")),
          mustFail("a hover style under (hover: none)", () => expectNoHoverStyle({ ...noHover, fill: WA_SHARE_LIT }))].join("; ");
    },
  },
  {
    name: "WhatsApp link generator (share this tool, hover and close)",
    page: WA,
    vendor: [LIBPHONE, QRJS],
    async run(page, lang) {
      const t = WA_SHARE[lang], want = waShareHrefs(t.url, t.title), S = "#shareMenu > summary";
      // Share destinations answered here and aborted: nothing reaches them, every attempt is recorded.
      const hits = [];
      await page.context().route(/^https:\/\/(wa\.me|t\.me|www\.facebook\.com|x\.com|www\.linkedin\.com|www\.reddit\.com)\//, (r) => { hits.push(r.request().url()); return r.abort(); });
      // The click's default action is never cancelled (a listener on window runs after the page's own).
      await page.evaluate(() => window.addEventListener("click", (e) => { if (e.target.closest?.("#shareList")) window.__prevented = e.defaultPrevented; }));
      await page.mouse.move(0, 0);
      const log = [];
      // Hover intent: not before the delay, open after it; a pass shorter than the delay opens nothing.
      await waMouseTo(page, S);
      await page.waitForTimeout(WA_HOVER_OPEN / 3);
      const early = await waMenu(page);
      await page.waitForTimeout(WA_HOVER_OPEN * 2);
      const opened = await waMenu(page);
      expectMenu(early, false, "40 ms into a hover");
      expectMenu(opened, true, "after the hover delay");
      // Summary to an icon: stays open. Leaving the zone: still open just after, closed after the delay.
      await waMouseTo(page, '#shareList a[data-share="reddit"]');
      await page.waitForTimeout(WA_HOVER_CLOSE + 200);
      expectMenu(await waMenu(page), true, "pointer moved from the summary to an icon");
      await page.mouse.move(5, 5, { steps: 3 });
      await page.waitForTimeout(WA_HOVER_CLOSE / 3);
      const leaving = await waMenu(page);
      await page.waitForTimeout(WA_HOVER_CLOSE + 150);
      const left = await waMenu(page);
      expectMenu(leaving, true, "100 ms after leaving");
      expectMenu(left, false, "after the close delay");
      await waMouseTo(page, S);
      await page.waitForTimeout(WA_HOVER_OPEN / 3);
      await page.mouse.move(5, 5, { steps: 2 });
      await page.waitForTimeout(WA_HOVER_OPEN + WA_HOVER_CLOSE);
      const brief = await waMenu(page);
      expectMenu(brief, false, "a hover shorter than the delay");
      log.push("hover opens after the delay, not before; icon keeps it open; leaving closes it after the delay; a brief pass opens nothing");
      // Focus inside the zone keeps a hover-opened list open; once focus leaves, it closes.
      await waMouseTo(page, S);
      await page.waitForTimeout(WA_HOVER_OPEN * 2);
      await page.focus('#shareList a[data-share="x"]');
      await page.mouse.move(5, 5, { steps: 3 });
      await page.waitForTimeout(WA_HOVER_CLOSE + 200);
      const focusKept = await waMenu(page);
      expectMenu(focusKept, true, "pointer gone, focus on X");
      await page.focus("#messageInput");
      await page.waitForTimeout(WA_HOVER_CLOSE + 200);
      expectMenu(await waMenu(page), false, "focus moved out of the list");
      // A click on a hover-opened list pins it (leaving no longer closes it); the next click closes it.
      await waMouseTo(page, S);
      await page.waitForTimeout(WA_HOVER_OPEN * 2);
      await page.mouse.down();
      await page.mouse.up();
      await page.mouse.move(5, 5, { steps: 3 });
      await page.waitForTimeout(WA_HOVER_CLOSE + 200);
      const pinned = await waMenu(page);
      expectMenu(pinned, true, "pinned by a click, pointer gone");
      await page.click(S);
      await page.mouse.move(5, 5);
      expectMenu(await waMenu(page), false, "second click on the pinned list");
      log.push("focus inside keeps it open; a click pins a hover-opened list, the next click closes it");
      // Keyboard: Enter and Space toggle as before; a keyboard-opened list is pinned; Escape twice.
      await page.focus(S);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(WA_HOVER_CLOSE + 200);
      expectMenu(await waMenu(page), true, "Enter, pointer elsewhere");
      await page.keyboard.press("Space");
      expectMenu(await waMenu(page), false, "Space");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      const esc1 = { ...(await waMenu(page)), tip: (await waTipCheck(page)).count };
      await page.keyboard.press("Escape");
      const esc2 = await waMenu(page);
      expect(esc1.open && esc1.tip === 0 && esc1.focus === "list", `first Escape: list open ${esc1.open}, ${esc1.tip} tooltips, focus ${esc1.focus}`);
      expectMenu(esc2, false, "second Escape", "summary", true);
      // A hover-opened list closes on Escape even with focus elsewhere, and focus stays where it was.
      await page.focus("#messageInput");
      await waMouseTo(page, S);
      await page.waitForTimeout(WA_HOVER_OPEN * 2);
      await page.mouse.move(5, 5);
      await page.keyboard.press("Escape");
      const transientEsc = await waMenu(page);
      expectMenu(transientEsc, false, "Escape on a hover-opened list", "TEXTAREA");
      log.push("Enter and Space toggle, keyboard-opened is pinned, Escape hides the tooltip then closes; Escape closes a hover-opened list without moving focus");
      // Choosing each service with the mouse: the browser's action goes ahead (a new tab for 6, mailto not cancelled),
      // the list closes, focus is on the summary without a ring, and hover can't reopen it until the pointer leaves.
      const chosen = [];
      for (const kind of ["whatsapp", "telegram", "facebook", "x", "linkedin", "reddit", "email"]) {
        await page.mouse.move(5, 5);
        await waMouseTo(page, S);
        await page.waitForTimeout(WA_HOVER_OPEN * 2);
        const sel = `#shareList a[data-share="${kind}"]`;
        const before = hits.length;
        let popup = null;
        if (kind === "email") {
          await page.click(sel);
        } else {
          [popup] = await Promise.all([page.waitForEvent("popup"), page.click(sel)]);
        }
        await page.waitForTimeout(50);
        const after = { ...(await waMenu(page)), prevented: await page.evaluate(() => window.__prevented), hit: hits.slice(before) };
        if (popup) await popup.close();
        // Straight back onto the summary in one movement, never outside the share control: hover doesn't reopen it.
        const [sx, sy] = await waCentre(page, S);
        await page.mouse.move(sx, sy);
        await page.waitForTimeout(WA_HOVER_OPEN * 3);
        const stayed = await waMenu(page);
        chosen.push({ kind, after, stayed, popup: !!popup });
      }
      const expectChosen = (c) => {
        expectMenu(c.after, false, `after choosing ${c.kind}`, "summary", false);
        expect(c.after.prevented === false, `the ${c.kind} click was cancelled`);
        expect(c.kind === "email" ? !c.popup && !c.after.hit.length : c.popup && c.after.hit.length === 1 && c.after.hit[0] === want[c.kind],
          `${c.kind}: new tab ${c.popup}, requested ${JSON.stringify(c.after.hit)}`);
        expectMenu(c.stayed, false, `hovering the summary again after ${c.kind}, without leaving`);
      };
      chosen.forEach(expectChosen);
      // Leaving and coming back opens it again.
      await page.mouse.move(5, 5, { steps: 3 });
      await waMouseTo(page, S);
      await page.waitForTimeout(WA_HOVER_OPEN * 2);
      const reentered = await waMenu(page);
      expectMenu(reentered, true, "leaving and hovering again after a choice");
      // Focus is on the summary (inside the zone), so the hover-opened list stays open when the pointer leaves.
      await page.mouse.move(5, 5);
      await page.waitForTimeout(WA_HOVER_CLOSE + 150);
      const focusHolds = await waMenu(page);
      expectMenu(focusHolds, true, "pointer gone, focus on the summary", "summary");
      // From the keyboard: Escape closes it; Enter opens it; Enter on a link closes it and focus lands on the summary with a visible ring.
      await page.focus(S);
      await page.keyboard.press("Escape");
      expectMenu(await waMenu(page), false, "Escape on the summary", "summary");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      const [kbPopup] = await Promise.all([page.waitForEvent("popup"), page.keyboard.press("Enter")]);
      await page.waitForTimeout(50);
      const kb = await waMenu(page);
      await kbPopup.close();
      expectMenu(kb, false, "Enter on Telegram", "summary", true);
      log.push(`each of the 7 links: the browser action goes ahead (${chosen.filter((c) => c.popup).length} new tabs to exactly their href, mailto not cancelled), the list closes, focus on the summary (ring only from the keyboard); no reopen until the pointer leaves`);
      // Copy: the status shows once and stays visible after the list closes (it's outside the <details>).
      await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } }));
      await waWatchShareStatus(page);
      await page.click(S);
      await page.click("#shareCopy");
      await page.waitForTimeout(WA_COPY_CLOSE / 2);
      const copyOpen = await waMenu(page);
      await page.waitForTimeout(WA_COPY_CLOSE / 2 + 300);
      const copyClosed = { ...(await waMenu(page)), ...(await page.evaluate(() => { const st = document.getElementById("shareToolStatus");
        return { text: st.textContent, visible: st.checkVisibility(), live: st.getAttribute("aria-live"), n: window.__shareStatusChanges, outside: !document.getElementById("shareMenu").contains(st) }; })) };
      const expectCopyFlow = (c) => {
        expect(c.text === t.copied && c.visible && c.live === "polite" && c.n === 1 && c.outside, `after Copy the status is "${c.text}" (visible ${c.visible}, ${c.n} updates, aria-live ${c.live})`);
        expectMenu(c, false, "1.5 s after Copy", "summary");
      };
      expectMenu(copyOpen, true, "0.6 s after Copy");
      expectCopyFlow(copyClosed);
      log.push(`Copy: "${copyClosed.text}" announced once and still visible; the list stays ${WA_COPY_CLOSE / 1000} s then closes, focus on the summary`);
      // A touch screen (hover: none, coarse pointer, no navigator.share so the list is used): no hover behaviour; tap
      // toggles; tapping a service closes the list.
      const touch = await waShareContext(page.context().browser(), lang, { hasTouch: true, viewport: { width: 390, height: 800 } },
        () => { Object.defineProperty(navigator, "share", { configurable: true, value: undefined }); });
      await touch.page.mouse.move(0, 0);
      await waMouseTo(touch.page, S);
      await touch.page.waitForTimeout(WA_HOVER_OPEN * 3);
      const tHover = await waMenu(touch.page);
      await touch.page.tap(S);
      const tOpen = await waMenu(touch.page);
      await touch.page.tap(S);
      const tClosed = await waMenu(touch.page);
      await touch.page.tap(S);
      const [tPopup] = await Promise.all([touch.page.waitForEvent("popup"), touch.page.tap('#shareList a[data-share="telegram"]')]);
      await touch.page.waitForTimeout(50);
      const tChosen = await waMenu(touch.page);
      await tPopup.close();
      const tMedia = await touch.page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
      await touch.context.close();
      expect(!tMedia, "the touch context matches (hover: hover) and (pointer: fine)");
      const expectTouch = (h, o, c, ch) => {
        expectMenu(h, false, "touch screen, mouse over the summary");
        expectMenu(o, true, "first tap");
        expectMenu(c, false, "second tap");
        expectMenu(ch, false, "tapping Telegram", "summary");
      };
      expectTouch(tHover, tOpen, tClosed, tChosen);
      expect(!touch.errors.length, `errors on the touch screen: ${touch.errors.join("; ")}`);
      log.push("touch screen: no hover opening, tap toggles, tapping a service closes the list");
      return log.join("; ") + "; " +
        [mustFail("opened before the delay", () => expectMenu({ ...early, open: true }, false, "test")),
          mustFail("not opened after the delay", () => expectMenu({ ...opened, open: false }, true, "test")),
          mustFail("a brief pass that opens it", () => expectMenu({ ...brief, open: true }, false, "test")),
          mustFail("closed while focus is inside", () => expectMenu({ ...focusKept, open: false }, true, "test")),
          mustFail("a click that closes a hover-opened list", () => expectMenu({ ...pinned, open: false }, true, "test")),
          mustFail("focus lost after Escape", () => expectMenu({ ...esc2, focus: "BODY" }, false, "test", "summary", true)),
          mustFail("Escape on a hover-opened list that steals focus", () => expectMenu({ ...transientEsc, focus: "summary" }, false, "test", "TEXTAREA")),
          mustFail("a choice that leaves the list open", () => expectChosen({ ...chosen[2], after: { ...chosen[2].after, open: true } })),
          mustFail("a cancelled click", () => expectChosen({ ...chosen[6], after: { ...chosen[6].after, prevented: true } })),
          mustFail("a ring after a mouse choice", () => expectChosen({ ...chosen[0], after: { ...chosen[0].after, ring: true } })),
          mustFail("a reopen under the pointer", () => expectChosen({ ...chosen[5], stayed: { ...chosen[5].stayed, open: true } })),
          mustFail("a navigation to another address", () => expectChosen({ ...chosen[4], after: { ...chosen[4].after, hit: ["https://www.linkedin.com/feed/"] } })),
          mustFail("the copy status hidden by closing", () => expectCopyFlow({ ...copyClosed, visible: false })),
          mustFail("the copy status announced twice", () => expectCopyFlow({ ...copyClosed, n: 2 })),
          mustFail("hover opening on a touch screen", () => expectTouch({ ...tHover, open: true }, tOpen, tClosed, tChosen)),
          mustFail("a tap that leaves the list open after a service", () => expectTouch(tHover, tOpen, tClosed, { ...tChosen, open: true }))].join("; ");
    },
  },
  {
    name: "WhatsApp link generator (share this tool, Web Share API)",
    page: WA,
    vendor: [LIBPHONE, QRJS],
    async run(page, lang) {
      const t = WA_SHARE[lang], browser = page.context().browser();
      // The share script is one block, byte-identical on the EN and ES pages.
      const block = async (path) => { const html = await readFile(`${REPO_ROOT}${path}index.html`, "utf-8"); const a = html.indexOf("// Share this tool: start"), b = html.indexOf("// Share this tool: end");
        return a > 0 && b > a ? html.slice(a, b) : ""; };
      const blocks = [await block(WA.slice(1)), await block("es" + WA)];
      const expectSameBlock = ([en, es]) => expect(en && en === es, "the \"Share this tool\" script block is missing or differs between the EN and ES pages");
      expectSameBlock(blocks);
      // Every undocumented share address has a complete record (status, lastVerified, result, testedUrl).
      const records = waShareRecords(blocks[0]);
      expectShareRecords(records);
      const drop = (name, key) => ({ ...records, [name]: Object.fromEntries(Object.entries(records[name]).filter(([k]) => k !== key)) });
      const data = { title: t.title, text: t.title, url: t.url };
      // A touch device with navigator.share: one real button with the same name, the row hidden.
      const touch = await waShareContext(browser, lang, { hasTouch: true, viewport: { width: 390, height: 800 } }, WA_SHARE_STUB);
      const tp = touch.page;
      const st = await waShareState(tp);
      const expectNative = (st) => expect(!st.menuShown && st.nativeShown && st.nativeName === t.toggle && st.nativeType === "button", `on a touch device: row shown ${st.menuShown}, button shown ${st.nativeShown} named "${st.nativeName}"`);
      expectNative(st);
      expectShareControl(st, lang);
      expect(await tp.evaluate(() => [...document.querySelectorAll(".share-tool")].length === 1), "more than one share block");
      // The tool's number and message are never part of the shared data.
      await waCountry(tp, "GB");
      await waNumber(tp, "07400 123456");
      await tp.fill("#messageInput", `${WA_SECRET.words.join(" ")} 🙌`);
      const quiet = (st) => expect(st.status === "" && st.actionError === "" && st.nativeShown && !st.menuShown && st.focus === "native",
        `after the share sheet: status "${st.status}", error "${st.actionError}", button shown ${st.nativeShown}, focus on ${st.focus}`);
      await tp.click("#shareNative");
      await tp.waitForFunction(() => window.__shareCalls.length === 1 && document.activeElement.id === "shareNative");
      const resolved = await waShareState(tp);
      quiet(resolved);
      const calls = await tp.evaluate(() => window.__shareCalls);
      const expectData = (got) => expect(JSON.stringify(got) === JSON.stringify(data), `navigator.share got ${JSON.stringify(got)}, not ${JSON.stringify(data)}`);
      expectData(calls[0]);
      expectNoSecret([JSON.stringify(calls[0])], "the navigator.share data");
      // Cancelled (AbortError): no message, the button stays.
      await tp.evaluate(() => { window.__shareMode = "abort"; });
      await tp.click("#shareNative");
      await tp.waitForFunction(() => window.__shareCalls.length === 2);
      await tp.waitForTimeout(150);
      const aborted = await waShareState(tp);
      quiet(aborted);
      // Any other error: the row of links instead, open, focus on its summary.
      await tp.evaluate(() => { window.__shareMode = "fail"; });
      await tp.click("#shareNative");
      await tp.waitForFunction(() => window.__shareCalls.length === 3);
      await tp.waitForTimeout(150);
      const fellBack = await waShareState(tp);
      const expectFallback = (st) => expect(st.menuShown && st.open && !st.nativeShown && st.focus === "summary" && st.status === "" && st.actionError === "",
        `after a failed share: row shown ${st.menuShown}, open ${st.open}, button shown ${st.nativeShown}, focus on ${st.focus}, status "${st.status}"`);
      expectFallback(fellBack);
      expectShareLinks(fellBack, lang);
      const touchOutside = [...touch.outside];
      await touch.context.close();
      // A desktop with navigator.share still gets the row; so does a touch device where canShare says no, or without navigator.share.
      const desk = await waShareContext(browser, lang, {}, WA_SHARE_STUB);
      const deskSt = await waShareState(desk.page);
      await desk.context.close();
      const refused = await waShareContext(browser, lang, { hasTouch: true }, () => {
        Object.defineProperty(navigator, "share", { configurable: true, value: async () => {} });
        Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
      });
      const refusedSt = await waShareState(refused.page);
      await refused.context.close();
      const bare = await waShareContext(browser, lang, { hasTouch: true }, () => { Object.defineProperty(navigator, "share", { configurable: true, value: undefined }); });
      const bareSt = await waShareState(bare.page);
      await bare.context.close();
      const expectRow = (st, when) => expect(st.menuShown && !st.nativeShown, `${when}: row shown ${st.menuShown}, button shown ${st.nativeShown}`);
      expectRow(deskSt, "desktop with navigator.share");
      expectRow(refusedSt, "touch device where canShare says no");
      expectRow(bareSt, "touch device without navigator.share");
      expectOutsideRequests(touchOutside, "while sharing");
      const errs = [touch, desk, refused, bare].flatMap((x) => x.errors);
      expect(!errs.length, `errors: ${errs.join("; ")}`);
      return `the share script identical on EN and ES, a complete record for each undocumented address (Facebook, LinkedIn, Reddit); touch: one button "${t.toggle}" (row hidden), shared ${JSON.stringify(data)} with no number or message, focus back on the button; cancel: no message, button kept; ` +
        `other error: the row instead, open, focus on its summary; desktop with navigator.share, canShare false and no navigator.share: the row; ` +
        [mustFail("EN and ES share scripts that differ", () => expectSameBlock([blocks[0], blocks[1] + " "])),
          mustFail("a record without lastVerified", () => expectShareRecords(drop("reddit", "lastVerified"))),
          mustFail("a record without testedUrl", () => expectShareRecords(drop("facebook", "testedUrl"))),
          mustFail("a record without status", () => expectShareRecords(drop("linkedin", "status"))),
          mustFail("a record with an empty result", () => expectShareRecords({ ...records, facebook: { ...records.facebook, result: " " } })),
          mustFail("an undocumented endpoint with no record", () => expectShareRecords(Object.fromEntries(Object.entries(records).filter(([k]) => k !== "reddit")))),
          mustFail("a future date", () => expectShareRecords({ ...records, facebook: { ...records.facebook, lastVerified: "2999-01-01" } })),
          mustFail("the row on a touch device", () => expectNative({ ...st, menuShown: true })),
          mustFail("an error shown on cancel", () => quiet({ ...aborted, actionError: "The link couldn't be shared." })),
          mustFail("the button gone on cancel", () => quiet({ ...aborted, nativeShown: false })),
          mustFail("focus lost after the sheet", () => quiet({ ...resolved, focus: "BODY" })),
          mustFail("no fallback after an error", () => expectFallback({ ...fellBack, menuShown: false, nativeShown: true })),
          mustFail("the fallback closed", () => expectFallback({ ...fellBack, open: false })),
          mustFail("the generated link shared", () => expectData({ ...data, url: "https://wa.me/" + WA_SECRET.digits })),
          mustFail("the native button on a desktop", () => expectRow({ ...deskSt, menuShown: false, nativeShown: true }, "test"))].join("; ");
    },
  },
  {
    name: "WhatsApp link generator (formatting toolbar)",
    page: WA,
    vendor: [LIBPHONE, QRJS],
    async run(page, lang) {
      const f = WA_FMT[lang];
      await waCountry(page, "GB");
      await waNumber(page, "07400 123456");
      // Wrap: the selection, outer spaces kept outside; one native input event; focus stays; preview and link follow.
      let got = await waFormat(page, "bold", "hello world ", 6, 12);
      expectValue(got, "hello *world* ", "bold on a selection");
      expectOneInput(got, "bold (execCommand path)");
      expect(got.focus === "messageInput" && JSON.stringify(got.sel) === "[7,12]", `focus ${got.focus}, selection ${got.sel}`);
      expect(got.strong.join() === "world" && got.link === "https://wa.me/447400123456?text=" + encodeURIComponent("hello *world* "), `preview ${got.strong}, link ${got.link}`);
      const wrapped = got;
      await page.click('.fmt-btn[data-format="bold"]');
      expectValue(await waMsgState(page), "hello world ", "bold again removes it");
      got = await waFormat(page, "strike", "hi ", 3, 3);
      expectValue(got, "hi ~~", "no selection inserts a pair");
      expect(JSON.stringify(got.sel) === "[4,4]", `the cursor is at ${got.sel}, not between the markers`);
      got = await waFormat(page, "mono", "x ", 2, 2);
      expectValue(got, "x ``````", "monospace pair");
      expect(JSON.stringify(got.sel) === "[5,5]", `the cursor is at ${got.sel} after the monospace pair`);
      expectValue(await waFormat(page, "italic", "a *bold* b", 0, 10), "_a *bold* b_", "nesting");
      got = await waFormat(page, "italic", "a *bold* b", 0, 5);
      expectValue(got, "a *bold* b", "crossing markers refused");
      expect(got.status.startsWith(f.cross), `no hint for crossing markers: "${got.status}"`);
      got = await waFormat(page, "mono", "a *bold* b", 0, 10);
      expect(got.value === "a *bold* b" && got.status.startsWith(f.mono), `monospace around bold: ${got.value} "${got.status}"`);
      expectValue(await waFormat(page, "bold", "x ```code``` y", 0, 14), "x ```code``` y", "bold around monospace refused");
      expectValue(await waFormat(page, "bold", "one\n\n two \nthree", 0, 16), "*one*\n\n *two* \n*three*", "multi-line bold, line by line");
      expectValue(await waFormat(page, "strike", "*one*\n\n *two* \n*three*", 0, 22), "~*one*~\n\n ~*two*~ \n~*three*~", "multi-line strikethrough around bold lines");
      expectValue(await waFormat(page, "mono", "one\ntwo", 0, 7), "```one\ntwo```", "monospace across lines");
      got = await waFormat(page, "bold", "abcdefghi", 3, 6);
      expectValue(got, "abc*def*ghi", "markers inside a word are allowed");
      const edges = await page.evaluate(() => WORD_EDGES_ONLY);
      expect(got.strong.length === (edges ? 0 : 1), `the preview shows ${got.strong.length} bold runs for abc*def*ghi with WORD_EDGES_ONLY ${edges}`);
      const zwj = await page.evaluate(() => String.fromCodePoint(0x1F469, 0x200D, 0x1F4BB));
      expectValue(await waFormat(page, "bold", "a" + zwj + "b", 3, 3), "a" + zwj + "**b", "a cursor inside a joined emoji moves to its end");
      // Ctrl and Command shortcuts, only in the message.
      for (const key of ["Control+b", "Meta+b", "Control+i", "Meta+i"]) {
        await waSelect(page, "hello world", 0, 5);
        await page.keyboard.press(key);
        const want = key.endsWith("b") ? "*hello* world" : "_hello_ world";
        expectValue(await waMsgState(page), want, key);
      }
      await page.focus("#phoneInput");
      const phoneBefore = await page.inputValue("#phoneInput");
      const prevented = await page.evaluate(() => { const ev = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true }); document.getElementById("phoneInput").dispatchEvent(ev); return ev.defaultPrevented; });
      expect(!prevented && (await page.inputValue("#phoneInput")) === phoneBefore, "Ctrl+B is handled outside the message field");
      // Native undo and redo: one step per change.
      await page.fill("#messageInput", "");
      await page.click("#messageInput");
      await page.keyboard.type("hello world");
      await page.evaluate(() => document.getElementById("messageInput").setSelectionRange(6, 11));
      await page.click('.fmt-btn[data-format="bold"]');
      await page.keyboard.press("Control+z");
      const undone = (await waMsgState(page)).value;
      await page.keyboard.press("Control+y");
      const redone = (await waMsgState(page)).value;
      expect(undone === "hello world" && redone === "hello *world*", `undo gave ${JSON.stringify(undone)}, redo ${JSON.stringify(redone)}`);
      // The fallback when execCommand is refused: same edit, exactly one input event.
      await page.evaluate(() => { window.__execCommand = document.execCommand; document.execCommand = () => false; });
      got = await waFormat(page, "italic", "hello world", 0, 5);
      await page.evaluate(() => { document.execCommand = window.__execCommand; });
      expectValue(got, "_hello_ world", "fallback path");
      expectOneInput(got, "fallback path");
      expect(got.link.endsWith(encodeURIComponent("_hello_ world")), "the fallback didn't update the link");
      return `wrap with outer spaces kept, remove, pair at the cursor, nesting, crossing and monospace refused with a hint, line by line, monospace across lines, ` +
        `mid-word allowed (WORD_EDGES_ONLY ${edges}), joined emoji kept whole; Ctrl/Meta+B and +I only in the message; undo/redo one step; ` +
        `exactly 1 input event on the execCommand path and on the fallback path; ` +
        [mustFail("a different wrap", () => expectValue(wrapped, "hello *world *", "bold")),
          mustFail("two input events", () => expectOneInput({ ...wrapped, inputs: 2 }, "bold")),
          mustFail("no input event", () => expectOneInput({ ...got, inputs: 0 }, "fallback"))].join("; ");
    },
  },
  {
    name: "WhatsApp link generator (emoji picker)",
    page: WA,
    vendor: [LIBPHONE, QRJS],
    async run(page, lang) {
      const f = WA_FMT[lang];
      const data = await page.evaluate(WA_EMOJI_DATA);
      expectEmojiData(data);
      const [enHtml, esHtml] = await Promise.all(["whatsapp-link-generator/index.html", "es/whatsapp-link-generator/index.html"].map((x) => readFile(`${REPO_ROOT}/${x}`, "utf-8")));
      expectSameEmojiData(enHtml, esHtml);
      const labels = await page.evaluate(() => {
        const key = document.documentElement.lang === "es" ? "name_es" : "name_en";
        const btns = [...document.querySelectorAll(".emoji-btn")], tabs = [...document.querySelectorAll(".emoji-tab")];
        return { buttons: btns.length, wrong: btns.filter((b, i) => b.getAttribute("aria-label") !== EMOJI[i][key] || b.textContent !== EMOJI[i].emoji).length,
          tabs: tabs.map((t) => t.getAttribute("aria-label")), tabsOk: tabs.every((t, i) => t.getAttribute("aria-label") === EMOJI_CATEGORIES[i][key] && t.getAttribute("role") === "tab") };
      });
      expect(labels.buttons === 118 && !labels.wrong && labels.tabsOk, `${labels.buttons} emoji buttons, ${labels.wrong} with the wrong name, tabs ${labels.tabs.join(", ")}`);
      await page.fill("#messageInput", "Hi there");
      await waSelect(page, "Hi there", 2, 2);
      await page.click("#emojiBtn");
      const opened = await page.evaluate(() => ({ expanded: document.getElementById("emojiBtn").getAttribute("aria-expanded"), focus: document.activeElement.getAttribute("aria-label"),
        tabbable: [...document.querySelectorAll("#emojiPicker .emoji-grid button")].filter((b) => b.tabIndex === 0 && b.offsetParent).length }));
      expect(opened.expanded === "true" && opened.focus === f.firstEmoji && opened.tabbable === 1, `open: expanded ${opened.expanded}, focus "${opened.focus}", ${opened.tabbable} emoji in the Tab order`);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      let got = await waMsgState(page);
      expect(got.value === "Hi😄 there" && got.focus === "messageInput" && got.sel[0] === 4, `Enter inserted: ${JSON.stringify(got.value)}, focus ${got.focus}, cursor ${got.sel}`);
      expectOneInput(got, "emoji insert");
      // Tab stops from the message field to the grid: the selected tab, then the remembered emoji.
      const stops = [];
      for (;;) {
        await page.keyboard.press("Tab");
        const s = await page.evaluate(() => { const a = document.activeElement; return { role: a.getAttribute("role"), cls: a.className, selected: a.getAttribute("aria-selected") === "true", label: a.getAttribute("aria-label") }; });
        stops.push(s);
        if (s.cls === "emoji-btn" || stops.length > 6) break;
      }
      expectTabStops(stops, lang);
      expect(stops[1].label === (lang === "en" ? "grinning face with smiling eyes" : "cara sonriendo con ojos sonrientes"), `the grid didn't remember the last emoji (${stops[1].label})`);
      await page.keyboard.down("Shift"); await page.keyboard.press("Tab"); await page.keyboard.up("Shift");
      await page.keyboard.press("ArrowRight");
      const tab = await page.evaluate(() => ({ label: document.activeElement.getAttribute("aria-label"), selected: document.activeElement.getAttribute("aria-selected"),
        panels: [...document.querySelectorAll(".emoji-panel")].filter((p) => !p.hidden).map((p) => p.id) }));
      expect(tab.label === f.gestures && tab.selected === "true" && tab.panels.join() === "emojiPanel-gestures", `ArrowRight on the tabs: ${JSON.stringify(tab)}`);
      await page.keyboard.press("End");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Control+End");
      expect((await page.evaluate(() => document.activeElement.getAttribute("aria-label"))) === f.luggage, "Ctrl+End didn't reach the last emoji");
      await page.keyboard.press("Escape");
      expect((await page.evaluate(() => [document.activeElement.id, document.getElementById("emojiPicker").hidden].join())) === "emojiBtn,true", "Escape didn't close the picker and return focus to its button");
      // Replace a selection, the variation selector included.
      await waSelect(page, "abc", 1, 2);
      await page.click("#emojiBtn");
      await page.click("#emojiTab-hearts");
      await page.click(`.emoji-btn[aria-label="${f.heart}"]`);
      got = await waMsgState(page);
      expect([...got.value].map((c) => c.codePointAt(0).toString(16)).join(" ") === "61 2764 fe0f 63", `the heart replaced the selection as ${JSON.stringify(got.value)}`);
      await page.click("#messageInput");
      const stillOpen = await page.evaluate(() => !document.getElementById("emojiPicker").hidden);
      await page.click("h1");
      const closedOutside = await page.evaluate(() => document.getElementById("emojiPicker").hidden);
      expect(stillOpen && closedOutside, `a click in the message closed it (${!stillOpen}) or one outside didn't (${!closedOutside})`);
      // Layout: in the flow under the message, as wide as the field, 8 or 5 columns, 44px targets, no sideways scroll.
      const layouts = [];
      for (const width of [1280, 479, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await page.click("#emojiBtn");
        await page.click("#emojiTab-work");
        const l = await page.evaluate(() => {
          const p = document.getElementById("emojiPicker"), t = document.getElementById("messageInput"), r = p.getBoundingClientRect();
          const rects = [...p.querySelectorAll(".emoji-panel:not([hidden]) .emoji-btn, .emoji-tab, #emojiClose")].map((b) => b.getBoundingClientRect());
          return { cols: p.querySelector(".emoji-panel:not([hidden]) .emoji-row").children.length, width: Math.round(r.width), field: Math.round(t.getBoundingClientRect().width),
            below: r.top >= t.getBoundingClientRect().bottom, position: getComputedStyle(p).position, min: Math.min(...rects.map((x) => Math.min(x.width, x.height))),
            scrolls: getComputedStyle(p.querySelector(".emoji-panel:not([hidden]) .emoji-grid")).overflowY, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        layouts.push({ viewport: width, ...l });
        await page.click("#emojiBtn");
      }
      for (const l of layouts) {
        expect(l.cols === (l.viewport >= 480 ? 8 : 5), `${l.cols} columns at ${l.viewport}px`);
        expect(l.width === l.field && l.below && l.position === "relative" && l.min >= 44 && l.scrolls === "auto" && l.overflow <= 0, `picker layout: ${JSON.stringify(l)}`);
      }
      const badData = await page.evaluate((fn) => { EMOJI.push({ emoji: String.fromCodePoint(0x1F1EA, 0x1F1F8), category: "symbols", name_en: "flag", name_es: "bandera" }); const d = (0, eval)("(" + fn + ")")(); EMOJI.pop(); return d; }, WA_EMOJI_DATA.toString());
      return `118 emojis in 6 categories, one character each, no joiner, skin tone, flag or duplicate; EN and ES data blocks identical; localized names on every emoji and tab; ` +
        `opens on the first emoji, arrows and Enter insert at the cursor, focus back in the message, 1 input event; ` +
        `Tab stops from the message to the grid: ${stops.length} (${stops.map((s) => s.role || s.cls).join(", ")}); tabs with arrows and End, Ctrl+End, Escape returns focus; ` +
        `replaces a selection with ❤ + U+FE0F; ${layouts.map((l) => `${l.cols} columns at ${l.viewport}px (panel ${l.width}px, as wide as the field)`).join(", ")}, 44px targets, no sideways scroll; ` +
        [mustFail("a flag in the data", () => expectEmojiData(badData)),
          mustFail("EN and ES data that differ", () => expectSameEmojiData(enHtml, esHtml.replace("cara sonriente", "cara sonriendo"))),
          mustFail("a button between the message and the grid", () => expectTabStops([stops[0], { role: null, cls: "fmt-btn emoji-close", selected: false }, stops[1]], lang))].join("; ");
    },
  },
  {
    name: "WhatsApp guide (diagram)",
    page: WA_GUIDE,
    vendor: [],
    async run(page, lang) {
      const seen = [];
      let last;
      for (const width of [320, 375, 560, 639, 640, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(50);
        const svgs = await page.evaluate(WA_DIAGRAM);
        const snap = await page.locator("figure.wa-flow").ariaSnapshot();
        const imgs = (snap.match(/- img\b/g) || []).length;
        expectOneDiagram(svgs, imgs, width);
        expectNoOverflow(width === 320 ? await waOverflow(page) : 0, "guide diagram");
        seen.push(`${width}px ${svgs.find((s) => s.shown).cls.replace("wa-flow-", "")}`);
        last = { svgs, imgs, width };
      }
      const caption = await page.textContent("figure.wa-flow figcaption");
      expect(caption.includes("WhatsApp"), `caption: ${caption}`);
      return `exactly one diagram exposed (${seen.join(", ")}), same role="img" and aria-label, no sideways scroll at 320px; ` +
        [mustFail("both diagrams exposed", () => expectOneDiagram(last.svgs.map((s) => ({ ...s, shown: true, hidden: false })), 2, last.width)),
          mustFail("the wrong version at 320px", () => expectOneDiagram(last.svgs, last.imgs, 320))].join("; ");
    },
  },
];

async function runCase(browser, c, lang) {
  const context = await browser.newContext({ locale: lang === "es" ? "es-ES" : "en-US", acceptDownloads: true });
  const seen = { vendor: new Map(), requests: [], cdn: [], blocked: [], errors: [], warnings: [], workers: [] };
  let broken = c.broken ? c.broken(lang) : null;
  const stalled = [];
  let heldNow;
  const ctl = {
    requests: seen.requests,
    held: new Promise((resolve) => { heldNow = resolve; }),
    repair() {
      broken = null;
      for (const answer of stalled.splice(0)) answer();
    },
  };
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    seen.requests.push(url);
    if (url.startsWith(GOATCOUNTER)) return route.fulfill({ status: 204, body: "" });
    if (url.startsWith(SITE + "/")) {
      const path = new URL(url).pathname;
      if (broken && path === broken.path) {
        if (broken.mode === "404") {
          seen.vendor.set(path, 404);
          return route.fulfill({ status: 404, body: "not found", contentType: "text/plain" });
        }
        await new Promise((resolve) => { stalled.push(resolve); heldNow(); });
      }
      const res = await localFile(url);
      if (path.startsWith("/assets/vendor/")) seen.vendor.set(path, res.status);
      return route.fulfill(res).catch(() => {});
    }
    if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    if (Object.hasOwn(REMAINING_CDN, url)) {
      seen.cdn.push(url);
      return route.continue();
    }
    seen.blocked.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("worker", (w) => seen.workers.push(w.url()));
  page.on("pageerror", (e) => {
    const at = stackLocation(e.stack);
    seen.errors.push({ message: "page error: " + e.message, src: sourceOf(REPO_ROOT, at.url, at.line) });
  });
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const loc = m.location();
    // Playwright's console line numbers are 0-based.
    const src = sourceOf(REPO_ROOT, loc.url, loc.url ? loc.lineNumber + 1 : 0);
    if (m.type() === "warning") return seen.warnings.push(m.text() + where(src));
    // The browser's own line for the file a case answers with a 404 on purpose.
    if (c.broken && loc.url === SITE + c.broken(lang).path && /\b404\b/.test(m.text())) return;
    // A resource that failed to load is named, at the line of the page that asked for it.
    const named = !src && loc.url ? ` (${loc.url})` : "";
    seen.errors.push({ message: "console error: " + m.text() + named, src: named ? referenceIn(REPO_ROOT, SITE + path, loc.url) : src });
  });
  const path = (lang === "es" ? "/es" : "") + c.page;
  let detail, failure, src = sourceOf(REPO_ROOT, SITE + path);
  try {
    if (c.broken && c.broken(lang).mode === "stall") await page.clock.install();
    await page.goto(SITE + path, { waitUntil: "load", timeout: 60000 });
    detail = await c.run(page, lang, ctl);
    const vendor = typeof c.vendor === "function" ? c.vendor(lang) : c.vendor;
    for (const v of vendor)
      expect(seen.vendor.get(v) === 200, `${v} wasn't loaded from /assets/vendor (status ${seen.vendor.get(v)})`);
    if (vendor.includes(JSPDF)) {
      const version = await page.evaluate(() => window.jspdf?.jsPDF?.version);
      expectJspdfVersion(version);
      detail += `; jsPDF ${version}, ${mustFail("another jsPDF version", () => expectJspdfVersion("2.5.1"))}`;
    }
    if (vendor.includes(AUTOTABLE))
      expect(await page.evaluate(() => typeof window.jspdf.jsPDF.API.autoTable === "function"), "autotable didn't attach doc.autoTable to jsPDF");
    if (c.noJspdf) {
      const global = await page.evaluate(() => typeof window.jspdf);
      expectNoJspdf(seen.requests, global);
      detail += `; no jsPDF or autotable requested, ${mustFail("a jsPDF request", () => expectNoJspdf([...seen.requests, SITE + JSPDF], global))}`;
    }
    if (c.vendorOneOf) {
      const got = c.vendorOneOf.filter((v) => seen.vendor.has(v));
      expect(got.length === 1 && seen.vendor.get(got[0]) === 200,
        `expected exactly one of ${c.vendorOneOf.join(", ")} from /assets/vendor, got ${got.map((v) => `${v} (${seen.vendor.get(v)})`).join(", ") || "none"}`);
      detail += `; picked ${got[0].split("/").pop()}`;
    }
    // A real Web Worker started straight from the vendored file (not a blob: wrapper,
    // and not PDF.js's main-thread fallback, which starts no worker at all).
    if (c.worker) expect(seen.workers.includes(SITE + c.worker), `no worker started from ${c.worker} (workers: ${seen.workers.join(", ") || "none"})`);
    if (c.blobWorker) expect(seen.workers.some((u) => u.startsWith(`blob:${SITE}/`)), `no blob: worker started on ${SITE} (workers: ${seen.workers.join(", ") || "none"})`);
    if (seen.blocked.length) src = referenceIn(REPO_ROOT, SITE + path, seen.blocked[0]);
    expect(!seen.blocked.length, `requests to outside hosts: ${seen.blocked.join(", ")}`);
    if (seen.errors.length) src = seen.errors.find((e) => e.src?.line)?.src || src;
    expect(!seen.errors.length, seen.errors.map((e) => e.message + where(e.src)).join("; "));
  } catch (e) {
    failure = e.message.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(0, 6).join("\n        ");
    // When the operation itself failed (a timeout, say), name what the page saw too:
    // its errors, vendor files that didn't load and blocked requests.
    const seenToo = [
      ...seen.errors.map((x) => x.message + where(x.src)),
      ...[...seen.vendor].filter(([p, status]) => status !== 200 && p !== c.broken?.(lang).path).map(([p, status]) => `${p} answered ${status}`),
      ...(seen.blocked.length ? [`requests to outside hosts: ${seen.blocked.join(", ")}`] : []),
    ].filter((x) => !failure.includes(x));
    if (seenToo.length) failure += "\n        also seen: " + seenToo.join("; ");
    if (seen.errors.length) src = seen.errors.find((x) => x.src?.line)?.src || src;
  }
  await context.close();
  return { path, detail, failure, src, warnings: seen.warnings, cdn: [...new Set(seen.cdn)] };
}

const only = process.argv.slice(2);
const cases = only.length ? CASES.filter((c) => only.includes(c.name)) : CASES;
if (!cases.length) {
  console.error(`No such case. Cases: ${CASES.map((c) => c.name).join(", ")}`);
  process.exit(2);
}
const browser = await chromium.launch();
const t0 = Date.now();
let failed = 0, cdnPages = 0;
const rows = [], flaky = [], warned = [];
for (const c of cases) {
  for (const lang of ["en", "es"]) {
    const start = Date.now();
    let r = await runCase(browser, c, lang);
    const first = r.failure;
    if (first) {
      console.log(`  RETRY ${c.name} on ${r.path}: ${first}`);
      r = await runCase(browser, c, lang);
    }
    const took = ((Date.now() - start) / 1000).toFixed(1);
    failed += !!r.failure;
    cdnPages += r.cdn.length > 0;
    if (r.failure) {
      console.log(`  FAIL  ${c.name} on ${r.path} (failed twice): ${r.failure}`);
      annotate("error", `Smoke test failed twice: ${c.name} on ${r.path}`, r.failure, r.src);
    } else if (first) {
      flaky.push({ name: c.name, path: r.path, first });
      console.log(`  FLAKY ${c.name} on ${r.path}: passed on the retry after failing with: ${first}`);
      annotate("warning", `Flaky smoke test: ${c.name} on ${r.path}`, `Passed on the retry. First run failed with: ${first}`, r.src);
    } else console.log(`  PASS  ${c.name} on ${r.path}: ${r.detail}`);
    for (const w of r.warnings) console.log(`        WARN console warning (doesn't fail the case): ${w}`);
    if (r.warnings.length) warned.push({ name: c.name, path: r.path, warnings: r.warnings });
    for (const u of r.cdn) console.log(`        still from a CDN (allowed for now in REMAINING_CDN): ${u}`);
    rows.push(`| ${cell(c.name)} | ${r.path} | ${r.failure ? "**failed twice**" : first ? "flaky (passed on the retry)" : "pass"} | ${took} s | ${cell((r.failure || first || "").slice(0, 400))} |`);
  }
}
await browser.close();
const seconds = ((Date.now() - t0) / 1000).toFixed(0);
summary([
  `### Smoke tests: ${cases.length * 2} pages in ${seconds} s, ${failed} failed, ${flaky.length} flaky`,
  "",
  "| Case | Page | Result | Time | Failure |",
  "|---|---|---|---|---|",
  ...rows,
  ...(flaky.length ? ["", "**Flaky (failed once, passed on the retry):**", "", ...flaky.map((f) => `- ${cell(f.name)} on ${f.path}: ${cell(f.first.slice(0, 300))}`)] : []),
  ...(warned.length ? ["", "**Console warnings (listed, don't fail the run):**", "", ...warned.flatMap((x) => x.warnings.map((w) => `- ${cell(x.name)} on ${x.path}: ${cell(w.slice(0, 300))}`))] : []),
].join("\n"));
console.log(failed ? `${failed} case(s) failed.`
  : `All vendor smoke tests passed (${cases.length * 2} pages in ${seconds} s; ${flaky.length} flaky; ${cdnPages} still load a library from a CDN that hasn't moved yet).`);
process.exit(failed ? 1 : 0);
