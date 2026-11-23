// Split PDF (EN and ES) reads typed pages with the shared page range helper.
//
// Each test runs the page's own code (range_pages.mjs cuts parseRanges() out with the helper block) and
// compares it with what the Extract button did before (old_range_parsers.mjs, frozen from main at 002ba100):
// - CHANGES lists every kind of input whose result changed, with the result before and after;
// - SAME lists inputs whose result didn't change (old messages compared with their straight quotes turned
//   into typographic ones, U+201C and U+201D), and any input of plain page numbers and ranges inside the
//   document, in order, gives exactly the pages it gave before;
// - every error code shows its message in each language, the first problem wins (as before), and a selection
//   of more than 10,000 pages is refused within TIME_LIMIT_MS (the old code built every page and then copied
//   them all, which froze the tab), so the Extract button never reaches the copy step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { oldSplitExtract } from "./old_range_parsers.mjs";
import { splitSource, load } from "./range_pages.mjs";

const ch = (...codes) => String.fromCharCode(...codes);
const LQ = ch(0x201C), RQ = ch(0x201D);
const fullWidth = (s) => s.replace(/[0-9-]/g, (c) => ch(c.charCodeAt(0) + 0xFEE0));
const EN_DASH = ch(0x2013);
const T = 10;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
// A result is pages (an array of numbers, possibly empty) or a message ([kind, token], "empty" or "tooMany").
const isPages = (r) => Array.isArray(r) && typeof r[0] !== "string";
const TIME_LIMIT_MS = 1000;

const MESSAGES = {
  en: {
    range: (t) => `Invalid range: ${LQ}${t}${RQ}`, page: (t) => `Invalid page number: ${LQ}${t}${RQ}`,
    empty: `Enter a page range, e.g. ${LQ}1-3, 5${RQ}.`, tooMany: "This selection has too many pages. Try a shorter range.",
  },
  es: {
    range: (t) => `Rango no válido: ${LQ}${t}${RQ}`, page: (t) => `Número de página no válido: ${LQ}${t}${RQ}`,
    empty: `Escribe un rango de páginas, p. ej. ${LQ}1-3, 5${RQ}.`, tooMany: "Esta selección tiene demasiadas páginas. Prueba con un rango más corto.",
  },
};
const OLD = {
  en: { range: (t) => `Invalid range: "${t}"`, page: (t) => `Invalid page number: "${t}"`, empty: 'Enter a page range, e.g. "1-3, 5".' },
  es: { range: (t) => `Rango no válido: "${t}"`, page: (t) => `Número de página no válido: "${t}"`, empty: 'Introduce un rango de páginas, p. ej. "1-3, 5".' },
};

// [input, before, after] on a 10-page PDF. A result is pages (an array) or a message: ["range"|"page", token],
// "empty" or "tooMany".
const CHANGES = [
  // Reversed and open-ended ranges: refused before, now read (a reversed range counts down, in typed order).
  ["5-2", ["range", "5-2"], [5, 4, 3, 2]],
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
  // Only commas: a 0-page PDF before, the empty-field message now.
  [",", [], "empty"],
  [" , ", [], "empty"],
  // Keywords, English and Spanish on both pages.
  ["odd", ["page", "odd"], [1, 3, 5, 7, 9]],
  ["even", ["page", "even"], [2, 4, 6, 8, 10]],
  ["last", ["page", "last"], [10]],
  ["all", ["page", "all"], range(1, 10)],
  ["impares", ["page", "impares"], [1, 3, 5, 7, 9]],
  ["pares", ["page", "pares"], [2, 4, 6, 8, 10]],
  ["última", ["page", "última"], [10]],
  ["todas", ["page", "todas"], range(1, 10)],
  ["1-5, last", ["page", "last"], [1, 2, 3, 4, 5, 10]],
  ["5-last", ["range", "5-last"], range(5, 10)],
  ["last-3", ["range", "last-3"], [10, 9, 8, 7, 6, 5, 4, 3]],
  ["odd even", ["page", "odd even"], [1, 3, 5, 7, 9, 2, 4, 6, 8, 10]],
  ["1-10 odd", range(1, 10), range(1, 10).concat([1, 3, 5, 7, 9])],
];
// Same result (the message only gains typographic quotes), including the inputs closest to the changes.
const SAME = ["1-3, 5", "5, 1-3", "3,3,1-2", "1-4, 3-6", "2-3", "7, 10", " 1 - 3 ", "007", "01-03", "10", "1-10",
  "0", "0-3", "11", "8-12", "1-99999999999", "x", "x-5", "0, 2", "11, x", "2, 0-3", "1-" + "9".repeat(400)];

