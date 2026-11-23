// Rotate PDF Pages (EN and ES) reads typed pages with the shared page range helper.
//
// Each test runs the page's own code (range_pages.mjs cuts parsePageSelection() out with the helper block) and
// compares it with what the Rotate button did before (old_range_parsers.mjs, frozen from main at 0d55855b).
// One angle is applied to every selected page, so only the set of pages matters: old results are compared sorted.
// - CHANGES lists every kind of input whose result changed, with the result before and after;
// - SAME lists inputs whose result didn't change (old messages compared with their straight quotes turned into
//   typographic ones, U+201C and U+201D), a blank field still means every page, and any input of plain page
//   numbers and ranges inside the document gives exactly the pages it gave before;
// - every error code shows its message in each language, the first problem wins (as before), and huge inputs
//   finish within TIME_LIMIT_MS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { oldRotateClick } from "./old_range_parsers.mjs";
import { rotateSource, load } from "./range_pages.mjs";

const ch = (...codes) => String.fromCharCode(...codes);
const LQ = ch(0x201C), RQ = ch(0x201D);
const fullWidth = (s) => s.replace(/[0-9-]/g, (c) => ch(c.charCodeAt(0) + 0xFEE0));
const EN_DASH = ch(0x2013);
const T = 10;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const ALL = range(1, T);
const TIME_LIMIT_MS = 1000;
// A result is pages (an array of numbers, possibly empty) or a message ([kind, token], "empty" or "tooMany").
const isPages = (r) => Array.isArray(r) && typeof r[0] !== "string";

const MESSAGES = {
  en: {
    range: (t) => `Invalid range: ${LQ}${t}${RQ}`, page: (t) => `Invalid page number: ${LQ}${t}${RQ}`,
    empty: "Enter the pages to rotate, or leave the field blank to rotate every page.",
    tooMany: "This selection has too many pages. Try a shorter range.",
  },
  es: {
    range: (t) => `Rango no válido: ${LQ}${t}${RQ}`, page: (t) => `Número de página no válido: ${LQ}${t}${RQ}`,
    empty: "Escribe las páginas que quieres rotar o deja el campo en blanco para rotarlas todas.",
    tooMany: "Esta selección tiene demasiadas páginas. Prueba con un rango más corto.",
  },
};
const OLD = {
  en: { range: (t) => `Invalid range: "${t}"`, page: (t) => `Invalid page number: "${t}"` },
  es: { range: (t) => `Rango no válido: "${t}"`, page: (t) => `Número de página no válido: "${t}"` },
};

// [input, before, after] on a 10-page PDF.
const CHANGES = [
  // Reversed and open-ended ranges: refused before, now read.
  ["5-2", ["range", "5-2"], [2, 3, 4, 5]],
  ["8-", ["range", "8-"], [8, 9, 10]],
  ["-3", ["range", "-3"], [1, 2, 3]],
  // Full-width digits and other dashes.
  [fullWidth("1-3"), ["page", fullWidth("1-3")], [1, 2, 3]],
  ["1" + EN_DASH + "3", [1], [1, 2, 3]],
  // Spaces and semicolons now separate items; parseInt used to read the first number and drop the rest.
  ["1 3", [1], [1, 3]],
  ["1;3", [1], [1, 3]],
  ["1;3-5", [1, 2, 3, 4, 5], [1, 3, 4, 5]],
  // Loose readings are refused.
  ["1-3-5", [1, 2, 3], ["range", "1-3-5"]],
  ["2a", [2], ["page", "2a"]],
  ["1.5", [1], ["page", "1.5"]],
  ["+3", [3], ["page", "+3"]],
  // Only commas (with or without spaces): 0 pages rotated and an unchanged file before, the new message now.
  [",", [], "empty"],
  [" , ", [], "empty"],
  [",,", [], "empty"],
  // Keywords, English and Spanish on both pages ("all" is the same as a blank field).
  ["odd", ["page", "odd"], [1, 3, 5, 7, 9]],
  ["even", ["page", "even"], [2, 4, 6, 8, 10]],
  ["last", ["page", "last"], [10]],
  ["all", ["page", "all"], ALL],
  ["impares", ["page", "impares"], [1, 3, 5, 7, 9]],
  ["pares", ["page", "pares"], [2, 4, 6, 8, 10]],
  ["última", ["page", "última"], [10]],
  ["todas", ["page", "todas"], ALL],
  ["1-5, last", ["page", "last"], [1, 2, 3, 4, 5, 10]],
  ["5-last", ["range", "5-last"], range(5, 10)],
  ["last-3", ["range", "last-3"], range(3, 10)],
  ["odd even", ["page", "odd even"], ALL],
  ["even, 1", ["page", "even"], [1, 2, 4, 6, 8, 10]],
];
// Same result (the message only gains typographic quotes), including the inputs closest to the changes.
const SAME = ["1-3, 5", "5, 1-3", "3,3,1-2", "1-4, 3-6", "1-2, 4", " 1 - 3 ", "007", "01-03", "10", "1-10",
  "0", "0-3", "11", "8-12", "1-99999999999", "x", "x-5", "0, 2", "11, x", "2, 0-3", "1-" + "9".repeat(400), "", "   "];

