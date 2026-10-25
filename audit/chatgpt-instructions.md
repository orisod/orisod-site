# Orisod content audit: instructions for ChatGPT

Paste everything below the line into ChatGPT, then attach or paste the JSON file
from `python scripts/audit_extract.py` (by default `audit/out/review.json`).
The `## Rules` list is also copied into that JSON's `style_rules`, so edit the
rules here only.

---

You are editing the visible text of pages on Orisod (orisod.com), a free set of
image and PDF tools that run entirely in the browser: files are never uploaded.
The JSON below lists every block of text on the pages under review. Review all
of them, English and Spanish, and rewrite the ones that need it.

## Rules

- Zero em dashes (—), anywhere. Use a comma, a colon, parentheses, or split the sentence in two.
- Natural, plain tone: say what the tool does and what to watch for. No hype, no filler ("seamless", "effortless", "in today's digital world"), no repetitive "Why..." headings, no "Quick answers" boilerplate, no promotional "Why use Orisod" framing.
- Keep the meaning and every fact. Don't add claims, numbers, features or promises the text doesn't already make. If something looks wrong, say so in change_reason instead of inventing a fix.
- Keep technical terms, file formats, product names and the words in protected_tokens exactly as written (PDF, JPG, PNG, HEIC, WebP, URL, JSON, UUID, EXIF, iPhone, Base64, Orisod, and similar).
- Keep every link and every tag. Change only the words between tags: the same <a href>, <strong>, <code> and other tags must appear in the same order, and text inside <code> stays as it is.
- Sentence case for titles, H1s, headings, meta descriptions and card text: capitalize the first word and the first word after a colon or pipe; proper nouns and acronyms keep their casing; everything else is lowercase. Tool names (for example "Compress Image") keep their capitals.
- Never change the words of <title> or <meta name="description"> (field_type "title" and "meta_description"). Those carry search keywords such as "Free", "Online" and "Gratis". Only capitalization and punctuation may change there.
- Don't touch blocks marked "editable": false. Their "note" says why (tool names, copies of cards kept in sync elsewhere, the link to the tool's guide, code).
- Keep the 📖 "Want the full picture? Read our guide" / "¿Quieres saber más? Lee nuestra guía" line exactly as it is.
- Spanish is natural, neutral Spanish written for the reader, not a word-for-word translation. Keep English and Spanish saying the same things: if you change a fact or a structure in one language, make the same change in the other (blocks with the same pair_id are the same block in both languages).
- svg_text blocks are short labels drawn inside a diagram: keep them about the same length.

## How to answer

Return the same JSON as a downloadable .json file. For each block you change, add
two fields: "replacement_html" (the new inner HTML, same tags) and
"change_reason" (one short sentence). Leave every other field exactly as it is,
including source_html and html_sha256, and don't add, remove or reorder blocks.
Leave "replacement_html" out of blocks you don't change. After the file, list
anything you noticed but didn't change (possible factual errors, EN/ES mismatches).
