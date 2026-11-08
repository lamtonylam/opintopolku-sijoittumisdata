# AGENTS.md — Sijoittumisdata Opintopolussa

MV3 extension that shows Statistics Finland graduate outcomes (unemployment rate,
median income) inline on Opintopolku programme pages. Matching runs 100% locally
against committed JSON snapshots; no backend, no user data leaves the browser.

## Repo map

- `manifest.json` — MV3. Content scripts `match.js` then `content.js` on
  `https://opintopolku.fi/konfo/*`. Popup (`popup.html`/`popup.js`) is only the
  toolbar toggle + dataset vintage.
- `match.js` — pure matching logic (no DOM). Loadable in node via `vm` (see
  `scripts/test-match.mjs`); attaches to `window.__sijoittumisMatcher` in browser.
- `content.js` — DOM extraction (SPA-aware router) + inline panel UI (Shadow DOM).
- `data/degrees.json`, `data/ai-mappings.json` — committed offline snapshots.
  Rebuild via `npm run build:data` / `npm run categorize` (needs
  `scripts/catalog.json`, gitignored, + `.env` LiteLLM key).
- `scripts/test-match.mjs` — offline regression tests. `scripts/ai-*.mjs|json` —
  AI mapping pipeline inputs.
- `tests/` + `playwright.config.js` + `scripts/e2e.mjs` — live-DOM Playwright
  suite (see policy below).

## Commands

- `npm test` — offline matcher tests. **Always safe, run freely and often.**
- `npm run test:e2e` — live tests against real opintopolku.fi. **Gated:**
  requires `E2E_LIVE=1`, throttled to once per 24h (`E2E_FORCE=1` overrides).
  Never add it to `npm test`, never run it on a loop, never raise retries or
  workers to multiply traffic. One proving run per change, then stop.
- `node --check <file>` after every edit touching JS.

## Architecture invariants (do not break)

1. **Konfo is an SPA.** Content scripts inject only on full page load, so the
   router (`route()` + 500ms URL poll + `MutationObserver`) handles client-side
   navigation. **Never narrow `content_scripts.matches`** — arriving from search
   via SPA nav would leave the script unloaded and the panel missing.
2. **Never mutate dataset objects.** `match()` returns shared references into
   `data/*.json`. Cross-page state leaks (e.g. the old `_fuzzy` flag bug). Pass
   match quality explicitly (e.g. `approximate` into `renderPanel`).
3. **Detail pages: one inline section, inserted before the "Koulutuksen
   perustiedot" heading** via `findDetailSlot()` (text-anchored, never hashed
   MUI classes — they change every Konfo rebuild). Re-anchor on re-render;
   Konfo swaps DOM under you constantly.
4. **Haku pages: one native fact row per result card, never a box.** Clone the
   card's own `.EntiteettiKortti-iconTexts` row markup (`injectCardLine`); new
   markup must stay visually identical to Konfo rows. No match → no row, never
   a guess. Detail panel must never appear on haku.
5. **Style isolation:** detail panel lives in Shadow DOM; haku rows live in
   light DOM (must use Konfo classes/inline styles, never shadow CSS).
   Sample the neighbouring Konfo paper for tint (`findPaperStyle`) instead of
   hardcoding colors.
6. **No dismiss UI by design.** The panel has no close button; visibility is
   controlled by the toolbar toggle. `renderDetail` must stay idempotent —
   observer re-renders converge on the same node via `ensureHost`
   re-anchoring, never duplicate it.
7. **Minimal permissions:** no `host_permissions` (all fetches are
   `chrome.runtime.getURL`). Keep `web_accessible_resources` for the JSON.

## Data pipeline notes

- `match()` stage order: AI oid/title map → exact name → alias (title) →
  fuzzy-title (+parenthetical-stripped retry) → alias (title+context) → fuzzy-all.
  Gate `ACCEPT_SCORE = 0.5`; `kandiohjelma` / `(3 v + 2 v)` titles force master's.
- `ai-mappings.json` merges per-oid across filter runs; null degree = explicit
  no-map (falls through to fuzzy). Validate ids against the catalog on ingest.
- School matching: alias map first, then token-subset; faculty names must never
  shadow the university provider.

## Working agreements

- Small files: read fully before editing. Large files / long outputs: page with
  offset+limit or summarize via sandbox; never dump whole files into chat.
- `edit` needs exact unique `oldText`; re-read the region if a match fails
  (file drift), don't resubmit blindly.
- `.env` holds a live API key: gitignored, never print it, never commit it.
  Suggest rotation if it may have leaked.
- Definition of done: `node --check`, `npm test` green, and for DOM changes
  one live Playwright verification (then stop — see e2e policy).
