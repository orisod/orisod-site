#!/usr/bin/env node
/**
 * Prove that the Orisod privacy patch in assets/goatcounter/count.js keeps URL
 * parameters in the browser, and that the site behaves exactly as before.
 *
 * Local only (not in CI, not shipped to any page). Run it after any change to
 * count.js or to how the site search uses the URL:
 *
 *   node scripts/test_goatcounter_privacy.js [--upstream PATH]
 *
 * How it works: a headless Chromium loads the pages as https://orisod.com/...,
 * but every orisod.com request is answered from the local files (unmatched paths
 * get 404.html with a 404 status, like GitHub Pages). Because the page really is
 * on orisod.com, count.js runs exactly as in production (canonical URL, no
 * localhost filter), so no allow_local setting is needed anywhere. The counting
 * request to orisod.goatcounter.com is captured and answered locally; nothing
 * leaves the computer. Any other outside request is blocked and reported.
 *
 * It checks:
 *   (a) /tools/?search=passport (and ?q=, the nav search box and the homepage
 *       search) send no "passport" in any field
 *   (b) utm_campaign / utm_source / ref links still record the campaign
 *   (c) unknown parameters never leave the browser, including through the
 *       referrer on the next page and the path of the 404 page
 *   (d) search, filtering and navigation work, with no console errors
 * With --upstream PATH (an unpatched count.js, e.g. a fresh download of
 * https://gc.zgo.at/count.js), it also runs everything with that file and checks
 * that upstream does leak (so the test can catch a leak) and that every visible
 * result is identical with both files (so the patch changes nothing visible).
 *
 * It also prints every field sent for three sample pages.
 */
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SITE = "https://orisod.com";
const ENDPOINT = "https://orisod.goatcounter.com/count";
const SECRETS = ["passport", "secret"];
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

const args = process.argv.slice(2);
const upstreamPath = args.includes("--upstream") ? args[args.indexOf("--upstream") + 1] : null;

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

// One browser context per scenario: fresh storage, its own captured requests.
async function newSession(browser, countJs) {
  const context = await browser.newContext({ locale: "en-US" });
  const s = { context, hits: [], blocked: [], errors: [] };
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(ENDPOINT)) {
      s.hits.push({ url, headers: await req.allHeaders() });
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.startsWith(SITE + "/")) {
      if (countJs && new URL(url).pathname === "/assets/goatcounter/count.js")
        return route.fulfill({ status: 200, body: countJs, contentType: MIME[".js"] });
      return route.fulfill(await localFile(url));
    }
    s.blocked.push(url);
    return route.abort();
  });
  s.page = await context.newPage();
  s.page.on("pageerror", (e) => s.errors.push("page error: " + e.message));
  s.page.on("console", (m) => {
    // A 404 page logs its own 404 status as a console error; that's the page working.
    if (m.type() === "error" && !/status of 404/.test(m.text())) s.errors.push("console error: " + m.text());
  });
  return s;
}

async function waitForHits(s, n) {
  for (let i = 0; i < 100 && s.hits.length < n; i++) await s.page.waitForTimeout(50);
  if (s.hits.length < n) throw new Error(`expected ${n} counting request(s), got ${s.hits.length}`);
}

const fields = (hit) => Object.fromEntries(new URL(hit.url).searchParams);
const visibleCards = (page) => page.evaluate(() => [...document.querySelectorAll("a.tool-card")].filter((a) => a.offsetParent !== null).length);
const searchBox = (page) => page.evaluate(() => { const b = document.getElementById("toolSearch"); return b && { value: b.value, focused: document.activeElement === b }; });

