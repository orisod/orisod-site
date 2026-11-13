// Unit tests for the download file name helper, orisodFileName() and orisodZipName().
//
// Run: node --test "scripts/tests/*.test.mjs"   (CI: the "smoke" job of check-smoke, before the browser tests)
//
// They run the exact text the pages ship: the "Orisod file name" block is cut out of every page that carries
// it, every copy must equal assets/js/orisod-filename.js, and that text is evaluated here with no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const START = "// Orisod file name: start", END = "// Orisod file name: end";
const SOURCE = readFileSync(ROOT + "assets/js/orisod-filename.js", "utf-8").replace(/\r\n/g, "\n");
const SKIP = [".git", "node_modules", "assets", "scripts", "docs", "audit", "prototypes", ".claude", ".github"];

function pagesWithBlock(dir = "", out = []) {
  for (const entry of readdirSync(ROOT + dir)) {
    const rel = dir + entry;
    if (SKIP.includes(rel)) continue;
    if (statSync(ROOT + rel).isDirectory()) pagesWithBlock(rel + "/", out);
    else if (entry.endsWith(".html") && readFileSync(ROOT + rel, "utf-8").includes(START)) out.push(rel);
  }
  return out;
}
function cut(html) {
  html = html.replace(/\r\n/g, "\n");
  const s = html.indexOf(START), e = html.indexOf(END);
  assert.ok(s >= 0 && e > s, "no Orisod file name block");
  return html.slice(html.indexOf("\n", s) + 1, e);
}
const PAGES = pagesWithBlock();
const blocks = PAGES.map((p) => cut(readFileSync(ROOT + p, "utf-8")));
const load = () => new Function(`${blocks[0]}\nreturn { orisodFileName, orisodZipName };`)();
const { orisodFileName: name, orisodZipName: zipName } = load();
const pdf = (n, action = "signed", extra = {}) => name({ name: n, accept: ["pdf"], action, ext: "pdf", fallback: "document", ...extra });
const bytes = (s) => new TextEncoder().encode(s).length;
const FAMILY = "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}";

test("every page carries the source byte for byte", () => {
  assert.ok(PAGES.length >= 8, `only ${PAGES.length} pages carry the block`);
  for (const [i, b] of blocks.entries()) assert.equal(b, SOURCE, `${PAGES[i]}'s block differs from the source`);
});

test("the owner's example and the plain rule", () => {
  assert.equal(pdf("Contract-signed.pdf", "merged"), "Contract-signed-merged-orisod.pdf");
  assert.equal(pdf("Report.pdf"), "Report-signed-orisod.pdf");
  assert.equal(pdf("Report.pdf", "firmado"), "Report-firmado-orisod.pdf");
});

test("no action word (format converters)", () => {
  assert.equal(name({ name: "Budget.xlsx", accept: ["xlsx", "xls"], ext: "pdf" }), "Budget-orisod.pdf");
  assert.equal(name({ name: "Budget-orisod.pdf", accept: ["pdf"], ext: "pdf" }), "Budget-orisod.pdf");
});

test("idempotent: the output name fed back gives the same name", () => {
  for (const n of ["Contrato año 2026 ☕.PDF", "a.pdf", "  x  y.pdf", "x".repeat(300) + ".pdf", ".pdf", "CON.pdf", "con.backup.pdf", FAMILY + ".pdf"]) {
    const once = pdf(n, "firmado");
    assert.equal(pdf(once, "firmado"), once, `${n}: ${once} changed when fed back`);
  }
  assert.equal(pdf("Report-SIGNED-orisod.pdf"), "Report-signed-orisod.pdf");
  assert.equal(pdf("Report-signed-orisod-orisod.pdf"), "Report-signed-orisod.pdf");
});

test("actions from different tools stack under one suffix", () => {
  const signed = pdf("Contract.pdf", "signed");
  const rotated = pdf(signed, "rotated");
  assert.equal(rotated, "Contract-signed-rotated-orisod.pdf");
  assert.equal(pdf(rotated, "compressed"), "Contract-signed-rotated-compressed-orisod.pdf");
  assert.equal(pdf(rotated, "rotated"), rotated);
  assert.equal(name({ name: pdf("Foto.pdf", "girado"), accept: ["pdf"], action: "firmado", ext: "pdf" }), "Foto-girado-firmado-orisod.pdf");
});

test("double and uppercase extensions", () => {
  assert.equal(pdf("a.pdf.pdf"), "a-signed-orisod.pdf");
  assert.equal(pdf("a.PDF.Pdf"), "a-signed-orisod.pdf");
  assert.equal(pdf("report.v2.pdf"), "report.v2-signed-orisod.pdf");
  assert.equal(name({ name: "photo.png.JPEG", accept: ["jpg", "jpeg", "png"], action: "cropped", ext: "JPG" }), "photo-cropped-orisod.jpg");
  assert.equal(name({ name: "scan.webp", accept: ["jpg"], action: "cropped", ext: ".jpg" }), "scan.webp-cropped-orisod.jpg");
});

test("empty names, leading dots and names with no extension", () => {
  assert.equal(pdf(""), "document-signed-orisod.pdf");
  assert.equal(pdf(".pdf"), "document-signed-orisod.pdf");
  assert.equal(pdf("...pdf"), "document-signed-orisod.pdf");
  assert.equal(pdf(" - .pdf"), "document-signed-orisod.pdf");
  assert.equal(pdf("-orisod.pdf"), "document-signed-orisod.pdf");
  assert.equal(pdf(".hidden.pdf"), "hidden-signed-orisod.pdf");
  assert.equal(pdf("notes"), "notes-signed-orisod.pdf");
  assert.equal(name({ name: "", ext: "png" }), "file-orisod.png");
  assert.equal(name({ name: undefined, accept: ["jpg"], action: "recortada", ext: "jpg", fallback: "imagen" }), "imagen-recortada-orisod.jpg");
});

