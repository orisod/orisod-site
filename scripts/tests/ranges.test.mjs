// Unit tests for the page range helper, orisodParseRanges() and orisodFormatRanges().
//
// Run: node --test "scripts/tests/*.test.mjs"   (CI: the "smoke" job of check-smoke, before the browser tests)
//
// They run the source, assets/js/orisod-ranges.js, with no DOM, and check that every page carrying the
// "Orisod page ranges" block carries it byte for byte. The differential tests at the end take the four
// tools' own parsers (Rotate PDF cut out of its EN and ES pages without running it; Delete PDF Pages, PDF to
// JPG and Split PDF, which now use the helper, from the frozen copies in old_range_parsers.mjs), feed
// them the same inputs as the helper, and check that the helper accepts everything they accept with the same
// pages, apart from the differences listed in DIFFERENCES.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { oldDeleteSet, oldJpgSelection, oldSplitRanges } from "./old_range_parsers.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const START = "// Orisod page ranges: start", END = "// Orisod page ranges: end";
const SOURCE = readFileSync(ROOT + "assets/js/orisod-ranges.js", "utf-8").replace(/\r\n/g, "\n");
const SKIP = [".git", "node_modules", "assets", "scripts", "docs", "audit", "prototypes", ".claude", ".github"];
const { orisodParseRanges: parse, orisodFormatRanges: format, ORISOD_RANGE_KEYWORDS } =
  new Function(`${SOURCE}\nreturn { orisodParseRanges, orisodFormatRanges, ORISOD_RANGE_KEYWORDS };`)();
const ch = (...codes) => String.fromCharCode(...codes);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const codes = (r) => r.errors.map((e) => e.code);
// Split PDF's options (its page reads them as RANGE_OPTIONS).
const SPLIT = { preserveOrder: true, unique: false, allowKeywords: true, outOfRange: "error", maxItems: 10000 };

function pagesWithBlock(dir = "", out = []) {
  for (const entry of readdirSync(ROOT + dir)) {
    const rel = dir + entry;
    if (SKIP.includes(rel)) continue;
    if (statSync(ROOT + rel).isDirectory()) pagesWithBlock(rel + "/", out);
    else if (entry.endsWith(".html") && readFileSync(ROOT + rel, "utf-8").includes(START)) out.push(rel);
  }
  return out;
}

test("every page that carries the block carries the source byte for byte", () => {
  const pages = pagesWithBlock();
  assert.ok(pages.length >= 4, `only ${pages.length} pages carry the block`);
  for (const rel of pages) {
    const html = readFileSync(ROOT + rel, "utf-8").replace(/\r\n/g, "\n");
    const s = html.indexOf(START), e = html.indexOf(END);
    assert.equal(html.slice(html.indexOf("\n", s) + 1, e), SOURCE.endsWith("\n") ? SOURCE : SOURCE + "\n", rel);
  }
});

