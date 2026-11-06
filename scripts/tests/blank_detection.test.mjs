// Unit tests for the blank-page detection of Remove Blank Pages from PDF (/remove-blank-pages/, EN and ES).
//
// Run: node --test scripts/tests/   (CI: the "smoke" job of check-smoke, before the browser tests)
//
// They run the exact text the pages ship: the block between "// BEGIN detection" and "// END detection" is cut out
// of each page, both copies must be identical, and that text is evaluated here with no DOM. Every picture is built
// in the test (RGBA arrays), so there are no fixture files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PAGES = ["remove-blank-pages/index.html", "es/remove-blank-pages/index.html"];

function detectionBlock(html) {
  const start = html.indexOf("// BEGIN detection"), end = html.indexOf("// END detection");
  assert.ok(start >= 0 && end > start, "the page has no // BEGIN detection ... // END detection block");
  assert.equal(html.indexOf("// BEGIN detection", start + 1), -1, "the page has two detection blocks");
  return html.slice(start, end + "// END detection".length);
}
const blocks = PAGES.map((p) => detectionBlock(readFileSync(ROOT + p, "utf-8")));
const load = (text) => new Function(`${text}\nreturn { detectBlankPage, BLANK_SENSITIVITY, BLANK_LEVELS, BLANK_PAPER_SHARE, BLANK_MIN_PAPER, BLANK_TRACE };`)();
const D = load(blocks[0]);
const S = D.BLANK_SENSITIVITY;

// A width x height page filled with one colour; draw() then paints on it.
function page(width, height, [r, g, b, a] = [255, 255, 255, 255]) {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; }
  return { px, width, height };
}
function rect(pg, x0, y0, w, h, [r, g, b, a = 255]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * pg.width + x) * 4;
    pg.px[i] = r; pg.px[i + 1] = g; pg.px[i + 2] = b; pg.px[i + 3] = a;
  }
  return pg;
}
// Same small, seeded random numbers on every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const run = (pg, level) => D.detectBlankPage(pg.px, pg.width, pg.height, S[level]);
const levels = (pg) => Object.fromEntries(D.BLANK_LEVELS.map((l) => [l, run(pg, l).blank]));
// The thumbnail size the page renders for detection (240 px wide, US Letter proportions).
const W = 240, H = 311;

test("the EN and ES pages ship the same detection text", () => {
  assert.equal(blocks[0], blocks[1]);
});

test("the block is pure: no DOM, canvas or network", () => {
  for (const word of ["document", "window", "canvas", "getContext", "fetch", "XMLHttpRequest", "localStorage"]) {
    assert.ok(!new RegExp(`\\b${word}\\b`).test(blocks[0].replace(/^\s*\/\/.*$/gm, "")), `the detection code uses ${word}`);
  }
});

test("sensitivities: three levels, each at least as lenient as the one before", () => {
  assert.deepEqual(D.BLANK_LEVELS, ["conservative", "balanced", "aggressive"]);
  for (let i = 1; i < D.BLANK_LEVELS.length; i++) {
    const a = S[D.BLANK_LEVELS[i - 1]], b = S[D.BLANK_LEVELS[i]];
    assert.ok(b.inkDelta >= a.inkDelta && b.maxInk >= a.maxInk && b.margin >= a.margin, `${D.BLANK_LEVELS[i]} is stricter than ${D.BLANK_LEVELS[i - 1]} somewhere`);
  }
});

test("a fully white page is blank at every level", () => {
  assert.deepEqual(levels(page(W, H)), { conservative: true, balanced: true, aggressive: true });
  assert.equal(run(page(W, H), "conservative").paper, 255);
});

test("an off-white page is measured against its own paper", () => {
  const pg = page(W, H, [240, 236, 226, 255]);
  const r = run(pg, "conservative");
  assert.ok(r.blank && r.paper < 240 && r.paper > 230, JSON.stringify(r));
});

test("a transparent background counts as white paper", () => {
  const r = run(page(W, H, [0, 0, 0, 0]), "conservative");
  assert.equal(r.paper, 255);
  assert.ok(r.blank);
  // Half-transparent black is mid grey, a dark page.
  assert.equal(run(page(W, H, [0, 0, 0, 128]), "aggressive").reason, "dark-page");
});

test("a single dark pixel doesn't stop a page being blank", () => {
  const pg = rect(page(W, H), 120, 150, 1, 1, [0, 0, 0]);
  assert.deepEqual(levels(pg), { conservative: true, balanced: true, aggressive: true });
  assert.equal(run(pg, "conservative").marks, 1);
});

