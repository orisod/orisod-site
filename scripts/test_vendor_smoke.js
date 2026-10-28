#!/usr/bin/env node
/**
 * Smoke-test the self-hosted libraries in assets/vendor: each one really works
 * on its tool page, in English and Spanish, with no outside script host.
 *
 * Local only (not in CI). Run it after adding or updating a library in
 * assets/vendor, or after changing how a page loads one:
 *
 *   node scripts/test_vendor_smoke.js [case name ...]
 *
 * How it works: a headless Chromium loads each tool page as https://orisod.com/...,
 * and every orisod.com request is answered from the local files, so root-absolute
 * /assets/vendor/ paths resolve exactly as on GitHub Pages. GoatCounter's counting
 * request is answered locally too, so nothing is counted. Every other request is
 * blocked and fails the case, except the CDN URLs still allowed in
 * scripts/check_vendor.py (REMAINING_CDN), which are let through and listed, so a
 * page that still needs a library that hasn't moved yet (like heic2any on HEIC
 * to JPG) can finish its job. Once REMAINING_CDN is empty,
 * every outside request fails.
 *
 * Each case runs one real operation with its library and checks the result, then
 * checks that the page fetched the case's vendor files from /assets/vendor (status
 * 200) and logged no errors. To cover a library moved in a later PR, add an entry
 * to CASES: the vendor files it needs, the page, and a run(page, lang) that does
 * the operation and throws if the result is wrong.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, inflateRawSync, inflateSync } from "node:zlib";
import { chromium } from "playwright";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SITE = "https://orisod.com";
const GOATCOUNTER = "https://orisod.goatcounter.com/count";
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm", ".gz": "application/gzip", ".pdf": "application/pdf",
};
const python = process.platform === "win32" ? "python" : "python3";
const REMAINING_CDN = JSON.parse(execFileSync(python, [join(REPO_ROOT, "scripts", "check_vendor.py"), "--allowlist"], { encoding: "utf-8" }));

async function localFile(url) {
  let path = decodeURIComponent(new URL(url).pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(REPO_ROOT, path));
  if (!file.startsWith(REPO_ROOT)) return { status: 403, body: "" };
  try {
    return { status: 200, body: await readFile(file), contentType: MIME[extname(file).toLowerCase()] || "application/octet-stream" };
  } catch {
    return { status: 404, body: await readFile(join(REPO_ROOT, "404.html")), contentType: MIME[".html"] };
  }
}

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
function fixturePdf(label, pages) {
  const objs = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((text, i) => {
    const content = `BT /F1 24 Tf 72 700 Td (${label} ${text}) Tj ET`;
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

// A minimal .xlsx written by hand (not by SheetJS): one sheet, "Fruit", with these rows.
function fixtureXlsx(rows) {
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
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Fruit" sheetId="1" r:id="rId1"/></sheets></workbook>',
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

// A JPEG drawn by the browser: white, with a black block over its left half.
async function fixtureJpeg(page, w, h) {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w / 2, h);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, [w, h]);
  return Buffer.from(b64, "base64");
}

function expect(ok, message) {
  if (!ok) throw new Error(message);
}

const PDFJS = "/assets/vendor/pdfjs/3.11.174/pdf.min.js";
const PDFJS_WORKER = "/assets/vendor/pdfjs/3.11.174/pdf.worker.min.js";
const JSPDF = "/assets/vendor/jspdf/2.5.1/jspdf.umd.min.js";
const JSZIP = "/assets/vendor/jszip/3.10.1/jszip.min.js";

// One entry per library (or library pair) that has moved to assets/vendor.
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
    vendor: ["/assets/vendor/xlsx/0.20.3/xlsx.full.min.js", JSPDF, "/assets/vendor/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js"],
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
];

async function runCase(browser, c, lang) {
  const context = await browser.newContext({ locale: lang === "es" ? "es-ES" : "en-US", acceptDownloads: true });
  const seen = { vendor: new Map(), cdn: [], blocked: [], errors: [], workers: [] };
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(GOATCOUNTER)) return route.fulfill({ status: 204, body: "" });
    if (url.startsWith(SITE + "/")) {
      const res = await localFile(url);
      const path = new URL(url).pathname;
      if (path.startsWith("/assets/vendor/")) seen.vendor.set(path, res.status);
      return route.fulfill(res);
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
  page.on("pageerror", (e) => seen.errors.push("page error: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") seen.errors.push("console error: " + m.text()); });
  const path = (lang === "es" ? "/es" : "") + c.page;
  let detail, failure;
  try {
    await page.goto(SITE + path, { waitUntil: "load", timeout: 60000 });
    detail = await c.run(page, lang);
    for (const v of c.vendor) expect(seen.vendor.get(v) === 200, `${v} wasn't loaded from /assets/vendor (status ${seen.vendor.get(v)})`);
    // A real Web Worker started straight from the vendored file (not a blob: wrapper,
    // and not PDF.js's main-thread fallback, which starts no worker at all).
    if (c.worker) expect(seen.workers.includes(SITE + c.worker), `no worker started from ${c.worker} (workers: ${seen.workers.join(", ") || "none"})`);
    expect(!seen.blocked.length, `requests to outside hosts: ${seen.blocked.join(", ")}`);
    expect(!seen.errors.length, seen.errors.join("; "));
  } catch (e) {
    failure = e.message.split("\n").slice(0, 6).join("\n        ");
  }
  await context.close();
  return { path, detail, failure, cdn: [...new Set(seen.cdn)] };
}

const only = process.argv.slice(2);
const cases = only.length ? CASES.filter((c) => only.includes(c.name)) : CASES;
if (!cases.length) {
  console.error(`No such case. Cases: ${CASES.map((c) => c.name).join(", ")}`);
  process.exit(2);
}
const browser = await chromium.launch();
let failed = 0, cdnPages = 0;
for (const c of cases) {
  for (const lang of ["en", "es"]) {
    const r = await runCase(browser, c, lang);
    failed += !!r.failure;
    cdnPages += r.cdn.length > 0;
    console.log(`  ${r.failure ? "FAIL" : "PASS"}  ${c.name} on ${r.path}: ${r.failure || r.detail}`);
    for (const u of r.cdn) console.log(`        still from a CDN (allowed for now in REMAINING_CDN): ${u}`);
  }
}
await browser.close();
console.log(failed ? `${failed} case(s) failed.`
  : `All vendor smoke tests passed (${cases.length * 2} pages; ${cdnPages} still load a library from a CDN that hasn't moved yet).`);
process.exit(failed ? 1 : 0);
