// Huge typed page ranges must not freeze Delete PDF Pages or PDF to JPG (EN and ES).
//
// Both tools used to loop over every number in a typed range before checking it against the document, so
// "1-100000000" froze the tab (PDF to JPG then threw "Set maximum size exceeded"). Each test cuts the tool's
// own code out of its page and runs that exact text: the huge inputs run in a worker that is stopped after
// TIME_LIMIT_MS, so a regression fails here instead of hanging the job, and normal inputs must give exactly
// what the code did before the fix (the OLD_* copies below).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TIME_LIMIT_MS = 1000;
const HUGE = ["1-100000000", "1-10000000", "1-99999999999", "1-" + "9".repeat(400), "5-100000000, 2"];
const PAGE_COUNTS = [0, 1, 12];
const NORMAL = ["1-3, 5", "1-12", "5-50", "5-2", "0", "0-3", "13", "13-20", "20-15", "12-12", "3-3, 3", " 1 - 3 ",
  "007", "01-03", "1,1", ",", "2a", "1.5", "1-3-5", "-3", "3-", "x-5", "1 2", "1;2", "6-6, 6, 13-1"];

const read = (rel) => readFileSync(ROOT + rel, "utf-8").replace(/\r\n/g, "\n");
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
const HANDLER = "applyRangeBtn.addEventListener('click', () => ";
// Source text that defines run(input, total), returning what the page would show.
function deleteSource(prefix) {
  return cut(read(prefix + "delete-pdf-pages/index.html"), "function parsePageRanges(") +
    "\nfunction run(input, total) { return { pages: Array.from(parsePageRanges(input, total)).sort((a, b) => a - b) }; }";
}
function jpgSource(prefix) {
  const body = cut(read(prefix + "pdf-to-jpg/index.html"), HANDLER).slice(HANDLER.length);
  return `function run(input, total) {
  const rangeInput = { value: input }, errorMsg = { textContent: "" }, updateDownloadSelectedVisibility = () => {};
  const convertedImages = Array.from({ length: total }, (_, i) => ({ page: i + 1, checkbox: { checked: false } }));
  (() => ${body})();
  return { ticked: convertedImages.filter((img) => img.checkbox.checked).map((img) => img.page), error: errorMsg.textContent };
}`;
}
const load = (src) => new Function(src + "\nreturn run;")();

// The code as it was before the fix, for the normal inputs.
function OLD_DELETE(str, total) {
  const deleteSet = new Set();
  str.split(",").forEach((part) => {
    part = part.trim();
    if (!part) return;
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      let a = parseInt(rangeMatch[1], 10);
      let b = parseInt(rangeMatch[2], 10);
      if (a > b) { const t = a; a = b; b = t; }
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) deleteSet.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= total) deleteSet.add(n - 1);
    }
  });
  return { pages: Array.from(deleteSet).sort((a, b) => a - b) };
}
function OLD_JPG(input, total, invalidRange, invalidPage) {
  const raw = input.trim();
  const errorMsg = { textContent: "" };
  const pagesToSelect = new Set();
  if (raw) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.includes("-")) {
        const [startStr, endStr] = trimmed.split("-");
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (isNaN(start) || isNaN(end) || start < 1 || end < start) { errorMsg.textContent = invalidRange(trimmed); continue; }
        for (let p = start; p <= end; p++) pagesToSelect.add(p);
      } else {
        const num = parseInt(trimmed, 10);
        if (isNaN(num) || num < 1) { errorMsg.textContent = invalidPage(trimmed); continue; }
        pagesToSelect.add(num);
      }
    }
  }
  const ticked = [];
  for (let page = 1; page <= total; page++) if (pagesToSelect.has(page)) ticked.push(page);
  return { ticked, error: errorMsg.textContent };
}
const MESSAGES = {
  "": [(t) => `Invalid range: "${t}"`, (t) => `Invalid page number: "${t}"`],
  "es/": [(t) => `Rango no válido: "${t}"`, (t) => `Número de página no válido: "${t}"`],
};

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
  const lang = prefix ? "ES" : "EN";
  const [invalidRange, invalidPage] = MESSAGES[prefix];

  test(`Delete PDF Pages (${lang}): huge ranges finish within ${TIME_LIMIT_MS} ms`, async () => {
    const src = deleteSource(prefix);
    for (const input of HUGE) for (const total of PAGE_COUNTS) {
      const { result, ms } = await timed(src, input, total);
      assert.ok(ms < TIME_LIMIT_MS, `${input} on ${total} pages took ${ms} ms`);
      assert.deepEqual(result.pages, input.startsWith("5-")
        ? Array.from({ length: total }, (_, i) => i).filter((i) => i >= 1 && (i === 1 || i >= 4))
        : Array.from({ length: total }, (_, i) => i), `${input} on ${total} pages`);
    }
  });

  test(`PDF to JPG (${lang}): huge ranges finish within ${TIME_LIMIT_MS} ms`, async () => {
    const src = jpgSource(prefix);
    for (const input of HUGE) for (const total of PAGE_COUNTS) {
      const { result, ms } = await timed(src, input, total);
      assert.ok(ms < TIME_LIMIT_MS, `${input} on ${total} pages took ${ms} ms`);
      const all = Array.from({ length: total }, (_, i) => i + 1);
      assert.deepEqual(result, { ticked: input.startsWith("5-") ? all.filter((p) => p === 2 || p >= 5) : all, error: "" },
        `${input} on ${total} pages`);
    }
  });

  test(`Delete PDF Pages (${lang}): normal ranges give exactly what they did before`, () => {
    const run = load(deleteSource(prefix));
    for (const input of NORMAL) for (const total of PAGE_COUNTS) {
      assert.deepEqual(run(input, total), OLD_DELETE(input, total), `${JSON.stringify(input)} on ${total} pages`);
    }
    assert.deepEqual(run("1-3, 5", 12).pages, [0, 1, 2, 4]);
    assert.deepEqual(run("5-50", 12).pages, [4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test(`PDF to JPG (${lang}): normal ranges give exactly what they did before, with the same messages`, () => {
    const run = load(jpgSource(prefix));
    for (const input of NORMAL) for (const total of PAGE_COUNTS) {
      assert.deepEqual(run(input, total), OLD_JPG(input, total, invalidRange, invalidPage), `${JSON.stringify(input)} on ${total} pages`);
    }
    assert.deepEqual(run("1-3, 5", 12), { ticked: [1, 2, 3, 5], error: "" });
    assert.deepEqual(run("20-15", 12), { ticked: [], error: invalidRange("20-15") });
    assert.deepEqual(run("0", 12), { ticked: [], error: invalidPage("0") });
  });
}