// Each scenario returns what a visitor sees, so the patched and upstream runs can be compared.
const SCENARIOS = [
  { name: "/tools/?search=passport", expectHits: 1, run: async (s) => {
      await s.page.goto(SITE + "/tools/?search=passport"); await waitForHits(s, 1);
      return { url: s.page.url(), box: await searchBox(s.page), cards: await visibleCards(s.page) };
    } },
  { name: "/tools/?search=merge (filtering still works)", expectHits: 1, run: async (s) => {
      await s.page.goto(SITE + "/tools/?search=merge"); await waitForHits(s, 1);
      return { url: s.page.url(), box: await searchBox(s.page), cards: await visibleCards(s.page) };
    } },
  { name: "/tools/?q=passport (homepage's older form)", expectHits: 1, run: async (s) => {
      await s.page.goto(SITE + "/tools/?q=passport"); await waitForHits(s, 1);
      return { url: s.page.url(), box: await searchBox(s.page), cards: await visibleCards(s.page) };
    } },
  { name: "nav search box on a tool page, typing passport", expectHits: 2, run: async (s) => {
      await s.page.goto(SITE + "/compress-image/"); await waitForHits(s, 1);
      await s.page.click("#navSearchBtn"); await s.page.fill("#navSearchInput", "passport");
      await Promise.all([s.page.waitForURL("**/tools/**"), s.page.press("#navSearchInput", "Enter")]);
      await waitForHits(s, 2);
      return { url: s.page.url(), box: await searchBox(s.page), cards: await visibleCards(s.page) };
    } },
  { name: "homepage search, typing passport", expectHits: 2, run: async (s) => {
      await s.page.goto(SITE + "/"); await waitForHits(s, 1);
      await s.page.fill("#homeSearch", "passport");
      await Promise.all([s.page.waitForURL("**/tools/**"), s.page.press("#homeSearch", "Enter")]);
      await waitForHits(s, 2);
      return { url: s.page.url(), box: await searchBox(s.page), cards: await visibleCards(s.page) };
    } },
  { name: "referrer: /tools/?search=password&note=secret, then click the first card", expectHits: 2, run: async (s) => {
      await s.page.goto(SITE + "/tools/?search=password&note=secret"); await waitForHits(s, 1);
      const card = s.page.locator("a.tool-card:visible").first();
      const href = await card.getAttribute("href");
      await Promise.all([s.page.waitForURL("**" + href), card.click()]);
      await waitForHits(s, 2);
      return { url: s.page.url(), h1: await s.page.textContent("h1") };
    } },
  { name: "404 page (no canonical) with ?search=passport", expectHits: 1, run: async (s) => {
      await s.page.goto(SITE + "/es/no-such-page/?search=passport"); await waitForHits(s, 1);
      return { url: s.page.url(), h1: (await s.page.textContent("h1")).trim(), lang: await s.page.getAttribute("html", "lang") };
    } },
  { name: "campaign: utm_campaign + utm_source + unknown params", expectHits: 1,
    campaign: { utm_campaign: "spring", utm_source: "newsletter" }, run: async (s) => {
      await s.page.goto(SITE + "/compress-image/?utm_campaign=spring&utm_source=newsletter&search=passport&x=secret"); await waitForHits(s, 1);
      return { url: s.page.url() };
    } },
  { name: "campaign: ref + unknown param", expectHits: 1, campaign: { ref: "producthunt" }, run: async (s) => {
      await s.page.goto(SITE + "/?ref=producthunt&foo=secret"); await waitForHits(s, 1);
      return { url: s.page.url() };
    } },
];

const SAMPLES = [["Homepage", "/"], ["Tool page", "/compress-image/"], ["Blog post", "/blog/heic-to-jpg-guide/"]];

async function runAll(browser, countJs, label) {
  const results = [];
  for (const sc of SCENARIOS) {
    const s = await newSession(browser, countJs);
    let seen, failure = null;
    try { seen = await sc.run(s); } catch (e) { failure = e.message; }
    await s.page.waitForTimeout(150);
    const sent = s.hits.map((h) => decodeURIComponent(h.url));
    results.push({ sc, seen, failure, hits: s.hits, sent, blocked: s.blocked, errors: s.errors,
                   leaked: sent.some((u) => SECRETS.some((w) => u.includes(w))) });
    await s.context.close();
  }
  return { label, results };
}

const browser = await chromium.launch();
const patchedSrc = await readFile(join(REPO_ROOT, "assets/goatcounter/count.js"), "utf8");
if (!patchedSrc.includes("Orisod privacy patch")) { console.log("FAIL: assets/goatcounter/count.js has no Orisod privacy patch"); process.exit(1); }
const failures = [];

