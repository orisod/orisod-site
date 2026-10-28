#!/usr/bin/env node
/**
 * Smoke-test the self-hosted libraries in assets/vendor: each one really works
 * on its tool page, in English and Spanish, with no outside script host.
 *
 * Local only (not in CI). Run it after adding or updating a library in
 * assets/vendor, or after changing how a page loads one:
 *
 *   node scripts/test_vendor_smoke.js [case name ...]
 *
 * How it works: a headless Chromium loads each tool page as https://orisod.com/...,
 * and every orisod.com request is answered from the local files, so root-absolute
 * /assets/vendor/ paths resolve exactly as on GitHub Pages. GoatCounter's counting
 * request is answered locally too, so nothing is counted. Every other request is
 * blocked and fails the case, except the CDN URLs still allowed in
 * scripts/check_vendor.py (REMAINING_CDN), which are let through and listed, so a
 * page that still needs a library that hasn't moved yet (like pdf-lib on the
 * Hebrew calendar generator) can finish its job. Once REMAINING_CDN is empty,
 * every outside request fails.
 *
 * Each case runs one real operation with its library and checks the result, then
 * checks that the page fetched the case's vendor files from /assets/vendor (status
 * 200) and logged no errors. To cover a library moved in a later PR, add an entry
 * to CASES: the vendor files it needs, the page, and a run(page, lang) that does
 * the operation and throws if the result is wrong.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { chromium } from "playwright";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SITE = "https://orisod.com";
const GOATCOUNTER = "https://orisod.goatcounter.com/count";
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm", ".gz": "application/gzip", ".pdf": "application/pdf",
};
const python = process.platform === "win32" ? "python" : "python3";
const REMAINING_CDN = JSON.parse(execFileSync(python, [join(REPO_ROOT, "scripts", "check_vendor.py"), "--allowlist"], { encoding: "utf-8" }));

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

// Text drawn on a PDF's pages: every content stream (inflated when compressed),
// with its <hex> and (literal) strings decoded. Enough for pdf-lib's standard fonts.
function pdfText(bytes) {
  const raw = bytes.toString("latin1");
  let out = "";
  for (const m of raw.matchAll(/<<((?:(?!>>\s*stream)[\s\S])*)>>\s*stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    let data = bytes.subarray(start, end);
    if (/\/FlateDecode/.test(m[1])) {
      try { data = inflateSync(data); } catch { continue; }
    }
    const s = data.toString("latin1");
    for (const t of s.matchAll(/<([0-9A-Fa-f\s]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g))
      out += (t[1] !== undefined ? Buffer.from(t[1].replace(/\s/g, ""), "hex").toString("latin1") : t[2].replace(/\\(.)/g, "$1")) + "\n";
  }
  return out;
}

function expect(ok, message) {
  if (!ok) throw new Error(message);
}

// One entry per library (or library pair) that has moved to assets/vendor.
const CASES = [
  {
    name: "spark-md5",
    page: "/hash-checksum-generator/",
    vendor: ["/assets/vendor/spark-md5/3.0.2/spark-md5.min.js"],
    async run(page) {
      await page.fill("#textInput", "abc");
      const row = page.locator('.hash-row[data-algo="MD5"] .hash-value');
      await row.waitFor({ timeout: 10000 });
      const md5 = (await row.textContent()).trim();
      expect(md5 === "900150983cd24fb0d6963f7d28e17f72", `MD5("abc") was ${md5}`);
      return `MD5("abc") = ${md5}`;
    },
  },
  {
    name: "qrcodejs",
    page: "/qr-code-generator/",
    vendor: ["/assets/vendor/qrcodejs/1.0.0/qrcode.min.js"],
    async run(page) {
      await page.fill("#textInput", "https://orisod.com/");
      await page.click("#generateBtn");
      const link = page.locator('#result a[download="qrcode.png"]');
      await link.waitFor({ timeout: 10000 });
      const href = await link.getAttribute("href");
      expect(href.startsWith("data:image/png;base64,"), "the download link isn't a PNG");
      const info = await page.evaluate(() => {
        const c = document.querySelector("#qrCanvasWrap canvas");
        const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 150) dark++;
        return { w: c.width, h: c.height, dark: dark / (c.width * c.height) };
      });
      expect(info.w > 100 && info.w === info.h, `QR canvas is ${info.w}x${info.h}`);
      expect(info.dark > 0.25 && info.dark < 0.75, `QR canvas is ${Math.round(info.dark * 100)}% dark, not a QR code`);
      return `${info.w}x${info.h} QR image, ${Math.round(info.dark * 100)}% dark modules, PNG download offered`;
    },
  },
  {
    name: "suncalc",
    page: "/hebrew-calendar-generator/",
    vendor: ["/assets/vendor/suncalc/1.9.0/suncalc.min.js"],
    async run(page, lang) {
      await page.fill("#citySearchInput", "Jerus");
      const city = page.locator("#citySuggestions .city-suggestion").first();
      await city.waitFor({ timeout: 15000 });
      await city.click();
      const chosen = await page.inputValue("#citySearchInput");
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#downloadBtn")]);
      const bytes = await readFile(await download.path());
      expect(bytes.subarray(0, 5).toString() === "%PDF-", "the download isn't a PDF");
      const text = pdfText(bytes);
      const word = lang === "es" ? "Velas" : "Candles";
      const times = text.match(new RegExp(`${word} \\d{1,2}:\\d{2}`, "g")) || [];
      expect(times.length >= 40, `the PDF has ${times.length} "${word} <time>" lines`);
      return `${chosen}: ${download.suggestedFilename()}, ${bytes.length} bytes, ${times.length} candle-lighting times (e.g. "${times[0]}")`;
    },
  },
  {
    name: "turndown + turndown-plugin-gfm",
    page: "/convert-to-markdown/",
    vendor: ["/assets/vendor/turndown/7.2.4/turndown.js", "/assets/vendor/turndown-plugin-gfm/1.0.2/turndown-plugin-gfm.js"],
    async run(page) {
      await page.click('#modeRow [data-mode="html"]');
      await page.fill("#htmlInput", "<h2>Fruit</h2><table><thead><tr><th>Name</th><th>Qty</th></tr></thead>" +
        "<tbody><tr><td>Apple</td><td>3</td></tr><tr><td>Pear</td><td>5</td></tr></tbody></table>");
      await page.waitForFunction(() => document.getElementById("markdownOutput").value.includes("| Pear"), null, { timeout: 10000 });
      const md = await page.inputValue("#markdownOutput");
      const want = "## Fruit\n\n| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n| Pear | 5 |";
      expect(md === want, `Markdown was:\n${md}`);
      return "HTML table became a pipe table (## Fruit | Name | Qty | ...)";
    },
  },
];

async function runCase(browser, c, lang) {
  const context = await browser.newContext({ locale: lang === "es" ? "es-ES" : "en-US", acceptDownloads: true });
  const seen = { vendor: new Map(), cdn: [], blocked: [], errors: [] };
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(GOATCOUNTER)) return route.fulfill({ status: 204, body: "" });
    if (url.startsWith(SITE + "/")) {
      const res = await localFile(url);
      const path = new URL(url).pathname;
      if (path.startsWith("/assets/vendor/")) seen.vendor.set(path, res.status);
      return route.fulfill(res);
    }
    if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    if (Object.hasOwn(REMAINING_CDN, url)) {
      seen.cdn.push(url);
      return route.continue();
    }
    seen.blocked.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => seen.errors.push("page error: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") seen.errors.push("console error: " + m.text()); });
  const path = (lang === "es" ? "/es" : "") + c.page;
  let detail, failure;
  try {
    await page.goto(SITE + path, { waitUntil: "load", timeout: 60000 });
    detail = await c.run(page, lang);
    for (const v of c.vendor) expect(seen.vendor.get(v) === 200, `${v} wasn't loaded from /assets/vendor (status ${seen.vendor.get(v)})`);
    expect(!seen.blocked.length, `requests to outside hosts: ${seen.blocked.join(", ")}`);
    expect(!seen.errors.length, seen.errors.join("; "));
  } catch (e) {
    failure = e.message.split("\n").slice(0, 6).join("\n        ");
  }
  await context.close();
  return { path, detail, failure, cdn: [...new Set(seen.cdn)] };
}

const only = process.argv.slice(2);
const cases = only.length ? CASES.filter((c) => only.includes(c.name)) : CASES;
if (!cases.length) {
  console.error(`No such case. Cases: ${CASES.map((c) => c.name).join(", ")}`);
  process.exit(2);
}
const browser = await chromium.launch();
let failed = 0, cdnPages = 0;
for (const c of cases) {
  for (const lang of ["en", "es"]) {
    const r = await runCase(browser, c, lang);
    failed += !!r.failure;
    cdnPages += r.cdn.length > 0;
    console.log(`  ${r.failure ? "FAIL" : "PASS"}  ${c.name} on ${r.path}: ${r.failure || r.detail}`);
    for (const u of r.cdn) console.log(`        still from a CDN (allowed for now in REMAINING_CDN): ${u}`);
  }
}
await browser.close();
console.log(failed ? `${failed} case(s) failed.`
  : `All vendor smoke tests passed (${cases.length * 2} pages; ${cdnPages} still load a library from a CDN that hasn't moved yet).`);
process.exit(failed ? 1 : 0);
