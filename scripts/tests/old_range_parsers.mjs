// Delete PDF Pages' and PDF to JPG's own range code as it was on main at 4e853957 (with the #233 freeze fix),
// before both tools adopted the shared page range helper. It's frozen here so the tests can show exactly what
// changed for each input; don't edit it. Split PDF's range code (oldSplitRanges, oldSplitExtract) was added the
// same way, frozen from main at 002ba100 before Split PDF adopted the helper, and Rotate PDF's
// (oldRotateSelection, oldRotateClick) from main at 0d55855b before Rotate PDF did. Not a test file itself:
// ranges.test.mjs, huge_ranges.test.mjs, range_adoption.test.mjs, split_range_adoption.test.mjs and
// rotate_range_adoption.test.mjs import it.

export const OLD_MESSAGES = {
  en: { range: (t) => `Invalid range: "${t}"`, page: (t) => `Invalid page number: "${t}"` },
  es: { range: (t) => `Rango no válido: "${t}"`, page: (t) => `Número de página no válido: "${t}"` },
};

// Delete PDF Pages' parsePageRanges(): the 0-based indices of the pages to delete. It never reported a problem.
export function oldDeleteSet(str, total) {
  const deleteSet = new Set();
  str.split(',').forEach((part) => {
    part = part.trim();
    if (!part) return;
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      let a = parseInt(rangeMatch[1], 10);
      let b = parseInt(rangeMatch[2], 10);
      if (a > b) { const t = a; a = b; b = t; }
      for (let i = Math.max(a, 1); i <= Math.min(b, total); i++) deleteSet.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= total) deleteSet.add(n - 1);
    }
  });
  return deleteSet;
}

// PDF to JPG's Apply handler after its `if (!raw) return;`: the pages it ticked (any number, the caller keeps
// those of the document) and the last message it wrote ('' for none).
export function oldJpgSelection(raw, lastPage, lang) {
  const m = OLD_MESSAGES[lang];
  let error = '';
  const pagesToSelect = new Set();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end < start) { error = m.range(trimmed); continue; }
      for (let p = start; p <= Math.min(end, lastPage); p++) pagesToSelect.add(p);
    } else {
      const num = parseInt(trimmed, 10);
      if (isNaN(num) || num < 1) { error = m.page(trimmed); continue; }
      pagesToSelect.add(num);
    }
  }
  return { pages: pagesToSelect, error };
}

// What a visitor saw, for comparing old and new: Delete PDF Pages' preview and Save button, PDF to JPG's
// ticked pages and error line. Both take the pages' own functions' results.
export function deleteOutcome(deleteSet, error, total) {
  if (error) return { pages: [], save: false, text: error };
  const pages = Array.from(deleteSet).map((i) => i + 1).sort((a, b) => a - b);
  if (pages.length === 0) return { pages, save: false, text: '' };
  if (pages.length === total) return { pages, save: false, text: 'all' };
  return { pages, save: true, text: 'count' };
}
export function jpgOutcome(raw, total, select) {
  raw = raw.trim();
  if (!raw) return { unchanged: true };
  const { pages, error } = select(raw, total);
  return { ticked: Array.from({ length: total }, (_, i) => i + 1).filter((p) => pages.has(p)), error };
}

// Split PDF's parseRanges() (EN and ES differ only in the message words): the pages to copy into the new PDF,
// in typed order with repeats kept, or a thrown message for the first item it couldn't read.
export function oldSplitRanges(raw, maxPage, lang) {
  const m = OLD_MESSAGES[lang];
  const pages = [];
  const parts = raw.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end > maxPage || end < start) {
        throw new Error(m.range(trimmed));
      }
      for (let p = start; p <= end; p++) pages.push(p);
    } else {
      const num = parseInt(trimmed, 10);
      if (isNaN(num) || num < 1 || num > maxPage) {
        throw new Error(m.page(trimmed));
      }
      pages.push(num);
    }
  }
  return pages;
}

// What Split PDF's Extract button did with the field: { pages } to copy (possibly none, which built a 0-page
// PDF) or { error } with the message it showed.
export const OLD_SPLIT_EMPTY = { en: 'Enter a page range, e.g. "1-3, 5".', es: 'Introduce un rango de páginas, p. ej. "1-3, 5".' };
export function oldSplitExtract(value, maxPage, lang) {
  const raw = value.trim();
  if (!raw) return { error: OLD_SPLIT_EMPTY[lang] };
  try { return { pages: oldSplitRanges(raw, maxPage, lang) }; } catch (err) { return { error: err.message }; }
}

// Rotate PDF's parsePageSelection() (EN and ES differ only in the message words): every page for a blank field,
// otherwise the pages to rotate (each once, in typed order), or a thrown message for the first item it couldn't read.
export function oldRotateSelection(raw, maxPage, lang) {
  const m = OLD_MESSAGES[lang];
  if (!raw.trim()) {
    return Array.from({ length: maxPage }, (_, i) => i + 1);
  }
  const pages = new Set();
  const parts = raw.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end > maxPage || end < start) {
        throw new Error(m.range(trimmed));
      }
      for (let p = start; p <= end; p++) pages.add(p);
    } else {
      const num = parseInt(trimmed, 10);
      if (isNaN(num) || num < 1 || num > maxPage) {
        throw new Error(m.page(trimmed));
      }
      pages.add(num);
    }
  }
  return Array.from(pages);
}

// What Rotate PDF's button did with the field: { pages } it rotated (possibly none, which still downloaded an
// unchanged file and said "Done: 0 pages rotated.") or { error } with the message it showed.
export function oldRotateClick(value, maxPage, lang) {
  try { return { pages: oldRotateSelection(value, maxPage, lang) }; } catch (err) { return { error: err.message }; }
}
