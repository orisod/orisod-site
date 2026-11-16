// Delete PDF Pages and PDF to JPG (EN and ES) read typed pages with the shared page range helper.
//
// Each test runs the pages' own code (range_pages.mjs cuts it out with the helper block) and compares it with
// the code they had before (old_range_parsers.mjs, frozen from main at 4e853957):
// - CHANGES lists every kind of input whose result changed, with the result before and after, in both tools;
// - every other input made only of page numbers and ranges (with a dash between two numbers) must give
//   exactly what it gave before;
// - each tool matches the helper with its options: Delete PDF Pages { outOfRange: "clip" }; PDF to JPG the
//   default (reversed ranges accepted), with out-of-range items cut to the document instead of refused;
// - every error code shows the right message in each language.
import { test } from "node:test";
import assert from "node:assert/strict";
import { oldDeleteSet, oldJpgSelection, deleteOutcome, jpgOutcome, OLD_MESSAGES } from "./old_range_parsers.mjs";
import { deleteSource, jpgSource, load, read } from "./range_pages.mjs";

const SOURCE = read("assets/js/orisod-ranges.js");
const parse = new Function(SOURCE + "\nreturn orisodParseRanges;")();
const ch = (...codes) => String.fromCharCode(...codes);
const fullWidth = (s) => s.replace(/[0-9-]/g, (c) => ch(c.charCodeAt(0) + 0xFEE0));
const EN_DASH = ch(0x2013), EM_DASH = ch(0x2014), MINUS = ch(0x2212);
const TOO_MANY = {
  en: "This selection has too many pages. Try a shorter range.",
  es: "Esta selección tiene demasiadas páginas. Prueba con un rango más corto.",
};
const T = 12;
const ALL = Array.from({ length: T }, (_, i) => i + 1);

// [input, Delete before, Delete after, PDF to JPG before, PDF to JPG after], on a 12-page PDF.
// Delete: { pages, save, text } with text "" (no preview), "count", "all" or ["range"|"page", token].
// PDF to JPG: { ticked, error } with error "" or ["range"|"page", token].
const D = (pages, save, text = pages.length ? "count" : "") => ({ pages, save, text });
const J = (ticked, error = "") => ({ ticked, error });
const CHANGES = [
  // Reversed ranges: Delete already read them backwards; PDF to JPG refused them.
  ["5-2", D([2, 3, 4, 5], true), D([2, 3, 4, 5], true), J([], ["range", "5-2"]), J([2, 3, 4, 5])],
  ["12-1", D(ALL, false, "all"), D(ALL, false, "all"), J([], ["range", "12-1"]), J(ALL)],
  ["20-15", D([], false), D([], false), J([], ["range", "20-15"]), J([])],
  // Semicolons and spaces now separate items.
  ["1;2", D([], false), D([1, 2], true), J([1]), J([1, 2])],
  ["1; 3-5", D([], false), D([1, 3, 4, 5], true), J([1, 2, 3, 4, 5]), J([1, 3, 4, 5])],
  ["1 2", D([], false), D([1, 2], true), J([1]), J([1, 2])],
  ["1 3-5", D([], false), D([1, 3, 4, 5], true), J([1, 2, 3, 4, 5]), J([1, 3, 4, 5])],
  ["x 5", D([], false), D([], false, ["page", "x"]), J([], ["page", "x 5"]), J([5], ["page", "x"])],
  // Full-width digits and other dashes.
  [fullWidth("1-3"), D([], false), D([1, 2, 3], true), J([], ["page", fullWidth("1-3")]), J([1, 2, 3])],
  [fullWidth("2"), D([], false), D([2], true), J([], ["page", fullWidth("2")]), J([2])],
  ["1" + EN_DASH + "3", D([], false), D([1, 2, 3], true), J([1]), J([1, 2, 3])],
  ["1" + EM_DASH + "3", D([], false), D([1, 2, 3], true), J([1]), J([1, 2, 3])],
  ["1" + MINUS + "3", D([], false), D([1, 2, 3], true), J([1]), J([1, 2, 3])],
  // Open-ended ranges: to the last page, or from page 1.
  ["8-", D([], false), D([8, 9, 10, 11, 12], true), J([], ["range", "8-"]), J([8, 9, 10, 11, 12])],
  ["-3", D([], false), D([1, 2, 3], true), J([], ["range", "-3"]), J([1, 2, 3])],
  ["1-", D([], false), D(ALL, false, "all"), J([], ["range", "1-"]), J(ALL)],
  // Loose readings are refused: parseInt used to read the leading number.
  ["2a", D([], false), D([], false, ["page", "2a"]), J([2]), J([], ["page", "2a"])],
  ["1.5", D([], false), D([], false, ["page", "1.5"]), J([1]), J([], ["page", "1.5"])],
  ["+3", D([], false), D([], false, ["page", "+3"]), J([3]), J([], ["page", "+3"])],
  ["1e3", D([], false), D([], false, ["page", "1e3"]), J([1]), J([], ["page", "1e3"])],
  ["1-3-5", D([], false), D([], false, ["range", "1-3-5"]), J([1, 2, 3]), J([], ["range", "1-3-5"])],
  // Delete PDF Pages used to skip what it couldn't read; now it says so and keeps Save off.
  ["x", D([], false), D([], false, ["page", "x"]), J([], ["page", "x"]), J([], ["page", "x"])],
  ["x-5", D([], false), D([], false, ["range", "x-5"]), J([], ["range", "x-5"]), J([], ["range", "x-5"])],
  ["-", D([], false), D([], false, ["range", "-"]), J([], ["range", "-"]), J([], ["range", "-"])],
  ["abc, 2", D([2], true), D([], false, ["page", "abc"]), J([2], ["page", "abc"]), J([2], ["page", "abc"])],
];
// Inputs whose result is the same in both tools, including the ones closest to the changes above.
const SAME = ["1-3, 5", "2, 4, 7-9", "1,1", "3, 3-4", "6-6, 6", "1 - 3", "1 -3", " 1 - 3 ", "007", "01-03", "0", "0-3",
  "0, 2", "13", "5-50", "13-20", "12", "1-12", ",", ", 2", "", "  ", "1-100000000", "1-99999999999"];