for (const prefix of ["", "es/"]) {
  const lang = prefix ? "es" : "en";
  const LANG = lang.toUpperCase();
  // What the Extract button does with the field: copy the pages, or show the message and copy nothing.
  const parsed = load(splitSource(prefix));
  const run = (s, total) => { const r = parsed(s, total); return r.error ? { pages: [], error: r.error } : r; };
  const M = MESSAGES[lang];
  const expected = (r) => (isPages(r) ? { pages: r, error: "" } : { pages: [], error: typeof r === "string" ? M[r] : M[r[0]](r[1]) });
  const oldExpected = (r) => (isPages(r) ? { pages: r } : { error: typeof r === "string" ? OLD[lang][r] : OLD[lang][r[0]](r[1]) });
  // The old outcome as the page words it now: straight quotes become typographic, and the empty-field
  // message is the new one (ES: "Introduce" became "Escribe").
  const now = (o) => {
    if (o.pages) return { pages: o.pages, error: "" };
    if (o.error === OLD[lang].empty) return { pages: [], error: M.empty };
    return { pages: [], error: o.error.replace(/^([^"]*: )"([\s\S]*)"$/, `$1${LQ}$2${RQ}`) };
  };

  test(`Split PDF ${LANG}: every listed change, before and after`, () => {
    for (const [s, before, after] of CHANGES) {
      const label = JSON.stringify(s);
      assert.deepEqual(oldSplitExtract(s, T, lang), oldExpected(before), `before ${label}`);
      assert.deepEqual(run(s, T), expected(after), `after ${label}`);
      assert.notDeepEqual(now(oldSplitExtract(s, T, lang)), run(s, T), `${label} is listed but didn't change`);
    }
  });

  test(`Split PDF ${LANG}: the listed unchanged inputs give the same result`, () => {
    for (const total of [1, 5, T]) {
      for (const s of SAME) assert.deepEqual(run(s, total), now(oldSplitExtract(s, total, lang)), `${JSON.stringify(s)} on ${total} pages`);
    }
    // The empty field: the same message, now with typographic quotes (and "Escribe" in Spanish).
    assert.deepEqual(oldSplitExtract("", T, lang), { error: OLD[lang].empty });
    assert.deepEqual(run("", T), { pages: [], error: M.empty });
    assert.deepEqual(run("   ", T), { pages: [], error: M.empty });
  });

  test(`Split PDF ${LANG}: any plain list of pages and ranges in order gives the same pages`, () => {
    const rand = (() => { let x = 4242; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; })();
    let compared = 0;
    for (let n = 0; n < 4000; n++) {
      const total = 1 + Math.floor(rand() * 15);
      const num = () => 1 + Math.floor(rand() * total);
      const items = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => {
        if (rand() < 0.5) return String(num());
        const a = num(), b = num();
        return Math.min(a, b) + (rand() < 0.3 ? " - " : "-") + Math.max(a, b);
      });
      const s = items.join(rand() < 0.5 ? ", " : ",");
      const old = oldSplitExtract(s, total, lang);
      assert.ok(old.pages, `old accepted ${JSON.stringify(s)}`);
      assert.deepEqual(run(s, total), { pages: old.pages, error: "" }, `${JSON.stringify(s)} on ${total} pages`);
      compared++;
    }
    assert.equal(compared, 4000);
  });

  test(`Split PDF ${LANG}: every error code shows its message, and the first problem wins`, () => {
    assert.deepEqual(run("x", T), expected(["page", "x"]));
    assert.deepEqual(run("x-5", T), expected(["range", "x-5"]));
    assert.deepEqual(run("0", T), expected(["page", "0"]));
    assert.deepEqual(run("0-3", T), expected(["range", "0-3"]));
    assert.deepEqual(run("11", T), expected(["page", "11"]));
    assert.deepEqual(run("8-12", T), expected(["range", "8-12"]));
    assert.deepEqual(run(",", T), expected("empty"));
    assert.deepEqual(run("2, x, 11", T), expected(["page", "x"]));
    assert.deepEqual(run("11, x", T), expected(["page", "11"]));
    // The literal placeholder never appears: each message carries the item as typed.
    for (const s of ["x", "8-12", "0", "11", "1" + EN_DASH + "x"]) assert.ok(!run(s, T).error.includes("<item>"), s);
    // too_many: more than 10,000 pages, repeats counted.
    assert.deepEqual(run("1-5000, 1-5000", 5000).pages.length, 10000);
    assert.deepEqual(run("1-5000, 1-5000, 1", 5000), expected("tooMany"));
    assert.deepEqual(run(Array(1001).fill("1-10").join(","), T), expected("tooMany"));
    // A problem before the limit is named first.
    assert.deepEqual(run("x, " + Array(1001).fill("1-10").join(","), T), expected(["page", "x"]));
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
      parentPort.postMessage({ result, ms: performance.now() - t });`,
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
  test(`Split PDF ${lang.toUpperCase()}: huge inputs are refused within ${TIME_LIMIT_MS} ms, with no page to copy`, async () => {
    const src = splitSource(prefix);
    const cases = [
      // [input, total, the message]
      [Array(10000).fill("1-1000").join(","), 1000, MESSAGES[lang].tooMany],
      [Array(10000).fill("1-1000").join(", "), 1000, MESSAGES[lang].tooMany],
      ["1-100000000", 12, MESSAGES[lang].range("1-100000000")],
      ["1-99999999999", 1000, MESSAGES[lang].range("1-99999999999")],
      ["1-" + "9".repeat(400), 12, MESSAGES[lang].range("1-" + "9".repeat(400))],
      ["all, ".repeat(20000), 1000, MESSAGES[lang].tooMany],
    ];
    for (const [input, total, message] of cases) {
      const { result, ms } = await timed(src, input, total);
      assert.ok(ms < TIME_LIMIT_MS, `${input.slice(0, 30)} on ${total} pages took ${ms} ms`);
      assert.deepEqual(result, { pages: [], error: message }, `${input.slice(0, 30)} on ${total} pages`);
    }
  });
}