// [label, input, totalPages, options, pages, error codes]
const CASES = [
  // Valid syntax, whitespace and separators
  ["one page", "5", 10, {}, [5], []],
  ["a range", "1-3", 10, {}, [1, 2, 3], []],
  ["a range and a page", "1-3, 5", 10, {}, [1, 2, 3, 5], []],
  ["commas without spaces", "1,2,3", 10, {}, [1, 2, 3], []],
  ["semicolons", "1;2;3", 10, {}, [1, 2, 3], []],
  ["spaces as separators", "1 2 3", 10, {}, [1, 2, 3], []],
  ["spaces around items", "  1 ,  2  ", 10, {}, [1, 2], []],
  ["spaces around the dash", "1 - 3", 10, {}, [1, 2, 3], []],
  ["a space before the dash joins the range", "1 -3", 10, {}, [1, 2, 3], []],
  ["a space after the dash joins the range", "1- 3", 10, {}, [1, 2, 3], []],
  ["tabs and line breaks separate", "1" + ch(9) + "2" + ch(10) + "3" + ch(13, 10) + "4", 10, {}, [1, 2, 3, 4], []],
  ["no-break and ideographic spaces separate", "1" + ch(160) + "2" + ch(0x3000) + "3", 10, {}, [1, 2, 3], []],
  ["empty items between commas", ",1,,2,", 10, {}, [1, 2], []],
  ["leading zeros", "007, 01-03", 10, {}, [1, 2, 3, 7], []],
  ["a one-page range", "4-4", 10, {}, [4], []],
  // Duplicates and ordering
  ["sorted and unique by default", "3,1,2,3", 10, {}, [1, 2, 3], []],
  ["preserveOrder keeps the typed order, once each", "3,1,2,3", 10, { preserveOrder: true }, [3, 1, 2], []],
  ["preserveOrder with unique false keeps repeats", "3,1,2,3", 10, { preserveOrder: true, unique: false }, [3, 1, 2, 3], []],
  ["overlapping ranges merge", "1-5, 3-8", 10, {}, range(1, 8), []],
  ["overlapping ranges in typed order", "4-6, 1-5", 10, { preserveOrder: true }, [4, 5, 6, 1, 2, 3], []],
  ["overlapping ranges with repeats", "1-3, 2-5", 10, { preserveOrder: true, unique: false }, [1, 2, 3, 2, 3, 4, 5], []],
  // Reversed ranges
  ["a reversed range is the same pages", "5-2", 10, {}, [2, 3, 4, 5], []],
  ["a reversed range counts down in typed order", "5-2", 10, { preserveOrder: true }, [5, 4, 3, 2], []],
  ["a reversed range with reversed: error", "5-2", 10, { reversed: "error" }, [], ["reversed_range"]],
  ["counting down skips pages already taken", "5-2, 3, 1", 10, { preserveOrder: true }, [5, 4, 3, 2, 1], []],
  // Open-ended ranges
  ["to the last page", "8-", 10, {}, [8, 9, 10], []],
  ["from the first page", "-3", 10, {}, [1, 2, 3], []],
  ["to the last page with a space", "8 -", 10, {}, [8, 9, 10], []],
  ["open end not allowed", "8-", 10, { allowOpenEnded: false }, [], ["invalid_token"]],
  ["open start not allowed reads as negative", "-3", 10, { allowOpenEnded: false }, [], ["zero_or_negative"]],
  ["from the first page to 0", "-0", 10, {}, [], ["zero_or_negative"]],
  ["an open end past the last page", "11-", 10, {}, [], ["out_of_range"]],
  ["an open start past the last page", "-11", 10, {}, [], ["out_of_range"]],
  // Zero and negatives
  ["page 0", "0", 10, {}, [], ["zero_or_negative"]],
  ["a range from 0", "0-3", 10, {}, [], ["zero_or_negative"]],
  ["a range to 0", "3-0", 10, {}, [], ["zero_or_negative"]],
  ["a lone dash", "-", 10, {}, [], ["invalid_token"]],
  ["two dashes", "--3", 10, {}, [], ["invalid_token"]],
  // Out of range
  ["a page past the last", "11", 10, {}, [], ["out_of_range"]],
  ["a range past the last", "5-11", 10, {}, [], ["out_of_range"]],
  ["clip cuts ranges and drops pages outside", "5-11, 0, 50", 10, { outOfRange: "clip" }, range(5, 10), []],
  ["clip cuts a range from 0", "0-2", 10, { outOfRange: "clip" }, [1, 2], []],
  ["clip of only pages outside gives none, with no error", "50", 10, { outOfRange: "clip" }, [], []],
  // Huge numbers
  ["a number past MAX_SAFE_INTEGER", "99999999999999999999", 10, {}, [], ["out_of_range"]],
  ["MAX_SAFE_INTEGER + 2", "9007199254740993", 10, {}, [], ["out_of_range"]],
  ["clip with a huge end", "1-99999999999999999999", 10, { outOfRange: "clip" }, range(1, 10), []],
  ["many leading zeros", "000000000000000000005", 10, {}, [5], []],
  // Invalid tokens
  ["a letter after a number", "2a", 10, {}, [], ["invalid_token"]],
  ["a decimal", "1.5", 10, {}, [], ["invalid_token"]],
  ["three numbers with dashes", "1-3-5", 10, {}, [], ["invalid_token"]],
  ["a plus sign", "+3", 10, {}, [], ["invalid_token"]],
  ["a word", "abc", 10, {}, [], ["invalid_token"]],
  ["the good items still count", "1, x, 3", 10, {}, [1, 3], ["invalid_token"]],
  ["an emoji", "1, " + ch(0xD83D, 0xDE00), 10, {}, [1], ["invalid_token"]],
  // Non-ASCII digits and full-width forms
  ["full-width digits", ch(0xFF11, 0xFF12), 20, {}, [12], []],
  ["full-width dash and comma", ch(0xFF11, 0xFF0D, 0xFF13, 0xFF0C, 0xFF15), 10, {}, [1, 2, 3, 5], []],
  ["en dash", "1" + ch(0x2013) + "3", 10, {}, [1, 2, 3], []],
  ["em dash and minus sign", "1" + ch(0x2014) + "2, 4" + ch(0x2212) + "5", 10, {}, [1, 2, 4, 5], []],
  ["ideographic comma", "1" + ch(0x3001) + "2", 10, {}, [1, 2], []],
  ["Arabic-Indic digits are not read", ch(0x0663), 10, {}, [], ["invalid_token"]],
  ["superscript digits are not read", ch(0xB2), 10, {}, [], ["invalid_token"]],
  // Empty input
  ["empty", "", 10, {}, [], ["empty"]],
  ["only spaces", "   ", 10, {}, [], ["empty"]],
  ["only separators", ",, ;", 10, {}, [], ["empty"]],
  // totalPages 0 and 1
  ["a page of a 0-page document", "1", 0, {}, [], ["out_of_range"]],
  ["empty on a 0-page document", "", 0, {}, [], ["empty"]],
  ["clip on a 0-page document", "1-5", 0, { outOfRange: "clip" }, [], []],
  ["the one page", "1", 1, {}, [1], []],
  ["open end on a 1-page document", "1-", 1, {}, [1], []],
  ["page 2 of 1", "2", 1, {}, [], ["out_of_range"]],
  // Keywords
  ["keywords off by default", "odd", 7, {}, [], ["invalid_token"]],
  ["odd", "odd", 7, { allowKeywords: true }, [1, 3, 5, 7], []],
  ["even", "even", 7, { allowKeywords: true }, [2, 4, 6], []],
  ["last", "last", 7, { allowKeywords: true }, [7], []],
  ["a range to last", "3-last", 7, { allowKeywords: true }, range(3, 7), []],
  ["from last counting down", "last-5", 7, { allowKeywords: true, preserveOrder: true }, [7, 6, 5], []],
  ["Spanish impares", "impares", 6, { allowKeywords: true }, [1, 3, 5], []],
  ["upper case PARES", "PARES", 6, { allowKeywords: true }, [2, 4, 6], []],
  ["Spanish ultima with and without the accent", "ultima, " + ch(0xDA) + "ltima", 4, { allowKeywords: true }, [4], []],
  ["even on a 1-page document", "even", 1, { allowKeywords: true }, [], ["out_of_range"]],
  ["even on a 1-page document, clipped", "even", 1, { allowKeywords: true, outOfRange: "clip" }, [], []],
  ["last on a 0-page document", "last", 0, { allowKeywords: true }, [], ["out_of_range"]],
  ["odd then a range, in typed order", "odd, 1-4", 7, { allowKeywords: true, preserveOrder: true }, [1, 3, 5, 7, 2, 4], []],
  ["odd twice", "odd, odd", 5, { allowKeywords: true, preserveOrder: true, unique: false }, [1, 3, 5, 1, 3, 5], []],
  ["a custom keyword table", "ungerade, odd", 5, { allowKeywords: true, keywords: { odd: ["ungerade"] } }, [1, 3, 5], ["invalid_token"]],
  ["odd is not a range end", "1-odd", 5, { allowKeywords: true }, [], ["invalid_token"]],
  // all / todas: every page, as the span 1 to the last page
  ["all off by default", "all", 5, {}, [], ["invalid_token"]],
  ["all", "all", 5, { allowKeywords: true }, range(1, 5), []],
  ["upper case ALL and Todas", "ALL, Todas", 5, { allowKeywords: true }, range(1, 5), []],
  ["full-width all", ch(0xFF41, 0xFF4C, 0xFF4C), 3, { allowKeywords: true }, [1, 2, 3], []],
  ["todas with an accent is not a keyword", "t" + ch(0xF3) + "das", 3, { allowKeywords: true }, [], ["invalid_token"]],
  ["all is not a range end", "1-all", 5, { allowKeywords: true }, [], ["invalid_token"]],
  ["all on a 0-page document", "all", 0, { allowKeywords: true }, [], ["out_of_range"]],
  ["all on a 0-page document, clipped", "all", 0, { allowKeywords: true, outOfRange: "clip" }, [], []],
  ["all then a page, typed order with repeats", "all, 2", 3, SPLIT, [1, 2, 3, 2], []],
  ["all twice, sorted and unique", "all, todas, 2", 4, { allowKeywords: true }, range(1, 4), []],
  // Keyword combinations, with Split PDF's options
  ["Split: 1-5, last", "1-5, last", 10, SPLIT, [1, 2, 3, 4, 5, 10], []],
  ["Split: 5-last", "5-last", 10, SPLIT, range(5, 10), []],
  ["Split: last-3 counts down", "last-3", 10, SPLIT, [10, 9, 8, 7, 6, 5, 4, 3], []],
  ["Split: odd even", "odd even", 10, SPLIT, [1, 3, 5, 7, 9, 2, 4, 6, 8, 10], []],
  ["Split: 1-10 odd is 1-10 plus the odd pages", "1-10 odd", 10, SPLIT, range(1, 10).concat([1, 3, 5, 7, 9]), []],
  ["Split: 10,000 pages is the limit", "1-5000, 1-5000", 5000, SPLIT, range(1, 5000).concat(range(1, 5000)), []],
  ["Split: 10,001 pages is too many", "1-5000, 1-5000, 1", 5000, SPLIT, [], ["too_many"]],
  // maxItems
  ["too many pages in typed order", "1-10, 1-10", 20, { preserveOrder: true, unique: false, maxItems: 15 }, [], ["too_many"]],
  ["too many pages sorted", "1-5", 10, { maxItems: 3 }, [], ["too_many"]],
  ["exactly maxItems pages", "1-5", 10, { maxItems: 5 }, range(1, 5), []],
];