// Whether a token has a character the helper reads as the range dash ("1" + c + "2" is pages 1 to 2; a token
// never holds a separator, and spaces are left out).
const hasDash = (token) => [...token].some((c) => !/\s/.test(c) && parse("1" + c + "2", 2).ok);
const message = (lang, e) => (e ? OLD_MESSAGES[lang][e[0]](e[1]) : "");
const deleteText = (lang, text) => (Array.isArray(text) ? message(lang, text) : text);

for (const prefix of ["", "es/"]) {
  const lang = prefix ? "es" : "en";
  const LANG = lang.toUpperCase();
  const newDelete = load(deleteSource(prefix)), newJpg = load(jpgSource(prefix));
  const before = {
    delete: (s, total) => deleteOutcome(oldDeleteSet(s, total), "", total),
    jpg: (s, total) => jpgOutcome(s, total, (raw, last) => oldJpgSelection(raw, last, lang)),
  };
  const after = {
    delete: (s, total) => { const { deleteSet, error } = newDelete(s, total); return deleteOutcome(deleteSet, error, total); },
    jpg: (s, total) => jpgOutcome(s, total, newJpg),
  };

  test(`${LANG}: every listed change, before and after, in both tools`, () => {
    for (const [s, delBefore, delAfter, jpgBefore, jpgAfter] of CHANGES) {
      const label = JSON.stringify(s);
      assert.deepEqual(before.delete(s, T), { ...delBefore, text: deleteText(lang, delBefore.text) }, `Delete before ${label}`);
      assert.deepEqual(after.delete(s, T), { ...delAfter, text: deleteText(lang, delAfter.text) }, `Delete after ${label}`);
      assert.deepEqual(before.jpg(s, T), { ticked: jpgBefore.ticked, error: message(lang, jpgBefore.error) }, `JPG before ${label}`);
      assert.deepEqual(after.jpg(s, T), { ticked: jpgAfter.ticked, error: message(lang, jpgAfter.error) }, `JPG after ${label}`);
      const changed = JSON.stringify(before.delete(s, T)) !== JSON.stringify(after.delete(s, T)) ||
        JSON.stringify(before.jpg(s, T)) !== JSON.stringify(after.jpg(s, T));
      assert.ok(changed, `${label} is listed but changed in neither tool`);
    }
  });

  test(`${LANG}: the listed unchanged inputs give the same result in both tools`, () => {
    for (const total of [1, 5, T]) {
      for (const s of SAME) {
        assert.deepEqual(after.delete(s, total), before.delete(s, total), `Delete ${JSON.stringify(s)} on ${total} pages`);
        assert.deepEqual(after.jpg(s, total), before.jpg(s, total), `JPG ${JSON.stringify(s)} on ${total} pages`);
      }
    }
  });

  test(`${LANG}: any input of plain page numbers and ranges gives what it did before`, () => {
    // Items "n" or "a-b" (spaces allowed around the dash), separated by commas. PDF to JPG refused a
    // reversed range, which it now accepts, so those are left to CHANGES.
    const rand = (() => { let x = 12345; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; })();
    const num = () => String(Math.floor(rand() * 16));
    let compared = 0;
    for (let n = 0; n < 4000; n++) {
      const items = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => (rand() < 0.5 ? num() : num() + (rand() < 0.3 ? " - " : "-") + num()));
      const s = items.join(rand() < 0.5 ? ", " : ",");
      for (const total of [1, 5, T]) {
        assert.deepEqual(after.delete(s, total), before.delete(s, total), `Delete ${JSON.stringify(s)} on ${total} pages`);
        const reversed = items.some((it) => { const m = it.match(/^(\d+)\s*-\s*(\d+)$/); return m && +m[1] > +m[2]; });
        if (!reversed) assert.deepEqual(after.jpg(s, total), before.jpg(s, total), `JPG ${JSON.stringify(s)} on ${total} pages`);
        compared++;
      }
    }
    assert.ok(compared >= 12000);
  });

  test(`${LANG}: each tool matches the helper with its options`, () => {
    const inputs = CHANGES.map((c) => c[0]).concat(SAME, ["3-1, 9-", "0-3, 5", "0, 13, 2", "1-2; 2-1", "x, 13", "x, 0-2"]);
    for (const total of [1, 5, T]) {
      for (const s of inputs) {
        const clip = parse(s, total, { outOfRange: "clip" });
        const d = newDelete(s, total);
        assert.deepEqual(Array.from(d.deleteSet).map((i) => i + 1).sort((a, b) => a - b), clip.pages, `Delete pages ${JSON.stringify(s)}`);
        assert.equal(d.error === "", clip.errors.every((e) => e.code === "empty"), `Delete error ${JSON.stringify(s)}`);
        const strict = parse(s, total);
        const problems = strict.errors.filter((e) => e.code !== "empty" && e.code !== "out_of_range");
        const j = newJpg(s, total);
        if (!problems.some((e) => e.code === "zero_or_negative")) {
          assert.deepEqual([...j.pages].sort((a, b) => a - b), clip.pages, `JPG pages ${JSON.stringify(s)}`);
        }
        assert.ok([...j.pages].every((p) => p >= 1 && p <= total), `JPG pages inside the document ${JSON.stringify(s)}`);
        const last = problems[problems.length - 1];
        assert.equal(j.error, last ? message(lang, [hasDash(last.token) ? "range" : "page", last.token]) : "", `JPG error ${JSON.stringify(s)}`);
      }
    }
  });

  test(`${LANG}: every error code shows its message, in both tools`, () => {
    const cases = [
      // [input, total, code, message]
      ["x", T, "invalid_token", ["page", "x"]],
      ["x-5", T, "invalid_token", ["range", "x-5"]],
      ["1" + EN_DASH + "x", T, "invalid_token", ["range", "1" + EN_DASH + "x"]],
      ["1" + EM_DASH + "3" + EM_DASH + "5", T, "invalid_token", ["range", "1" + EM_DASH + "3" + EM_DASH + "5"]],
      ["1" + MINUS + MINUS + "3", T, "invalid_token", ["range", "1" + MINUS + MINUS + "3"]],
      [fullWidth("1-3-5"), T, "invalid_token", ["range", fullWidth("1-3-5")]],
      ["0", T, "zero_or_negative", ["page", "0"]],
      ["0-3", T, "zero_or_negative", ["range", "0-3"]],
    ];
    for (const [s, total, code, msg] of cases) {
      assert.ok(parse(s, total).errors.some((e) => e.code === code), `${JSON.stringify(s)} gives ${code}`);
      assert.equal(newJpg(s, total).error, message(lang, msg), `JPG ${JSON.stringify(s)}`);
      if (code !== "zero_or_negative") assert.equal(newDelete(s, total).error, message(lang, msg), `Delete ${JSON.stringify(s)}`);
    }
    // Page 0 is dropped by Delete PDF Pages, as before, with no message.
    assert.deepEqual(newDelete("0", T), { deleteSet: new Set(), error: "" });
    assert.deepEqual([...newDelete("0-3", T).deleteSet].sort(), [0, 1, 2]);
    // Pages outside the document are dropped with no message in both, so out_of_range never shows.
    assert.equal(newDelete("13, 5-50", T).error, "");
    assert.equal(newJpg("13, 5-50", T).error, "");
    // too_many: a selection of more than 100,000 pages (only possible in a longer PDF).
    const big = 100001;
    assert.ok(parse("1-" + big, big, { outOfRange: "clip" }).errors.some((e) => e.code === "too_many"));
    assert.equal(newDelete("1-" + big, big).error, TOO_MANY[lang]);
    assert.equal(newDelete("1-" + big, big).deleteSet.size, 0);
    assert.equal(newJpg("1-" + big, big).error, TOO_MANY[lang]);
    // empty shows nothing: Delete PDF Pages shows no preview; PDF to JPG unticks everything, as before.
    assert.deepEqual(newDelete(",", T), { deleteSet: new Set(), error: "" });
    assert.deepEqual(newJpg(",", T), { pages: new Set(), error: "" });
  });
}
