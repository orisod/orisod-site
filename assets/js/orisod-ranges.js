// Page ranges: orisodParseRanges() reads the pages a visitor types ("1-3, 5, 8-") and orisodFormatRanges()
// writes a selection back ("1-3, 5, 8-9"). Pure functions with no DOM and no visible text: each page turns
// the error codes into its own words.
//
// orisodParseRanges(input, totalPages, options) returns { ok, pages, errors }: 1-based pages (sorted and
// unique unless preserveOrder; empty on too_many) and one { code, token, start, end } per problem, in input
// order. Codes: empty, invalid_token, out_of_range, reversed_range, too_many, zero_or_negative.
// Items are separated by commas, semicolons or spaces: "5", "2-4" (a dash joins the numbers beside it), "8-"
// and "-3". Full-width forms read as ASCII, and the hyphen, en dash, em dash and minus sign as the dash.
// Options, default first: preserveOrder false, unique true, allowOpenEnded true, reversed "accept" or "error",
// outOfRange "error" or "clip" (drops pages outside 1..totalPages, page 0 included), allowKeywords false,
// keywords ORISOD_RANGE_KEYWORDS (odd, even, last), maxItems 100000. A bad totalPages or an unknown option
// throws a TypeError. orisodParseRanges reads orisodFormatRanges(pages, { preserveOrder }) back unchanged.

const ORISOD_RANGE_KEYWORDS = {
  odd: ["odd", "impar", "impares"],
  even: ["even", "par", "pares"],
  last: ["last", "ultima", "última"]
};
const ORISOD_RANGE_DEFAULTS = {
  preserveOrder: false, unique: true, allowOpenEnded: true, reversed: "accept", outOfRange: "error",
  allowKeywords: false, keywords: ORISOD_RANGE_KEYWORDS, maxItems: 100000
};

// Kind of one UTF-16 code unit: 0 digit, 1 dash, 2 separator, 3 space, 4 letter, 5 anything else.
// Returns kind * 65536 + the code it stands for (ASCII for a full-width form or a dash).
function orisodRangeChar(c) {
  if (c >= 0xFF01 && c <= 0xFF5E) c -= 0xFEE0;
  else if (c === 0x3001 || c === 0xFF64) c = 44;
  else if ((c >= 0x2010 && c <= 0x2015) || c === 0x2212 || c === 0xFE58 || c === 0xFE63) c = 45;
  if (c >= 48 && c <= 57) return c;
  if (c === 45) return 65536 + c;
  if (c === 44 || c === 59) return 131072 + c;
  if ((c >= 9 && c <= 13) || c === 32 || c === 160 || c === 5760 || (c >= 0x2000 && c <= 0x200A) ||
      c === 0x2028 || c === 0x2029 || c === 0x202F || c === 0x205F || c === 0x3000 || c === 0xFEFF) return 196608 + c;
  const ch = String.fromCharCode(c);
  return (ch.toLowerCase() !== ch.toUpperCase() ? 262144 : 327680) + c;
}