for (const prefix of ["", "es/"]) {
  const lang = prefix ? "es" : "en";
  const LANG = lang.toUpperCase();
  const M = MESSAGES[lang];
  // What the Rotate button does with the field: rotate the pages, or show the message and rotate nothing.
  const parsed = load(rotateSource(prefix));
  const run = (s, total) => { const r = parsed(s, total); return r.error ? { pages: [], error: r.error } : r; };
  const expected = (r) => (isPages(r) ? { pages: r, error: "" } : { pages: [], error: typeof r === "string" ? M[r] : M[r[0]](r[1]) });
  const oldExpected = (r) => (isPages(r) ? { pages: r } : { error: OLD[lang][r[0]](r[1]) });
  const oldSorted = (s, total) => { const o = oldRotateClick(s, total, lang); return o.pages ? { pages: [...o.pages].sort((a, b) => a - b) } : o; };
  // The old outcome as the page words it now: straight quotes become typographic.
  const now = (o) => (o.pages ? { pages: o.pages, error: "" } : { pages: [], error: o.error.replace(/^([^"]*: )"([\s\S]*)"$/, `$1${LQ}$2${RQ}`) });

  test(`Rotate PDF ${LANG}: every listed change, before and after`, () => {
    for (const [s, before, after] of CHANGES) {
      const label = JSON.stringify(s);
      assert.deepEqual(oldSorted(s, T), oldExpected(before), `before ${label}`);
      assert.deepEqual(run(s, T), expected(after), `after ${label}`);
      assert.notDeepEqual(now(oldSorted(s, T)), run(s, T), `${label} is listed but didn't change`);
    }
  });

  test(`Rotate PDF ${LANG}: the listed unchanged inputs give the same result, and a blank field is every page`, () => {
    for (const total of [1, 5, T]) {
      for (const s of SAME) assert.deepEqual(run(s, total), now(oldSorted(s, total)), `${JSON.stringify(s)} on ${total} pages`);
    }
    assert.deepEqual(run("", T), { pages: ALL, error: "" });
    assert.deepEqual(run("  ", T), { pages: ALL, error: "" });
    assert.deepEqual(run("all", T), run("", T));
  });

  test(`Rotate PDF ${LANG}: any plain list of pages and ranges gives the same pages`, () => {
    const rand = (() => { let x = 777; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; })();
    for (let n = 0; n < 4000; n++) {
      const total = 1 + Math.floor(rand() * 15);
      const num = () => 1 + Math.floor(rand() * total);
      const items = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => {
        if (rand() < 0.5) return String(num());
        const a = num(), b = num();
        return Math.min(a, b) + (rand() < 0.3 ? " - " : "-") + Math.max(a, b);
      });
      const s = items.join(rand() < 0.5 ? ", " : ",");
      const old = oldSorted(s, total);
      assert.ok(old.pages, `old accepted ${JSON.stringify(s)}`);
      assert.deepEqual(run(s, total), { pages: old.pages, error: "" }, `${JSON.stringify(s)} on ${total} pages`);
    }
  });

  test(`Rotate PDF ${LANG}: every error code shows its message, and the first problem wins`, () => {
    assert.deepEqual(run("x", T), expected(["page", "x"]));
    assert.deepEqual(run("x-5", T), expected(["range", "x-5"]));
    assert.deepEqual(run("0", T), expected(["page", "0"]));
    assert.deepEqual(run("0-3", T), expected(["range", "0-3"]));
    assert.deepEqual(run("11", T), expected(["page", "11"]));
    assert.deepEqual(run("8-12", T), expected(["range", "8-12"]));
    assert.deepEqual(run(",", T), expected("empty"));
    assert.deepEqual(run("even", 1), expected(["page", "even"]));
    assert.deepEqual(run("2, x, 11", T), expected(["page", "x"]));
    assert.deepEqual(run("11, x", T), expected(["page", "11"]));
    for (const s of ["x", "8-12", "0", "11", "1" + EN_DASH + "x", ","]) assert.ok(!run(s, T).error.includes("<item>"), s);
    // "1-10 odd" is 1-10 plus the odd pages: on 10 pages every page, as parseInt used to read it; on fewer
    // pages the message now names only the item it refuses, where the old one quoted the whole text.
    assert.deepEqual(run("1-10 odd", T), { pages: ALL, error: "" });
    assert.deepEqual(oldSorted("1-10 odd", T), { pages: ALL });
    assert.deepEqual(run("1-10 odd", 5), expected(["range", "1-10"]));
    assert.deepEqual(oldSorted("1-10 odd", 5), oldExpected(["range", "1-10 odd"]));
    // too_many is wired up, though only a PDF of more than 100,000 pages can reach it.
    assert.deepEqual(run("1-100001", 100001), expected("tooMany"));
    assert.equal(run("1-100000", 100000).pages.length, 100000);
  });
}

// Runs src's run(input, total) in a worker; resolves with its result and time, or rejects once the limit passes.
function timed(src, input, total) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require("node:worker_threads");
      const run = new Function(workerData.src + "\\nreturn run;")();
      parentPort.postMessage("ready");
      const t = performance.now();
      const result = run(workerData.input, workerData.total);
      parentPort.postMessage({ result: { count: result.pages.length, first: result.pages.slice(0, 3), error: result.error }, ms: performance.now() - t });`,
      { eval: true, workerData: { src, input, total } });
    let timer = null;
    worker.on("message", (m) => {
      if (m === "ready") {
        timer = setTimeout(() => { worker.terminate(); reject(new Error(`${JSON.stringify(input.slice(0, 40))} still running after ${TIME_LIMIT_MS} ms`)); }, TIME_LIMIT_MS);
        return;
      }
      clearTimeout(timer);
      worker.terminate();
      resolve(m);
    });
    worker.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

for (const prefix of ["", "es/"]) {
  const lang = prefix ? "es" : "en";
  test(`Rotate PDF ${lang.toUpperCase()}: huge inputs finish within ${TIME_LIMIT_MS} ms`, async () => {
    const src = rotateSource(prefix);
    const M = MESSAGES[lang];
    const cases = [
      // [input, total, pages, the message]
      [Array(10000).fill("1-1000").join(","), 1000, 1000, ""],
      [Array(10000).fill("1-1000").join(", "), 1000, 1000, ""],
      ["all, ".repeat(20000), 1000, 1000, ""],
      ["1-100000000", 12, 0, M.range("1-100000000")],
      ["1-99999999999", 1000, 0, M.range("1-99999999999")],
      ["1-" + "9".repeat(400), 12, 0, M.range("1-" + "9".repeat(400))],
    ];
    for (const [input, total, count, message] of cases) {
      const { result, ms } = await timed(src, input, total);
      assert.ok(ms < TIME_LIMIT_MS, `${input.slice(0, 30)} on ${total} pages took ${ms} ms`);
      assert.equal(result.error, message, `${input.slice(0, 30)} on ${total} pages`);
      assert.equal(message ? 0 : result.count, count, `${input.slice(0, 30)} on ${total} pages`);
    }
  });
}