for (const [label, input, total, options, pages, errs] of CASES) {
  test(`parse: ${label}`, () => {
    const r = parse(input, total, options);
    assert.deepEqual(r.pages, pages);
    assert.deepEqual(codes(r), errs);
    assert.equal(r.ok, errs.length === 0);
  });
}

test("parse: errors carry the token as typed and its position", () => {
  const input = "1, 2a , 0-3; 99, " + ch(0xFF11, 0xFF12) + "x";
  const r = parse(input, 10);
  assert.deepEqual(r.errors, [
    { code: "invalid_token", token: "2a", start: 3, end: 5 },
    { code: "zero_or_negative", token: "0-3", start: 8, end: 11 },
    { code: "out_of_range", token: "99", start: 13, end: 15 },
    { code: "invalid_token", token: ch(0xFF11, 0xFF12) + "x", start: 17, end: 20 },
  ]);
  for (const e of r.errors) assert.equal(input.slice(e.start, e.end), e.token);
  assert.deepEqual(r.pages, [1]);
});

test("parse: empty covers the whole input", () => {
  assert.deepEqual(parse(" ; ", 3).errors, [{ code: "empty", token: " ; ", start: 0, end: 3 }]);
});

test("parse: too_many in typed order names the item that passed the limit", () => {
  const r = parse("1-10, 1-10", 20, { preserveOrder: true, unique: false, maxItems: 15 });
  assert.deepEqual(r.errors, [{ code: "too_many", token: "1-10", start: 6, end: 10 }]);
});