test("a small page number: kept at Conservative, blank from Balanced", () => {
  // Two digits at the foot of the page: 70 dark pixels (5 x 7 each).
  const pg = rect(rect(page(W, H), 113, 290, 5, 7, [20, 20, 20]), 121, 290, 5, 7, [20, 20, 20]);
  assert.deepEqual(levels(pg), { conservative: false, balanced: true, aggressive: true });
});

test("a faint header: kept at Conservative, blank from Balanced", () => {
  // A light grey line (35 levels darker than the paper) across the top, inside the content area.
  const pg = rect(page(W, H), 30, 20, 180, 3, [220, 220, 220]);
  assert.deepEqual(levels(pg), { conservative: false, balanced: true, aggressive: true });
});

test("a light signature is never blank", () => {
  // Strokes 90 levels darker than the paper over about 600 pixels.
  const pg = page(W, H);
  for (let x = 40; x < 140; x++) rect(pg, x, 240 + Math.round(6 * Math.sin(x / 6)), 1, 6, [165, 165, 175]);
  assert.deepEqual(levels(pg), { conservative: false, balanced: false, aggressive: false });
});

test("light random noise is still blank; heavy noise isn't", () => {
  const light = page(W, H), heavy = page(W, H), r = rng(7);
  for (let i = 0; i < light.px.length; i += 4) {
    const n = Math.round((r() - 0.5) * 20), m = Math.round((r() - 0.5) * 160);
    for (let c = 0; c < 3; c++) { light.px[i + c] = 245 + n; heavy.px[i + c] = 200 + m; }
  }
  assert.deepEqual(levels(light), { conservative: true, balanced: true, aggressive: true });
  assert.deepEqual(levels(heavy), { conservative: false, balanced: false, aggressive: false });
});

test("a scanner shadow along the edge: kept at Conservative, ignored from Balanced", () => {
  // A dark band 3% of the width down the left edge.
  const pg = rect(page(W, H), 0, 0, Math.round(W * 0.03), H, [90, 90, 90]);
  assert.deepEqual(levels(pg), { conservative: false, balanced: true, aggressive: true });
});

test("a pale watermark: kept at Conservative, blank from Balanced", () => {
  // A large light-grey block (30 levels darker) over 5% of the page.
  const pg = rect(page(W, H), 60, 120, 60, 62, [225, 225, 225]);
  assert.deepEqual(levels(pg), { conservative: false, balanced: true, aggressive: true });
});

test("a dark or coloured page is never blank", () => {
  assert.equal(run(page(W, H, [30, 30, 60, 255]), "aggressive").reason, "dark-page");
  assert.equal(run(page(W, H, [120, 120, 120, 255]), "aggressive").blank, false);
  // Exactly at the minimum paper level it counts as paper.
  const at = D.BLANK_MIN_PAPER;
  assert.equal(run(page(W, H, [at, at, at, 255]), "conservative").blank, true);
  assert.equal(run(page(W, H, [at - 1, at - 1, at - 1, 255]), "conservative").reason, "dark-page");
});

test("different dimensions: 1 x 1, landscape, tall and odd sizes", () => {
  assert.ok(run(page(1, 1), "conservative").blank);
  assert.ok(run(page(1, 1, [0, 0, 0, 255]), "conservative").reason === "dark-page");
  assert.ok(run(page(400, 300), "conservative").blank);
  assert.ok(run(page(97, 1201), "balanced").blank);
  assert.ok(!run(rect(page(400, 300), 50, 50, 300, 40, [0, 0, 0]), "aggressive").blank);
});

test("exactly at each threshold", () => {
  for (const level of D.BLANK_LEVELS) {
    const { inkDelta, maxInk, margin } = S[level];
    // 100 x 100 page: limit = floor(maxInk * 10000) marks.
    const limit = Math.floor(maxInk * 10000 + 1e-9);
    const mark = 255 - inkDelta;
    const inside = Math.floor(100 * margin);
    const marks = (n, value) => {
      const pg = page(100, 100);
      for (let k = 0; k < n; k++) rect(pg, inside + (k % 40), inside + Math.floor(k / 40), 1, 1, [value, value, value]);
      return run(pg, level);
    };
    // A pixel exactly inkDelta darker than the paper is a mark; one level lighter isn't.
    assert.equal(marks(1, mark).marks, 1, `${level}: a pixel exactly inkDelta darker isn't a mark`);
    assert.equal(marks(1, mark + 1).marks, 0, `${level}: a pixel lighter than inkDelta is a mark`);
    // Exactly `limit` marks is blank; one more isn't.
    assert.equal(marks(limit, 0).blank, true, `${level}: exactly ${limit} marks isn't blank`);
    assert.equal(marks(limit + 1, 0).blank, false, `${level}: ${limit + 1} marks is blank`);
    // The margin: a mark in the last ignored column doesn't count, one in the first counted column does.
    const edge = (x) => run(rect(page(100, 100), x, 50, 1, 1, [0, 0, 0]), level).marks;
    if (inside > 0) assert.equal(edge(inside - 1), 0, `${level}: a mark inside the margin counts`);
    assert.equal(edge(inside), 1, `${level}: a mark just inside the content area doesn't count`);
  }
  // The paper level: BLANK_PAPER_SHARE of the pixels at or under it.
  const pg = page(10, 10);
  for (let k = 0; k < 90; k++) pg.px[k * 4] = pg.px[k * 4 + 1] = pg.px[k * 4 + 2] = 230;
  assert.equal(run(pg, "conservative").paper, 230);
  pg.px[89 * 4] = pg.px[89 * 4 + 1] = pg.px[89 * 4 + 2] = 255;
  assert.equal(run(pg, "conservative").paper, 255);
});

