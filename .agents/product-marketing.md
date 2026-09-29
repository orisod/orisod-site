# Product Marketing Context

**Document version:** v1
**Last updated:** 2026-09-28

## Product Overview
**One-liner:** Free, browser-based tools for images and PDFs. Your files never leave your device.
**What it does:** Orisod (orisod.com) brings 75 focused file tools into one place: convert, compress, resize and crop images; merge, split, compress, edit, sign and OCR PDFs; plus everyday utilities such as a QR code generator, EXIF remover and password generator. Everything runs client-side in the browser with JavaScript, so there is nothing to install, no account to create, and nothing is uploaded to a server.
**Product category:** Online image and PDF tools / file converters (people search for the specific task: "heic to jpg", "merge pdf", "compress image", "remove exif data").
**Product type:** Free web-based tool site (static site, no backend), English + Spanish.
**Business model:** 100% free, no signup, no paid tier, and permanently ad-free (a firm product decision, not a "not yet"). Funded by optional, voluntary donations via Stripe on the Support page (not tax-deductible; nothing is given in exchange). Growth is organic: SEO on tool pages plus a guide/blog post for every tool.

## Target Audience
**Target companies:** Primarily individuals (B2C), not companies. Secondarily, people doing file tasks at work who can't or shouldn't upload documents to a third-party server.
**Decision-makers:** The person doing the task. No buying committee.
**Primary use case:** Getting one specific file task done quickly (convert, shrink, combine, clean up) without installing software, making an account, or handing the file to someone else's server.
**Jobs to be done:**
- "Get this file into the format/size that the form, email, or website I'm using will accept."
- "Do a quick PDF edit (merge, split, reorder, sign, number pages) without paying for Acrobat."
- "Handle a private file (ID scan, contract, personal photo) without uploading it anywhere."
**Use cases:**
- Converting iPhone HEIC photos to JPG so they open or upload anywhere
- Compressing an image or PDF to fit an email or upload size limit
- Merging scanned pages into one PDF for an application
- Stripping location/EXIF metadata from a photo before posting it
- Making a QR code for a link, or a favicon for a small website
- Spanish-speaking users who want the same tools in their own language (/es/)

## Personas
B2C, so no buying-committee personas. Informal user types:

| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| Everyday user with a one-off task | Getting it done fast, for free | Other sites hit them with ads, upsells, or a signup wall mid-task | Open the page, drop the file, done. No account, no install |
| Privacy-conscious user | Sensitive files not leaving their device | Can't tell what online converters do with uploaded files | Processing happens locally in the browser; files are never uploaded |
| Office/admin worker | Quick PDF fixes without buying software | No Acrobat license; IT may frown on uploading work documents | Real PDF editing (merge, split, sign, OCR) in the browser, nothing sent to a server |

## Problems & Pain Points
**Core problem:** Online converters are easy to find but not clear to use (from the About page: "Online image and PDF converters are easy to find. Clear ones are not.").
**Why alternatives fall short:**
- Useful controls buried behind ads
- An account required halfway through the task
- Daily limits, watermarks, or paywalls on the "free" version
- Sending you to another site for the next step
- Files uploaded to a server for processing, with no easy way to know what happens to them
**What it costs them:** Time, frustration, sometimes money for a paid plan they needed for one task, and privacy risk for sensitive documents.
**Emotional tension:** Mild anxiety about where a private file ends up; irritation at being tricked into signing up or paying at the last step.

## Competitive Landscape
**Direct:** iLovePDF, Smallpdf, TinyWow and similar all-in-one online tool sites. They fall short because they typically process files on their servers, and they rely on ads, free-tier limits, or accounts/paid plans.
**Secondary:** Desktop software (Adobe Acrobat, Photoshop, built-in OS apps like macOS Preview). They fall short because they're paid, need installing, or aren't available on the device the user has right now.
**Indirect:** Doing nothing or working around it (screenshots instead of converting, asking a colleague, emailing the file to themselves). This falls short because it's slower, gives lower quality, and doesn't fix the problem.

