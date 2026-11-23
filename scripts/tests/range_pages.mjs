// Cuts Delete PDF Pages', PDF to JPG's, Split PDF's and Rotate PDF's range code out of their pages (EN or ES), with the shared page range
// block it calls, so the tests run exactly the text the pages ship. Not a test file itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const read = (rel) => readFileSync(ROOT + rel, "utf-8").replace(/\r\n/g, "\n");

function cut(html, start) {
  const s = html.indexOf(start);
  assert.ok(s >= 0, `missing ${start}`);
  let depth = 0;
  for (let i = html.indexOf("{", s); i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) return html.slice(s, i + 1);
  }
  throw new Error("unbalanced " + start);
}
function between(html, from, lastFunction) {
  const a = html.indexOf(from);
  assert.ok(a >= 0, `missing ${from}`);
  const fn = cut(html, lastFunction);
  const b = html.indexOf(fn, a);
  assert.ok(b > a, `${lastFunction} isn't after ${from}`);
  return html.slice(a, b + fn.length);
}
function block(html) {
  const a = html.indexOf("// Orisod page ranges: start"), b = html.indexOf("// Orisod page ranges: end");
  assert.ok(a >= 0 && b > a, "missing the page range block");
  return html.slice(a, b);
}

// Source text defining run(input, total): Delete PDF Pages' parsePageRanges() ({ deleteSet, error }).
export function deleteSource(prefix) {
  const html = read(prefix + "delete-pdf-pages/index.html");
  return block(html) + between(html, "// Pages to delete, read by", "function parsePageRanges(") +
    "\nfunction run(input, total) { return parsePageRanges(input, total); }";
}
// Source text defining run(raw, lastPage): PDF to JPG's parseSelection() ({ pages, error }).
export function jpgSource(prefix) {
  const html = read(prefix + "pdf-to-jpg/index.html");
  return block(html) + between(html, "// Words for the helper's error codes", "function parseSelection(") +
    "\nfunction run(raw, lastPage) { return parseSelection(raw, lastPage); }";
}
// Source text defining run(raw, maxPage): Split PDF's parseRanges() ({ pages, error }).
export function splitSource(prefix) {
  const html = read(prefix + "split-pdf/index.html");
  return block(html) + between(html, "// Words for the helper's error codes", "function parseRanges(") +
    "\nfunction run(raw, maxPage) { return parseRanges(raw, maxPage); }";
}
// Source text defining run(raw, maxPage): Rotate PDF's parsePageSelection() ({ pages, error }).
export function rotateSource(prefix) {
  const html = read(prefix + "rotate-pdf/index.html");
  return block(html) + between(html, "// Words for the helper's error codes", "function parsePageSelection(") +
    "\nfunction run(raw, maxPage) { return parsePageSelection(raw, maxPage); }";
}
export const load = (src) => new Function(src + "\nreturn run;")();