function orisodParseRanges(input, totalPages, options) {
  if (typeof input !== "string") throw new TypeError("input must be a string");
  if (!Number.isSafeInteger(totalPages) || totalPages < 0) throw new TypeError("totalPages must be a whole number from 0");
  for (const key of Object.keys(options || {})) {
    if (!(key in ORISOD_RANGE_DEFAULTS)) throw new TypeError("unknown option " + key);
  }
  const o = Object.assign({}, ORISOD_RANGE_DEFAULTS, options);
  const total = totalPages, clip = o.outOfRange === "clip";
  const errors = [];

  // 1. Lexemes: runs of digits or letters, single dashes and separators, and runs of anything else.
  const lex = [];
  let i = 0, space = false;
  while (i < input.length) {
    const v = orisodRangeChar(input.charCodeAt(i)), kind = v >> 16, code = v & 65535;
    if (kind === 3) { space = true; i++; continue; }
    const start = i;
    let text = String.fromCharCode(code);
    i++;
    if (kind === 0 || kind === 4 || kind === 5) {
      while (i < input.length) {
        const v2 = orisodRangeChar(input.charCodeAt(i));
        if (v2 >> 16 !== kind) break;
        text += String.fromCharCode(v2 & 65535);
        i++;
      }
    }
    lex.push({ kind, start, end: i, text, space });
    space = false;
  }

  // 2. Items: a separator ends one, and so does a space unless a dash is on either side of it.
  const items = [];
  let cur = null;
  for (const l of lex) {
    if (l.kind === 2) { cur = null; continue; }
    const prev = cur && cur[cur.length - 1];
    if (cur && (!l.space || l.kind === 1 || prev.kind === 1)) cur.push(l);
    else items.push(cur = [l]);
  }
  if (!items.length) {
    return { ok: false, pages: [], errors: [{ code: "empty", token: input, start: 0, end: input.length }] };
  }

  const words = {};
  if (o.allowKeywords) {
    for (const name of ["odd", "even", "last"]) for (const w of o.keywords[name] || []) words[w.toLowerCase()] = name;
  }
  // A typed page number, or the keyword "last": { v } (Infinity past what a safe integer holds), or null.
  const term = (l) => {
    if (l.kind === 0) {
      const digits = l.text.replace(/^0+/, "");
      return { v: digits.length > 15 ? Infinity : Number(digits) };
    }
    if (l.kind === 4 && words[l.text.toLowerCase()] === "last") return { v: total, last: true };
    return null;
  };

  // 3. Each item becomes { lo, hi, down } or { parity }, or an error.
  const parts = [];
  for (const it of items) {
    const start = it[0].start, end = it[it.length - 1].end;
    const fail = (code) => errors.push({ code, token: input.slice(start, end), start, end });
    let a = null, b = null, open = false;
    const parity = it.length === 1 && it[0].kind === 4 && words[it[0].text.toLowerCase()];
    if (parity === "odd" || parity === "even") {
      if (!clip && total < (parity === "odd" ? 1 : 2)) { fail("out_of_range"); continue; }
      parts.push({ parity, start, end });
      continue;
    }
    if (it.length === 1) a = b = term(it[0]);
    else if (it.length === 2 && it[0].kind === 1) {
      b = term(it[1]);
      if (b && !o.allowOpenEnded) { fail(b.last ? "invalid_token" : "zero_or_negative"); continue; }
      a = { v: 1 };
      open = true;
    } else if (it.length === 2 && it[1].kind === 1) {
      a = term(it[0]);
      if (a && !o.allowOpenEnded) { fail("invalid_token"); continue; }
      b = { v: total, last: true };
      open = true;
    } else if (it.length === 3 && it[1].kind === 1) {
      a = term(it[0]);
      b = term(it[2]);
    }
    if (!a || !b) { fail("invalid_token"); continue; }
    if ((a.v === 0 && !a.last) || (b.v === 0 && !b.last)) {
      if (!clip) { fail("zero_or_negative"); continue; }
    }
    let lo = a.v, hi = b.v, down = false;
    if (lo > hi && !open) {
      if (o.reversed === "error") { fail("reversed_range"); continue; }
      lo = b.v; hi = a.v; down = true;
    }
    if (clip) {
      lo = Math.max(lo, 1);
      hi = Math.min(hi, total);
      if (lo > hi) continue;
    } else if (lo < 1 || hi > total || lo > hi) {
      fail("out_of_range");
      continue;
    }
    parts.push({ lo, hi, down, start, end });
  }

  // 4. Pages.
  let pages = [];
  const tooMany = (start, end) => {
    errors.push({ code: "too_many", token: input.slice(start, end), start, end });
    pages = [];
  };
  if (!o.preserveOrder) {
    const mark = new Uint8Array(total + 2);
    const spans = parts.filter((p) => !p.parity).sort((x, y) => x.lo - y.lo);
    let runLo = 0, runHi = -1;
    const fill = (from, to) => { for (let p = from; p <= to; p++) mark[p] = 1; };
    for (const s of spans) {
      if (s.lo > runHi + 1) { fill(runLo, runHi); runLo = s.lo; runHi = s.hi; }
      else if (s.hi > runHi) runHi = s.hi;
    }
    fill(runLo, runHi);
    for (const parity of ["odd", "even"]) {
      if (parts.some((p) => p.parity === parity)) for (let p = parity === "odd" ? 1 : 2; p <= total; p += 2) mark[p] = 1;
    }
    for (let p = 1; p <= total; p++) if (mark[p]) pages.push(p);
    if (pages.length > o.maxItems) tooMany(0, input.length);
  } else if (!o.unique) {
    outer: for (const s of parts) {
      const from = s.parity ? (s.parity === "odd" ? 1 : 2) : (s.down ? s.hi : s.lo);
      const to = s.parity ? total : (s.down ? s.lo : s.hi);
      const step = s.parity ? 2 : (s.down ? -1 : 1);
      for (let p = from; step > 0 ? p <= to : p >= to; p += step) {
        if (pages.length >= o.maxItems) { tooMany(s.start, s.end); break outer; }
        pages.push(p);
      }
    }
  } else {
    // Each page once: next[p] and prev[p] lead to the nearest page not yet taken, so every page is visited once.
    const next = new Int32Array(total + 2), prev = new Int32Array(total + 2);
    for (let p = 0; p < total + 2; p++) next[p] = prev[p] = p;
    const find = (arr, p) => {
      let r = p;
      while (arr[r] !== r) r = arr[r];
      while (arr[p] !== r) { const n = arr[p]; arr[p] = r; p = n; }
      return r;
    };
    const take = (p) => { next[p] = p + 1; prev[p] = p - 1; pages.push(p); };
    const done = {};
    outer: for (const s of parts) {
      if (s.parity) {
        if (done[s.parity]) continue;
        done[s.parity] = true;
        for (let p = s.parity === "odd" ? 1 : 2; p <= total; p += 2) {
          if (next[p] !== p) continue;
          if (pages.length >= o.maxItems) { tooMany(s.start, s.end); break outer; }
          take(p);
        }
      } else if (!s.down) {
        for (let p = find(next, s.lo); p <= s.hi; p = find(next, p)) {
          if (pages.length >= o.maxItems) { tooMany(s.start, s.end); break outer; }
          take(p);
        }
      } else {
        for (let p = find(prev, s.hi); p >= s.lo && p >= 1; p = find(prev, p)) {
          if (pages.length >= o.maxItems) { tooMany(s.start, s.end); break outer; }
          take(p);
        }
      }
    }
  }
  return { ok: errors.length === 0, pages: errors.some((e) => e.code === "too_many") ? [] : pages, errors };
}

function orisodFormatRanges(pages, options) {
  if (!Array.isArray(pages) || pages.some((p) => !Number.isSafeInteger(p) || p < 1)) {
    throw new TypeError("pages must be whole numbers from 1");
  }
  let list = pages;
  if (!(options && options.preserveOrder)) list = Array.from(new Set(pages)).sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < list.length;) {
    let j = i;
    const step = list[i + 1] - list[i];
    if (step === 1 || step === -1) while (j + 1 < list.length && list[j + 1] - list[j] === step) j++;
    out.push(j > i ? list[i] + "-" + list[j] : String(list[i]));
    i = j + 1;
  }
  return out.join(", ");
}