test("parse: bad arguments throw a TypeError", () => {
  assert.throws(() => parse("1", -1), TypeError);
  assert.throws(() => parse("1", 1.5), TypeError);
  assert.throws(() => parse("1", Number.MAX_SAFE_INTEGER + 1), TypeError);
  assert.throws(() => parse(1, 10), TypeError);
  assert.throws(() => parse("1", 10, { sorted: true }), TypeError);
});

test("the keyword table has the English and Spanish words", () => {
  assert.deepEqual(Object.keys(ORISOD_RANGE_KEYWORDS), ["odd", "even", "last", "all"]);
  assert.deepEqual(ORISOD_RANGE_KEYWORDS.all, ["all", "todas"]);
  for (const words of Object.values(ORISOD_RANGE_KEYWORDS)) assert.ok(words.length >= 2);
});

test("format: runs and single pages", () => {
  assert.equal(format([1, 2, 3, 5, 8, 9]), "1-3, 5, 8-9");
  assert.equal(format([]), "");
  assert.equal(format([4]), "4");
  assert.equal(format([9, 1, 2, 2, 3]), "1-3, 9");
  assert.equal(format([5, 4, 3, 9], { preserveOrder: true }), "5-3, 9");
  assert.equal(format([3, 2, 2, 1], { preserveOrder: true }), "3-2, 2-1");
});