test("accents, spaces, emoji and capitals stay", () => {
  assert.equal(pdf("Contrato año 2026 ☕.PDF", "firmado"), "Contrato año 2026 ☕-firmado-orisod.pdf");
  assert.equal(pdf("Ünïcödé Ñ.pdf"), "Ünïcödé Ñ-signed-orisod.pdf");
  assert.equal(pdf("Cafe\u0301 menu.pdf"), "Caf\u00e9 menu-signed-orisod.pdf", "NFD is joined into NFC");
  assert.equal(pdf("My   big\tfile.pdf"), "My big-file-signed-orisod.pdf");
  assert.equal(pdf(FAMILY + " family.pdf"), FAMILY + " family-signed-orisod.pdf");
});

test("illegal, control and bidi characters become hyphens", () => {
  assert.equal(pdf('a<b>c:d"e/f\\g|h?i*j.pdf'), "a-b-c-d-e-f-g-h-i-j-signed-orisod.pdf");
  assert.equal(pdf("a\u0000b\u001fc\u007fd\u0085e.pdf"), "a-b-c-d-e-signed-orisod.pdf");
  assert.equal(pdf("evil\u202Efdp.exe.pdf"), "evil-fdp.exe-signed-orisod.pdf");
  for (const c of ["\u061c", "\u200e", "\u200f", "\u202a", "\u202e", "\u2066", "\u2069"]) assert.equal(pdf(`x${c}y.pdf`), "x-y-signed-orisod.pdf");
  assert.equal(pdf("a -- b.pdf"), "a - b-signed-orisod.pdf");
  assert.equal(pdf("*?.pdf"), "document-signed-orisod.pdf");
});

test("Windows reserved names", () => {
  assert.equal(pdf("CON.pdf"), "CON-signed-orisod.pdf");
  assert.equal(pdf("con.backup.pdf"), "con-backup-signed-orisod.pdf");
  assert.equal(pdf("LPT9.old.pdf"), "LPT9-old-signed-orisod.pdf");
  assert.equal(pdf("CONTRACT.v1.pdf"), "CONTRACT.v1-signed-orisod.pdf");
  assert.equal(name({ name: "NUL.txt", accept: ["pdf"], ext: "pdf" }), "NUL-txt-orisod.pdf");
});

test("the name is cut to 120 UTF-8 bytes between whole characters", () => {
  assert.equal(pdf("x".repeat(300) + ".pdf"), "x".repeat(120) + "-signed-orisod.pdf");
  assert.equal(pdf("é".repeat(100) + ".pdf"), "é".repeat(60) + "-signed-orisod.pdf");
  const out = pdf("a" + FAMILY.repeat(10) + ".pdf");
  const base = out.slice(0, -"-signed-orisod.pdf".length);
  assert.ok(bytes(base) <= 120, `${bytes(base)} bytes`);
  assert.equal(base, "a" + FAMILY.repeat(Math.floor(119 / bytes(FAMILY))), "an emoji sequence was split");
  assert.equal(pdf("x".repeat(119) + " y.pdf"), "x".repeat(119) + "-signed-orisod.pdf", "a cut leaves no trailing space");
  assert.equal(pdf("Report-signed".padStart(200, "x") + ".pdf"), "x".repeat(120) + "-signed-orisod.pdf", "the action survives the cut once");
  for (const n of ["x".repeat(500), "ñ".repeat(500), "☕".repeat(500), FAMILY.repeat(100)]) assert.ok(bytes(pdf(n + ".pdf", "paginas-eliminadas")) < 200);
});

test("the code point fallback when Intl.Segmenter is missing", () => {
  const Segmenter = Intl.Segmenter;
  try {
    delete Intl.Segmenter;
    const { orisodFileName } = load();
    assert.equal(orisodFileName({ name: "☕".repeat(50) + ".pdf", accept: ["pdf"], action: "signed", ext: "pdf" }), "☕".repeat(40) + "-signed-orisod.pdf");
  } finally {
    Intl.Segmenter = Segmenter;
  }
});

test("parts, zero-padded, and zip names", () => {
  assert.equal(name({ name: "Report.pdf", accept: ["pdf"], action: "page", part: 7, total: 12, ext: "pdf" }), "Report-page-07-orisod.pdf");
  assert.equal(name({ name: "Report.pdf", accept: ["pdf"], action: "pagina", part: 3, total: 120, ext: "jpg" }), "Report-pagina-003-orisod.jpg");
  assert.equal(name({ name: "Report.pdf", accept: ["pdf"], part: 2, ext: "png" }), "Report-02-orisod.png");
  // At least 2 digits, so a 3-page split sorts like a 12-page one.
  assert.equal(name({ name: "Report.pdf", accept: ["pdf"], action: "page", part: 1, total: 3, ext: "pdf" }), "Report-page-01-orisod.pdf");
  assert.equal(name({ name: "Report.pdf", accept: ["pdf"], action: "page", part: 10, total: 12, ext: "pdf" }), "Report-page-10-orisod.pdf");
  assert.equal(zipName({ name: "Report.PDF", accept: ["pdf"], action: "split" }), "Report-split-orisod.zip");
  assert.equal(zipName({ name: "", action: "imagenes", fallback: "documento" }), "documento-imagenes-orisod.zip");
});
