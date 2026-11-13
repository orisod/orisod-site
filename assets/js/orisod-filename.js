// Download file names (see CLAUDE.md, "Download file names"):
// [the user's file name without its extension]-[what the tool did]-orisod.[ext], or [fallback]-... with no name.
// orisodFileName({ name, accept, action, ext, fallback, part, total })
//   name: the input file name ("" for none); accept: the input extensions to strip (["pdf"]);
//   action: this tool's word in the page's language ("" for none); ext: the output format;
//   fallback: the word used when no name is left; part, total: a page or image number, zero-padded to total's digits
//   (at least 2, so page-07 of 12 and page-007 of 120 sort correctly).
const ORISOD_NAME_BYTES = 120;
function orisodFileName({ name = "", accept = [], action = "", ext, fallback = "file", part, total } = {}) {
  const exts = accept.map((e) => String(e).replace(/^\./, "").toLowerCase());
  const trimEnd = (s) => s.replace(/[\s._-]+$/, "");
  const trim = (s) => trimEnd(s).replace(/^[\s._-]+/, "");
  // Control and bidi characters, and the characters Windows or macOS don't allow in a name, become "-".
  let base = trimEnd(String(name).normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g, "-"));
  // Accepted extensions, case-insensitive and repeated ("a.pdf.PDF"), then a trailing -orisod.
  for (let m; (m = /\.([^.]*)$/.exec(base)) && exts.includes(m[1].toLowerCase());) base = trimEnd(base.slice(0, m.index));
  while (/-orisod$/i.test(base)) base = trimEnd(base.slice(0, -7));
  base = trim(base).replace(/\s+/g, " ").replace(/-{2,}/g, "-");
  // A name that already ends with this tool's word keeps it once.
  const word = String(action).toLowerCase();
  if (word && base.toLowerCase().endsWith("-" + word)) base = trim(base.slice(0, -word.length - 1));
  // At most ORISOD_NAME_BYTES of UTF-8, cut between whole characters (emoji sequences included).
  const enc = new TextEncoder();
  if (enc.encode(base).length > ORISOD_NAME_BYTES) {
    const chars = typeof Intl !== "undefined" && Intl.Segmenter
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(base), (s) => s.segment)
      : Array.from(base);
    let out = "", bytes = 0;
    for (const c of chars) {
      bytes += enc.encode(c).length;
      if (bytes > ORISOD_NAME_BYTES) break;
      out += c;
    }
    base = trim(out);
  }
  // Windows reserves CON, PRN, AUX, NUL, COM1-9 and LPT1-9, also before a dot ("CON.backup").
  base = base.replace(/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])\./i, "$1-");
  const parts = [base || fallback];
  if (word) parts.push(word);
  if (typeof part === "number") parts.push(String(part).padStart(Math.max(2, String(total || part).length), "0"));
  else if (part) parts.push(String(part));
  parts.push("orisod");
  return parts.join("-") + "." + String(ext).replace(/^\./, "").toLowerCase();
}
function orisodZipName(options) {
  return orisodFileName({ ...options, ext: "zip" });
}
