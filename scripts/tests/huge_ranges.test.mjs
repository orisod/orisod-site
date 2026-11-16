// Huge typed page ranges must not freeze Delete PDF Pages or PDF to JPG (EN and ES).
//
// Both tools used to loop over every number in a typed range before checking it against the document, so
// "1-100000000" froze the tab (PDF to JPG then threw "Set maximum size exceeded"). Both now read ranges with the
// shared page range helper, which never loops past the last page. Each test cuts the tool's own code and the
// helper block out of its page (range_pages.mjs) and runs that exact text: the huge inputs run in a worker that
// is stopped after TIME_LIMIT_MS, so a regression fails here instead of hanging the job, and normal inputs must
// give exactly what the code did before (old_range_parsers.mjs). The inputs whose result changed when the
// tools adopted the helper are listed, before and after, in range_adoption.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { oldDeleteSet, oldJpgSelection } from "./old_range_parsers.mjs";
import { deleteSource, jpgSource, load } from "./range_pages.mjs";

const TIME_LIMIT_MS = 1000;
const HUGE = ["1-100000000", "1-10000000", "1-99999999999", "1-" + "9".repeat(400), "5-100000000, 2"];
const PAGE_COUNTS = [0, 1, 12];
const NORMAL = ["1-3, 5", "1-12", "5-50", "0", "0-3", "13", "13-20", "12-12", "3-3, 3", " 1 - 3 ", "007", "01-03",
  "1,1", ",", "6-6, 6, 13-20", "0, 2", "2, 4, 7-9"];
const sorted = (set) => Array.from(set).sort((a, b) => a - b);

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

  test(`Delete PDF Pages (${lang.toUpperCase()}): huge ranges finish within ${TIME_LIMIT_MS} ms`, async () => {
    const src = deleteSource(prefix);
    for (const input of HUGE) for (const total of PAGE_COUNTS) {
      const { result, ms } = await timed(src, input, total);
      assert.ok(ms < TIME_LIMIT_MS, `${input} on ${total} pages took ${ms} ms`);
      assert.equal(result.error, "", `${input} on ${total} pages`);
      assert.deepEqual(sorted(result.deleteSet), input.startsWith("5-")
        ? Array.from({ length: total }, (_, i) => i).filter((i) => i >= 1 && (i === 1 || i >= 4))
        : Array.from({ length: total }, (_, i) => i), `${input} on ${total} pages`);
    }
  });

  test(`PDF to JPG (${lang.toUpperCase()}): huge ranges finish within ${TIME_LIMIT_MS} ms`, async () => {
    const src = jpgSource(prefix);
    for (const input of HUGE) for (const total of PAGE_COUNTS) {
      const { result, ms } = await timed(src, input, total);
      assert.ok(ms < TIME_LIMIT_MS, `${input} on ${total} pages took ${ms} ms`);
      const all = Array.from({ length: total }, (_, i) => i + 1);
      assert.deepEqual({ ticked: sorted(result.pages), error: result.error },
        { ticked: input.startsWith("5-") ? all.filter((p) => p === 2 || p >= 5) : all, error: "" }, `${input} on ${total} pages`);
    }
  });

  test(`Delete PDF Pages (${lang.toUpperCase()}): normal ranges give exactly what they did before`, () => {
    const run = load(deleteSource(prefix));
    for (const input of NORMAL) for (const total of PAGE_COUNTS) {
      assert.deepEqual(run(input, total), { deleteSet: oldDeleteSet(input, total), error: "" }, `${JSON.stringify(input)} on ${total} pages`);
    }
    assert.deepEqual(sorted(run("1-3, 5", 12).deleteSet), [0, 1, 2, 4]);
    assert.deepEqual(sorted(run("5-50", 12).deleteSet), [4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test(`PDF to JPG (${lang.toUpperCase()}): normal ranges give exactly what they did before, with the same messages`, () => {
    const run = load(jpgSource(prefix));
    const ticked = (r, total) => ({ ticked: sorted(r.pages).filter((p) => p <= total), error: r.error });
    for (const input of NORMAL) for (const total of PAGE_COUNTS) {
      const raw = input.trim();
      assert.deepEqual(ticked(run(raw, total), total), ticked(oldJpgSelection(raw, total, lang), total), `${JSON.stringify(input)} on ${total} pages`);
    }
    assert.deepEqual(ticked(run("1-3, 5", 12), 12), { ticked: [1, 2, 3, 5], error: "" });
    assert.deepEqual(ticked(run("0", 12), 12).ticked, []);
    assert.notEqual(run("0", 12).error, "");
  });
}
