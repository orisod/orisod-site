#!/usr/bin/env node
/**
 * Fail if any page has an axe-core WCAG2A/AA accessibility violation.
 *
 * Orisod has no build step and no page registry — sitemap.xml is the same
 * hand-maintained source of truth check_sitemap.py already treats as
 * authoritative, so this script reuses it instead of a second, separately
 * hand-maintained list of pages to scan. Every URL in sitemap.xml gets a
 * real headless-Chromium render + a full axe-core scan, once in the default
 * dark theme and once in light theme. A few representative pages are scanned
 * again with the nav's menu panel, search box or a category flyout open, and
 * the WhatsApp link generator in three states (see OPEN_STATES), since those
 * are hidden in a plain scan. Each page is also checked for uploads a keyboard
 * can't reach, and for error lines a screen reader
 * wouldn't announce, which axe misses. Run in CI on every push/PR to main, same as
 * check_sitemap.py. Takes --root DIR to scan a test copy of the site.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile as fsReadFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import axeSource from "axe-core";

const rootArg = process.argv.indexOf("--root");
const REPO_ROOT = rootArg > -1 ? resolve(process.argv[rootArg + 1]) + sep : fileURLToPath(new URL("..", import.meta.url));
const SITE_ORIGIN = "https://orisod.com";
const PORT = 8931;
const CONCURRENCY = 8; // parallel browser contexts — keeps a ~300-page scan under a few minutes on a 2-core CI runner without overwhelming it
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath.endsWith("/")) urlPath += "index.html";
      const filePath = normalize(join(REPO_ROOT, urlPath));
      if (!filePath.startsWith(REPO_ROOT)) {
        res.writeHead(403).end();
        return;
      }
      const body = await fsReadFile(filePath);
      const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type }).end(body);
    } catch {
      // Like GitHub Pages: any unmatched path gets the custom 404.html, with a 404 status.
      try {
        res.writeHead(404, { "Content-Type": MIME[".html"] }).end(await fsReadFile(join(REPO_ROOT, "404.html")));
      } catch {
        res.writeHead(404).end("Not found");
      }
    }
  });
  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

// Pages that exist but are deliberately not in sitemap.xml. 404.html is
// noindex and served by GitHub Pages for any unmatched path; it is scanned once
// per gear easter-egg variant, since each variant renders different markup, and
// again on a broken /es/ URL, where its script translates the page to Spanish.
const GEAR_VARIANTS = ["loose", "stuck", "tooth", "sync", "rusty", "offcenter"];
const EXTRA_PATHS = [
  ...GEAR_VARIANTS.map((g) => `/404.html?gear=${g}`),
  ...GEAR_VARIANTS.map((g) => `/es/a11y-check-missing-page/?gear=${g}`),
];

// The nav's menu panel and search box are hidden until opened, so a plain scan
// never sees them. One page per template is scanned again with each open.
// /tools has no nav search box (its icon focuses the page's own search).
const MENU_OPEN_PATHS = [
  "/", "/es/", "/compress-pdf/", "/es/compress-pdf/", "/qr-code-generator/", "/es/qr-code-generator/",
  "/blog/add-page-numbers-to-pdf/", "/es/blog/add-page-numbers-to-pdf/", "/about/", "/es/about/",
  "/blog/", "/es/blog/", "/tools/", "/es/tools/", "/404.html", "/es/a11y-check-missing-page/",
];
const WA_EMOJI_CATEGORIES = ["smileys", "gestures", "hearts", "work", "symbols", "food"];
const OPEN_STATES = [
  ...MENU_OPEN_PATHS.map((path) => ({ path, open: "menu" })),
  ...MENU_OPEN_PATHS.filter((p) => !["/", "/es/", "/tools/", "/es/tools/"].includes(p)).map((path) => ({ path, open: "search" })),
  // The desktop category flyouts (homepages and /tools), opened with the PDF one showing.
  // Orisod 2.0: the generated menu also gives a tool page, its guide and a blog post the same flyouts.
  ...["/", "/es/", "/tools/", "/es/tools/", "/whatsapp-link-generator/", "/es/whatsapp-link-generator/",
    "/blog/send-whatsapp-without-saving-contact/", "/es/blog/send-whatsapp-without-saving-contact/",
    "/blog/what-is-exif-data/", "/es/blog/what-is-exif-data/",
    // The 404 page too, English and on a broken /es/ URL (where its script swaps in the Spanish lists).
    "/404.html", "/es/a11y-check-missing-page/"].map((path) => ({ path, open: "flyout" })),
  // The minimal tool layout (WhatsApp link generator, the pilot): its collapsed "Help and details"
  // block opened, the country list opened, and the form filled in so the number notes, the "Add the 9"
  // button and the formatted preview show; its emoji picker opened on each of its six categories; and its
  // "Share this tool" list opened, with a tooltip shown and with an item lit by hover.
  ...["/whatsapp-link-generator/", "/es/whatsapp-link-generator/"].flatMap((path) =>
    ["details", "country list", "filled form", ...WA_EMOJI_CATEGORIES.map((c) => "emoji picker: " + c),
      "share list", "share tooltip", "share lit", "qr shown"].map((open) => ({ path, open }))),
  // Remove Blank Pages from PDF: a generated PDF checked (pages marked, one with the hidden-content note), then with
  // nothing marked (Save disabled, its reason shown), the collapsed block open, and the share list open.
  ...["/remove-blank-pages/", "/es/remove-blank-pages/"].flatMap((path) => ["blank pages checked", "blank pages nothing to save", "details", "share list"].map((open) => ({ path, open }))),
  // Merge PDF in the Orisod 2.0 page frame: two PDFs loaded (the file list with thumbnails, arrows and remove buttons,
  // the actions), and the "Help and details" block open.
  ...["/merge-pdf/", "/es/merge-pdf/"].flatMap((path) => ["merge files", "details"].map((open) => ({ path, open }))),
];
// How to reach each tool state above (the nav states click a nav button instead).
const TOOL_STATES = {
  details: async (page) => { await page.click("details.more > summary"); return "details.more[open]"; },
  // "Share this tool": the list open, with a tooltip shown by keyboard focus, and with an item hovered (lit).
  "share list": async (page) => { await page.click("#shareMenu > summary"); return "#shareList"; },
  "share tooltip": async (page) => {
    await page.click("#shareMenu > summary");
    await page.focus("#shareMenu > summary");
    await page.keyboard.press("Tab");
    return "#shareList li:first-child .share-tip";
  },
  "share lit": async (page) => {
    await page.click("#shareMenu > summary");
    await page.hover('#shareList a[data-share="reddit"]');
    return '#shareList a[data-share="reddit"] .share-tip';
  },
  "merge files": async (page) => {
    const b64 = await page.evaluate(async () => {
      const { PDFDocument, StandardFonts } = PDFLib;
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      doc.addPage([612, 792]).drawText("A page with text", { x: 72, y: 700, size: 24, font });
      let s = ""; for (const b of await doc.save()) s += String.fromCharCode(b); return btoa(s);
    });
    const file = (name) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(b64, "base64") });
    await page.setInputFiles("#fileInput", [file("first.pdf"), file("second.pdf")]);
    await page.waitForFunction(() => document.querySelectorAll("#fileList .file-thumb img").length === 2, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    return "#fileList";
  },
  "blank pages checked": async (page) => {
    const b64 = await page.evaluate(async () => {
      const { PDFDocument, StandardFonts, PDFName, PDFString } = PDFLib;
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      doc.addPage([612, 792]).drawText("A page with text", { x: 72, y: 700, size: 24, font });
      doc.addPage([612, 792]);
      const note = doc.addPage([612, 792]);
      note.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: [72, 72, 92, 92], Contents: PDFString.of("a note") }))]));
      let s = ""; for (const b of await doc.save()) s += String.fromCharCode(b); return btoa(s);
    });
    await page.setInputFiles("#fileInput", { name: "check.pdf", mimeType: "application/pdf", buffer: Buffer.from(b64, "base64") });
    await page.waitForFunction(() => !document.getElementById("actions").hidden && document.getElementById("progressRow").hidden && document.querySelector("#pageList > li"), null, { timeout: 20000 });
    await page.click("#pageCheck1");
    return "#pageList";
  },
  // Nothing marked: Save disabled, with its reason shown next to it.
  "blank pages nothing to save": async (page) => {
    await TOOL_STATES["blank pages checked"](page);
    for (const id of ["#pageCheck1", "#pageCheck2"]) await page.uncheck(id);
    return "#saveNote";
  },
  "country list": async (page) => { await page.focus("#countryInput"); await page.keyboard.press("ArrowDown"); return "#countryList:not([hidden])"; },
  // The QR code generated: the code and its Download button shown, the polite message announced.
  "qr shown": async (page) => {
    await page.fill("#phoneInput", "+44 7400 123456");
    await page.locator("#phoneInput").blur();
    await page.click("#qrBtn");
    await page.locator("#qrDownload").waitFor({ state: "visible" });
    return "#qrBox";
  },
  "filled form": async (page) => {
    await page.fill("#countryInput", "Argentina");
    await page.keyboard.press("Enter");
    await page.fill("#phoneInput", "11 2345 6789");
    await page.locator("#phoneInput").blur();
    await page.fill("#messageInput", "Hi *there* _you_ ~old~ `code`");
    return "#addNineBtn";
  },
  ...Object.fromEntries(WA_EMOJI_CATEGORIES.map((cat) => ["emoji picker: " + cat, async (page) => {
    await page.click("#emojiBtn");
    await page.click("#emojiTab-" + cat);
    return "#emojiPanel-" + cat + ":not([hidden]) .emoji-grid";
  }])),
};

function sitemapPaths() {
  const xml = readFileSync(join(REPO_ROOT, "sitemap.xml"), "utf-8");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return urls.map((u) => u.replace(SITE_ORIGIN, ""));
}

async function scanPath(context, item) {
  // item is a path, or {path, open} to scan with the nav menu, search box or a flyout open.
  const urlPath = typeof item === "string" ? item : item.path;
  const label = typeof item === "string" ? urlPath : `${urlPath} [${item.open} open]`;
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  try {
    await page.goto(`http://127.0.0.1:${PORT}${urlPath}`, { waitUntil: "load", timeout: 30000 });
    await page.addScriptTag({ content: axeSource.source });
    if (typeof item !== "string" && TOOL_STATES[item.open]) {
      const shown = await TOOL_STATES[item.open](page);
      if (!(await page.locator(shown).isVisible())) throw new Error(`the ${item.open} did not show`);
    } else if (typeof item !== "string") {
      await page.click(item.open === "search" ? "#navSearchBtn" : "#navMenuBtn");
      if (item.open === "flyout") await page.focus('#navMenu a.menu-item[data-flyout$="-pdf"]');
      const panel = { menu: "#navMenu", search: "#navSearch", flyout: "#menuFlyout-pdf" }[item.open];
      if (await page.locator(panel).isHidden()) throw new Error(`the ${item.open} did not open`);
    }
    const run = (theme) =>
      page.evaluate(
        async ({ tags, theme }) => {
          if (theme === "light") {
            // Same switch the nav's theme toggle makes. Transitions are turned off
            // first so axe reads the final light colors, not a mid-fade blend.
            const s = document.createElement("style");
            s.textContent = "*,*::before,*::after{transition:none!important}";
            document.head.appendChild(s);
            document.documentElement.setAttribute("data-theme", "light");
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          }
          const res = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
          return res.violations.map((v) => ({ ...v, theme }));
        },
        { tags: AXE_TAGS, theme }
      );
    // Every page is scanned in both themes: dark (the default) and light.
    const violations = [...(await run("dark")), ...(await run("light"))];
    // axe doesn't notice an upload a keyboard can't reach: a file input hidden
    // with display:none behind its <label> dropzone. Any file input with a
    // visible label must stay focusable (visually hidden instead).
    const unreachable = await page.evaluate(() =>
      [...document.querySelectorAll('input[type="file"]')]
        .filter((i) => [...i.labels].some((l) => l.getClientRects().length > 0))
        .filter((i) => {
          const s = getComputedStyle(i);
          return i.disabled || i.tabIndex < 0 || s.display === "none" || s.visibility === "hidden" || !i.getClientRects().length;
        })
        .map((i) => "#" + (i.id || "(no id)"))
    );
    if (unreachable.length) {
      violations.push({ id: "file-input-unreachable", impact: "serious", theme: "dark",
        help: "Upload can't be reached with the keyboard: file input is display:none (or otherwise unfocusable) behind its label; hide it visually instead",
        nodes: unreachable.map((t) => ({ target: [t] })) });
    }
    // Nor does it notice a <div> or <span> made clickable with a script (an
    // option like "JPG/PNG" or a watermark position): it shows a pointer cursor
    // but can't be reached by Tab. Anything clickable must be a real <button>
    // or link. Hidden panels count too, since they appear after an upload.
    const mouseOnly = await page.evaluate(() => {
      const NATIVE = 'a[href],button,input,select,textarea,summary,label,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
      const pointer = (el) => getComputedStyle(el).cursor === "pointer" && !el.closest(NATIVE);
      return [...document.querySelectorAll("main *")]
        .filter((el) => pointer(el) && !(el.parentElement && pointer(el.parentElement)))
        .map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : ""));
    });
    if (mouseOnly.length) {
      violations.push({ id: "mouse-only-control", impact: "serious", theme: "dark",
        help: "Clickable element can't be reached with the keyboard: make it a <button type=\"button\"> (or a link with an href)",
        nodes: [...new Set(mouseOnly)].map((t) => ({ target: [t] })) });
    }
    // An error line (class "error" or "field-error") gets its message from a
    // script after the page loads, so a screen reader only reads it out if the
    // element is a live region: role="alert" (or an aria-live value) must be on
    // it in the HTML, not added with the message.
    const silentErrors = await page.evaluate(() =>
      [...document.querySelectorAll(".error, .field-error")]
        .filter((el) => el.getAttribute("role") !== "alert" && !["assertive", "polite"].includes(el.getAttribute("aria-live")))
        .map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "." + el.className.trim().split(/\s+/)[0])
    );
    if (silentErrors.length) {
      violations.push({ id: "error-not-announced", impact: "serious", theme: "dark",
        help: "Error line isn't announced by screen readers: add role=\"alert\" to the element in the HTML",
        nodes: silentErrors.map((t) => ({ target: [t] })) });
    }
    return { urlPath: label, violations, consoleErrors };
  } catch (err) {
    // A menu/search box that won't open is a real failure, not just a scan note.
    if (typeof item !== "string") {
      return { urlPath: label, violations: [{ id: "nav-open-failed", impact: "critical", help: String(err), nodes: [], theme: "dark" }], consoleErrors };
    }
    return { urlPath: label, violations: [], consoleErrors: [...consoleErrors, `navigation/scan failed: ${err}`] };
  } finally {
    await page.close();
  }
}

async function main() {
  const paths = [...sitemapPaths(), ...EXTRA_PATHS, ...OPEN_STATES];
  const server = await startStaticServer();
  const browser = await chromium.launch();

  const queue = [...paths];
  const results = [];
  async function worker() {
    const context = await browser.newContext();
    while (queue.length) {
      const urlPath = queue.shift();
      if (urlPath === undefined) break;
      results.push(await scanPath(context, urlPath));
    }
    await context.close();
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await browser.close();
  server.close();

  const failing = results.filter((r) => r.violations.length > 0);
  const scanErrors = results.filter((r) => r.consoleErrors.length > 0 && r.violations.length === 0);

  if (scanErrors.length) {
    console.log(`Note: ${scanErrors.length} page(s) hit a navigation/console error during scan (not counted as a11y violations, but worth a look):`);
    for (const r of scanErrors) console.log(`  - ${r.urlPath}: ${r.consoleErrors.join("; ")}`);
  }

  if (failing.length) {
    console.log(`\nAccessibility violations found on ${failing.length}/${results.length} page(s):\n`);
    for (const r of failing) {
      console.log(`${SITE_ORIGIN}${r.urlPath}`);
      for (const v of r.violations) {
        const targets = v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ");
        console.log(`  [${v.impact}] (${v.theme} theme) ${v.id}: ${v.help} (${v.nodes.length} node(s): ${targets}${v.nodes.length > 3 ? ", ..." : ""})`);
      }
      console.log("");
    }
    console.log(`${failing.length} page(s) failed / ${results.length} pages checked.`);
    process.exit(1);
  }

  console.log(`OK: all ${results.length} pages passed axe-core in dark and light themes (${AXE_TAGS.join(", ")}), including ${OPEN_STATES.length} scans with the nav menu, search box or a category flyout open, or a tool state shown (the WhatsApp link generator's collapsed block, country list, filled form, emoji picker on each category, Share this tool list, tooltip and lit state, and generated QR code; Remove Blank Pages with pages checked, with nothing to save, its block and its share list; Merge PDF with files loaded and its block); every error line is announced (role="alert").`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