## Differentiation
**Key differentiators:**
- 100% client-side processing: files are never uploaded, which is the core brand promise
- Permanently ad-free: a firm product decision, not a temporary state
- Completely free, with no signup and no usage limits imposed by a paid tier
- One consistent interface across 75 tools; the dropzone is at the top of every page, no scrolling to start
- Real PDF manipulation (pdf-lib) that keeps text and vector content, instead of rasterizing
- Fully bilingual (English + Spanish), including tool guides
**How we do it differently:** The processing runs in the user's own browser (JavaScript and WebAssembly libraries), so there is no server-side pipeline to monetize with ads, accounts, or limits.
**Why that's better:** It's private by design, not by policy promise; there's no upload wait; and there are no bait-and-switch paywalls.
**Why customers choose us:** Unknown. No user research yet. Hypothesis: privacy plus no friction (no ads, no account).

## Objections
| Objection | Response |
|-----------|----------|
| "Free sites always have a catch. What's the business model?" | No ads (ever: the site is permanently ad-free), no data sale, no paid tier. It's funded by optional donations. Files can't be monetized because they never reach us. |
| "Is it really not uploading my file?" | Processing happens in your browser. Only Google Analytics page-visit data is collected, never file contents (see Privacy Policy). |
| "Will it handle big or complex files?" | It depends on the device's memory and browser. Very large files can be slow on older phones. (Honest limitation: don't overclaim.) |

**Anti-persona:** Teams needing collaboration, cloud storage, API access, or batch automation at scale; users who want a desktop app or guaranteed enterprise support/SLAs.

## Switching Dynamics
**Push:** Ads, signup walls, daily limits, watermarks and paywalls on the tools they currently use; unease about uploading private files.
**Pull:** Free with no catch, no account, privacy by design, and a clean, consistent UI.
**Habit:** They already know iLovePDF/Smallpdf by name, and they have them bookmarked or they rank first in Google.
**Anxiety:** "Is a site I've never heard of trustworthy?" and "Will the quality be as good?"

## Customer Language
**How they describe the problem:** No verbatim customer quotes collected yet. Search-query language from the tool pages: "convert heic to jpg", "compress pdf", "merge pdf free", "remove exif data".
**How they describe us:** Not yet captured.
**Words to use:** free, private, in your browser, on your device, no signup, no install, never uploaded, simple, fast
**Words to avoid:** "upload" when describing how Orisod handles files (they are selected/processed, not uploaded); "AI-powered" hype; SaaS funnel language (trial, plan, upgrade, pricing); exaggerated superlatives. No em dashes in site copy (site editorial rule).
**Glossary:**
| Term | Meaning |
|------|---------|
| Client-side / local processing | The file is processed by the user's browser, never sent to a server |
| Tool page | One tool per URL, e.g. /compress-image |
| Guide | The blog post that ships with every tool (EN + ES) |
| Orisod Labs | The name used for the maker/copyright holder |

## Brand Voice
**Tone:** Calm, plain, helpful; low-pressure (Support page: "No pressure, just appreciated if you'd like to help keep this free.").
**Style:** Direct and practical, short sentences, no jargon, no hype. Explain what the tool does and get out of the way.
**Personality:** Honest, understated, trustworthy, practical, privacy-minded.

## Proof Points
**Metrics:** 75 tools (21 image, 36 PDF, 18 utility), per the live /tools page on 2026-09-28; 74 blog posts; full English + Spanish coverage. No traffic/user numbers are published.
**Customers:** None cited. Individual users, no logos.
**Testimonials:** None yet.
**Value themes:**
| Theme | Proof |
|-------|-------|
| Privacy | Client-side architecture; open-source code (MIT) anyone can inspect on GitHub |
| Free, no catch | No ads, no account, no paid tier; voluntary donations only |
| Breadth | 75 tools across images, PDFs and utilities in one consistent interface |
| Accessibility of language | Every tool and guide in English and Spanish |

## Goals
**Business goal:** Grow organic search traffic (tool pages + guides) and make the site sustainable through voluntary donations. Orisod is permanently ad-free: Google AdSense was considered early on and explicitly dropped, and it is not a future option. (Affiliate links were also floated as an idea; not active.)
**Conversion action:** Primary: a visitor completes a tool task (and returns/bookmarks). Secondary: a voluntary donation via the Support page.
**Current metrics:** Tracked in Google Analytics 4 (G-V2GMNDCVMK); not recorded here yet.

## Changelog
*Newest first. One line per revision: what changed and why.*
- v1 (2026-09-28) — Initial context, auto-drafted from the site's home, About and Support pages and CLAUDE.md; ads stated as permanently off; tool count checked against live /tools (75).