console.log("Fields sent for three sample pages (opened from a Google search result):");
for (const [kind, path] of SAMPLES) {
  const s = await newSession(browser, null);
  await s.page.goto(SITE + path, { referer: "https://www.google.com/" });
  await waitForHits(s, 1);
  const f = fields(s.hits[0]);
  console.log(`\n  ${kind} ${path}`);
  for (const [k, v] of Object.entries(f)) console.log(`    ${k.padEnd(4)} = ${JSON.stringify(v)}`);
  console.log(`    (request headers the browser adds) user-agent = ${JSON.stringify(s.hits[0].headers["user-agent"])}`);
  console.log(`    (request headers the browser adds) accept-language = ${JSON.stringify(s.hits[0].headers["accept-language"] ?? null)}`);
  if (s.errors.length) failures.push(`${path}: ${s.errors.join("; ")}`);
  if (s.blocked.length) failures.push(`${path}: outside requests: ${s.blocked.join(", ")}`);
  await s.context.close();
}

const patched = await runAll(browser, null, "patched");
console.log("\nScenarios with the patched count.js:");
for (const r of patched.results) {
  const problems = [];
  if (r.failure) problems.push(r.failure);
  if (r.hits.length !== r.sc.expectHits) problems.push(`expected ${r.sc.expectHits} counting request(s), got ${r.hits.length}`);
  if (r.leaked) problems.push("a test word (passport/secret) was sent");
  for (const h of r.hits) {
    const f = fields(h);
    const extra = Object.keys(f).filter((k) => !["p", "r", "t", "e", "s", "b", "q", "rnd"].includes(k));
    if (extra.length) problems.push("unexpected field(s): " + extra.join(","));
    const q = new URLSearchParams(f.q || "");
    const unknown = [...q.keys()].filter((k) => !["utm_campaign", "campaign", "utm_source", "ref", "src", "source"].includes(k));
    if (unknown.length) problems.push("unknown parameter(s) sent: " + unknown.join(","));
    if ((f.p || "").includes("?") || (f.r || "").includes("?")) problems.push("a query string was sent in the path or referrer");
  }
  if (r.sc.campaign) {
    const q = Object.fromEntries(new URLSearchParams(fields(r.hits[0] || { url: ENDPOINT }).q || ""));
    if (JSON.stringify(q) !== JSON.stringify(r.sc.campaign)) problems.push(`campaign not recorded as ${JSON.stringify(r.sc.campaign)}: got ${JSON.stringify(q)}`);
  }
  problems.push(...r.errors);
  if (r.blocked.length) problems.push("outside requests: " + r.blocked.join(", "));
  console.log(`  ${problems.length ? "FAIL" : "PASS"}  ${r.sc.name}`);
  for (const h of r.hits) {
    const f = fields(h);
    console.log(`          sent: p=${JSON.stringify(f.p)} q=${JSON.stringify(f.q ?? "")} r=${JSON.stringify(f.r ?? "")}`);
  }
  console.log(`          visitor sees: ${JSON.stringify(r.seen)}`);
  for (const p of problems) { console.log("          " + p); failures.push(`${r.sc.name}: ${p}`); }
}

if (upstreamPath) {
  const upstreamSrc = await readFile(upstreamPath, "utf8");
  const upstream = await runAll(browser, upstreamSrc, "upstream");
  console.log(`\nSame scenarios with the unpatched upstream count.js (${upstreamPath}):`);
  for (let i = 0; i < SCENARIOS.length; i++) {
    const u = upstream.results[i], p = patched.results[i];
    const same = JSON.stringify(u.seen) === JSON.stringify(p.seen) && !u.failure && u.errors.length === 0;
    const leakNote = u.leaked ? "upstream leaks: " + u.sent.filter((x) => SECRETS.some((w) => x.includes(w))).map((x) => x.replace(ENDPOINT, "")).join(" | ") : "upstream sends no test word";
    console.log(`  ${same ? "SAME" : "DIFFERENT"}  ${SCENARIOS[i].name}: ${leakNote}`);
    if (!same) failures.push(`${SCENARIOS[i].name}: the visitor sees something different with the patched file (${JSON.stringify(p.seen)} vs ${JSON.stringify(u.seen)})`);
  }
  if (!upstream.results[0].leaked) failures.push("upstream count.js did not leak ?search=passport, so this test can't tell a leak apart; check the test");
}

await browser.close();
console.log(failures.length ? `\nFAIL: ${failures.length} problem(s)` : "\nAll GoatCounter privacy checks passed.");
process.exit(failures.length ? 1 : 0);