test("format: bad pages throw a TypeError", () => {
  assert.throws(() => format([0]), TypeError);
  assert.throws(() => format([1.5]), TypeError);
  assert.throws(() => format("1-3"), TypeError);
});

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("round trip: parse(format(pages)) gives the sorted unique pages", () => {
  const rand = rng(1);
  for (let n = 0; n < 300; n++) {
    const total = 1 + Math.floor(rand() * 60);
    const pages = Array.from({ length: 1 + Math.floor(rand() * 40) }, () => 1 + Math.floor(rand() * total));
    const r = parse(format(pages), total);
    assert.ok(r.ok, format(pages));
    assert.deepEqual(r.pages, Array.from(new Set(pages)).sort((a, b) => a - b));
  }
});

test("round trip: in typed order with repeats", () => {
  const rand = rng(2);
  for (let n = 0; n < 300; n++) {
    const total = 1 + Math.floor(rand() * 30);
    const pages = Array.from({ length: 1 + Math.floor(rand() * 30) }, () => 1 + Math.floor(rand() * total));
    const text = format(pages, { preserveOrder: true });
    assert.deepEqual(parse(text, total, { preserveOrder: true, unique: false }).pages, pages, text);
  }
});

// Performance: every case must finish well under 100 ms (median of 3 runs).
const BIG = 100000;
const repeat = (s) => s.repeat(Math.ceil(BIG / s.length)).slice(0, BIG);
const singles = range(1, 10000).join(",");
const PERF = [
  ["1-10000 on 10,000 pages", "1-10000", 10000, {}],
  ["10,000 single pages", singles, 10000, {}],
  ["10,000 single pages in typed order", singles, 10000, { preserveOrder: true }],
  ["100,000 characters of 1-10000, sorted", repeat("1-10000,"), 10000, {}],
  ["100,000 characters of 1-10000, typed order", repeat("1-10000,"), 10000, { preserveOrder: true }],
  ["100,000 characters of 10000-1, typed order", repeat("10000-1,"), 10000, { preserveOrder: true }],
  ["100,000 characters of 1-10000 with repeats (too_many)", repeat("1-10000,"), 10000, { preserveOrder: true, unique: false }],
  ["100,000 letters", "a".repeat(BIG), 10000, {}],
  ["100,000 dashes", "-".repeat(BIG), 10000, {}],
  ["a 100,000-digit number", "9".repeat(BIG), 10000, {}],
  ["100,000 characters of 1 - ", repeat("1 - "), 10000, {}],
  ["100,000 characters of odd, typed order", repeat("odd, "), 10000, { allowKeywords: true, preserveOrder: true }],
  ["100,000 characters of odd, with repeats", repeat("odd, "), 10000, { allowKeywords: true, preserveOrder: true, unique: false }],
  ["100,000 full-width characters", repeat(ch(0xFF11, 0xFF0D, 0xFF19, 0xFF0C)), 10000, {}],
  ["100,000 commas", ",".repeat(BIG), 10000, {}],
];
for (const [label, input, total, options] of PERF) {
  test(`performance: ${label}`, (t) => {
    const times = [];
    for (let n = 0; n < 3; n++) {
      const t0 = performance.now();
      parse(input, total, options);
      times.push(performance.now() - t0);
    }
    const median = times.sort((a, b) => a - b)[1];
    t.diagnostic(`median ${median.toFixed(1)} ms`);
    assert.ok(median < 100, `${median.toFixed(1)} ms`);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Differential tests against the tools' own parsers (Delete PDF Pages' and PDF to JPG's from before they
// adopted the helper).
//
// "Accepted" by an old parser means: Split PDF and Rotate PDF don't throw (and Split's caller had a
// non-empty input), PDF to JPG writes no error, and Delete PDF Pages, which ignores what it can't read,
// matched every item with its own two patterns. For those inputs the helper, with the options that tool
// would use, must give ok and the same pages:
//   Delete PDF Pages  { outOfRange: "clip" }: sorted pages (it keeps a set and clips to the document)
//   Split PDF         SPLIT: typed order, repeats kept (keywords on, at most 10,000 pages)
//   Rotate PDF        { preserveOrder: true }: typed order, once each
//   PDF to JPG        { outOfRange: "clip" }: the pages it ticks, which can only be pages of the document
// except for these intentional differences (each is checked below):
const DIFFERENCES = {
  noItems: "Input with only commas and spaces (\",\", \" , \"): the old parsers accept it and select no page " +
    "(Split PDF would then build an empty PDF); the helper gives empty. Delete PDF Pages, Rotate PDF and " +
    "PDF to JPG also accept \"\": Rotate PDF's caller turns it into every page, and the others do nothing; " +
    "the helper gives empty and the page keeps that choice.",
  semicolon: "A semicolon inside an item (\"1;3\"): parseInt read the number before it and dropped the rest " +
    "(\"1;3\" was page 1, \"1;3-5\" was 1-5); the helper reads a semicolon as a separator.",
  spaceBetweenNumbers: "Numbers separated only by spaces (\"1 3\", \"1 2-4\", \"1-12 32-\"): parseInt read the " +
    "first number and dropped the rest; the helper reads spaces as separators.",
  trailingCharacters: "A number followed by other characters (\"2a\", \"1.5\", \"+3\", \"1e3\", \"3x-5\"): " +
    "parseInt read the leading number and dropped the rest; the helper gives invalid_token.",
  extraDashes: "More than one dash (\"1-3-5\"): split('-') kept the first two numbers; the helper gives invalid_token.",
};
const DIFFERENCE_EXAMPLES = [
  // [tool, input, total, old pages, new codes, new pages]
  ["split", ",", 10, [], ["empty"], []],
  ["rotate", "", 4, [1, 2, 3, 4], ["empty"], []],
  ["delete", " , ", 10, [], ["empty"], []],
  ["split", "1;3-5", 10, [1, 2, 3, 4, 5], [], [1, 3, 4, 5]],
  ["rotate", "1 3", 10, [1], [], [1, 3]],
  ["split", "2a", 10, [2], ["invalid_token"], []],
  ["jpg", "1.5", 10, [1], ["invalid_token"], []],
  ["rotate", "+3", 10, [3], ["invalid_token"], []],
  ["split", "1-3-5", 10, [1, 2, 3], ["invalid_token"], []],
];

function cutFunction(html, start) {
  const s = html.indexOf(start);
  assert.ok(s >= 0, `missing ${start}`);
  let depth = 0;
  for (let i = html.indexOf("{", s); i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) return html.slice(s, i + 1);
  }
  throw new Error("unbalanced " + start);
}
function oldParsers(prefix) {
  const read = (tool) => readFileSync(ROOT + prefix + tool + "/index.html", "utf-8").replace(/\r\n/g, "\n");
  const lang = prefix ? "es" : "en";
  const rotate = new Function(cutFunction(read("rotate-pdf"), "function parsePageSelection(") + "\nreturn parsePageSelection;")();
  return {
    // Each returns { accepted, pages } as the page would use them.
    delete(raw, total) {
      const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
      const accepted = parts.every((p) => /^\d+$/.test(p) || /^(\d+)\s*-\s*(\d+)$/.test(p));
      return { accepted, pages: Array.from(oldDeleteSet(raw, total)).map((i) => i + 1).sort((x, y) => x - y) };
    },
    split(raw, total) {
      if (!raw.trim()) return { accepted: false };
      try { return { accepted: true, pages: oldSplitRanges(raw.trim(), total, lang) }; } catch { return { accepted: false }; }
    },
    rotate(raw, total) {
      try { return { accepted: true, pages: rotate(raw, total) }; } catch { return { accepted: false }; }
    },
    jpg(raw, total) {
      raw = raw.trim();
      if (!raw) return { accepted: true, pages: [] };
      const { pages: set, error } = oldJpgSelection(raw, total, "en");
      return { accepted: !error, pages: Array.from(set).filter((p) => p <= total).sort((x, y) => x - y) };
    },
  };
}
const NEW_OPTIONS = { delete: { outOfRange: "clip" }, split: { preserveOrder: true, unique: false, allowKeywords: true, outOfRange: "error", maxItems: 10000 }, rotate: { preserveOrder: true }, jpg: { outOfRange: "clip" } };

// Which listed difference an old-accepted input falls under, or null when the helper must match exactly.
function difference(raw) {
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return "noItems";
  if (parts.every((p) => /^\d+$/.test(p) || /^\d+\s*-\s*\d+$/.test(p))) return null;
  if (parts.some((p) => p.includes(";"))) return "semicolon";
  if (parts.some((p) => /[^\d\s-]/.test(p))) return "trailingCharacters";
  if (parts.some((p) => /\d\s+\d/.test(p))) return "spaceBetweenNumbers";
  assert.ok(parts.some((p) => (p.match(/-/g) || []).length > 1), `unclassified input ${JSON.stringify(raw)}`);
  return "extraDashes";
}

const FIXED_INPUTS = ["1-3, 5", "2, 4, 7-9", "1-2, 4", "1,1", "3-3", " 1 - 3 ", "12", "1-12", "5-2", "0", "0-3", "13",
  "5-13", ",", "", "  ", "2a", "1.5", "+3", "1-3-5", "1 2", "1;2", "007", "01-03", "1,2,3,4,5,6,7,8,9,10,11,12",
  "12-1", "6-6, 6", "3 -5", "3- 5", "1" + ch(160) + "-" + ch(160) + "4", ch(0xFEFF) + "2", "1e3", "3x-5", "-3", "3-", " , 2 , "];
const PIECES = ["0", "1", "2", "3", "5", "9", "12", "007", "-", "-", ",", ",", " ", " ", ";", "a", ".", "+", ch(160), ch(9), "e"];
function fuzzInputs(seed, n) {
  const rand = rng(seed), out = [];
  while (out.length < n) {
    let s = "";
    const len = 1 + Math.floor(rand() * 8);
    for (let i = 0; i < len; i++) s += PIECES[Math.floor(rand() * PIECES.length)];
    if (!/\d{5,}/.test(s)) out.push(s); // keeps the old parsers' loops short
  }
  return out;
}

for (const prefix of ["", "es/"]) {
  const old = oldParsers(prefix);
  for (const tool of ["delete", "split", "rotate", "jpg"]) {
    test(`differential (${prefix || "en/"}${tool}): the helper accepts what the old parser accepts, with the same pages`, (t) => {
      let same = 0;
      const seen = {};
      for (const total of [0, 1, 5, 12]) {
        for (const raw of FIXED_INPUTS.concat(fuzzInputs(total + 7, 3000))) {
          const o = old[tool](raw, total);
          if (!o.accepted) continue;
          const kind = difference(raw);
          const r = parse(raw, total, NEW_OPTIONS[tool]);
          if (kind === null) {
            assert.ok(r.ok, `${tool} ${JSON.stringify(raw)} on ${total} pages: ${JSON.stringify(r.errors)}`);
            assert.deepEqual(r.pages, o.pages, `${tool} ${JSON.stringify(raw)} on ${total} pages`);
            same++;
            continue;
          }
          seen[kind] = (seen[kind] || 0) + 1;
          if (kind === "noItems") assert.deepEqual(codes(r), ["empty"], JSON.stringify(raw));
          if (kind === "trailingCharacters" || kind === "extraDashes") assert.ok(codes(r).includes("invalid_token"), JSON.stringify(raw));
        }
      }
      t.diagnostic(`${same} inputs give the same pages; listed differences seen: ${JSON.stringify(seen)}`);
      assert.ok(same >= 100, `only ${same} inputs compared`);
    });
  }
  test(`differential (${prefix || "en/"}): every listed difference, with an example`, () => {
    for (const [tool, raw, total, oldPages, newCodes, newPages] of DIFFERENCE_EXAMPLES) {
      const o = old[tool](raw, total);
      assert.ok(o.accepted, `${tool} ${JSON.stringify(raw)} is accepted today`);
      const r = parse(raw, total, NEW_OPTIONS[tool]);
      if (tool === "rotate" && raw === "") assert.deepEqual(o.pages, oldPages); // the caller's "every page"
      else assert.deepEqual(o.pages, oldPages, `${tool} ${JSON.stringify(raw)} today`);
      assert.deepEqual(codes(r), newCodes, `${tool} ${JSON.stringify(raw)} with the helper`);
      assert.deepEqual(r.pages, newPages);
    }
    assert.deepEqual(new Set(DIFFERENCE_EXAMPLES.map(([, raw]) => difference(raw))), new Set(Object.keys(DIFFERENCES)));
  });
}