test("the trace setting sees any visible mark, and nothing on an empty or evenly tinted page", () => {
  const trace = (pg) => D.detectBlankPage(pg.px, pg.width, pg.height, D.BLANK_TRACE).marks;
  assert.equal(trace(page(W, H)), 0);
  assert.equal(trace(page(W, H, [236, 236, 236, 255])), 0);
  assert.equal(trace(page(W, H, [0, 0, 0, 0])), 0);
  assert.equal(trace(rect(page(W, H), 0, 0, 1, 1, [246, 246, 246])), 1, "a pixel 9 levels darker in the corner isn't seen");
  assert.equal(trace(rect(page(W, H), 0, 0, 1, 1, [248, 248, 248])), 0, "a pixel 7 levels darker is seen");
});

test("monotonic: raising the sensitivity never removes a page from the blank set", () => {
  const r = rng(2026);
  let checked = 0, flips = 0;
  for (let n = 0; n < 400; n++) {
    const w = 40 + Math.floor(r() * 200), h = 40 + Math.floor(r() * 260);
    const paper = 200 + Math.floor(r() * 56);
    const pg = page(w, h, [paper, paper, paper, 255]);
    const shapes = Math.floor(r() * 6);
    for (let s = 0; s < shapes; s++) {
      const v = Math.floor(r() * 256), x = Math.floor(r() * w), y = Math.floor(r() * h);
      rect(pg, x, y, Math.min(w - x, 1 + Math.floor(r() * 12)), Math.min(h - y, 1 + Math.floor(r() * 12)), [v, v, v]);
    }
    const got = D.BLANK_LEVELS.map((l) => run(pg, l).blank);
    for (let i = 1; i < got.length; i++) assert.ok(!got[i - 1] || got[i], `page ${n}: blank at ${D.BLANK_LEVELS[i - 1]} but not at ${D.BLANK_LEVELS[i]}`);
    if (got[0] !== got[2]) flips++;
    checked++;
  }
  // The generator really produces pages that change with the level, so the check isn't vacuous.
  assert.ok(flips > 20, `only ${flips} of ${checked} pages changed between levels`);
});

test("reproducible: the same input gives the same answer, and the input isn't changed", () => {
  const pg = rect(page(W, H), 100, 100, 20, 3, [200, 200, 200]);
  const copy = new Uint8ClampedArray(pg.px);
  assert.deepEqual(run(pg, "balanced"), run(pg, "balanced"));
  assert.deepEqual(pg.px, copy);
});

test("bad input is refused", () => {
  assert.throws(() => D.detectBlankPage(new Uint8ClampedArray(4), 0, 1, S.conservative), RangeError);
  assert.throws(() => D.detectBlankPage(new Uint8ClampedArray(4), 2, 1, S.conservative), RangeError);
  assert.throws(() => D.detectBlankPage(new Uint8ClampedArray(8), 2, 1, { inkDelta: 10, maxInk: 0, margin: 0.5 }), RangeError);
  assert.throws(() => D.detectBlankPage(new Uint8ClampedArray(8), 2, 1, null), RangeError);
});

test("a test that must fail: a reordered sensitivity breaks monotonicity", () => {
  // Proves the monotonic test can see a regression: with Balanced made stricter than Conservative, some page flips.
  const broken = { ...S, balanced: { ...S.balanced, inkDelta: 10 } };
  const pg = rect(page(W, H), 30, 20, 180, 3, [240, 240, 240]);
  const c = D.detectBlankPage(pg.px, W, H, broken.conservative).blank, b = D.detectBlankPage(pg.px, W, H, broken.balanced).blank;
  assert.ok(c && !b, "the broken order didn't produce a non-monotonic page");
});
