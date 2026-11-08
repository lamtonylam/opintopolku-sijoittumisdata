# Sijoittumisdata Opintopolussa

A Chrome/Edge (MV3) extension that shows graduate outcomes — unemployment rate
and median income from Statistics Finland's sijoittumispalvelu (graduates
2023, income 2024) — directly on Opintopolku programme pages.

- **Toteutus / koulutus pages** (`opintopolku.fi/konfo/*/toteutus/*`,
  `.../koulutus/*`): inline section inserted before "Koulutuksen perustiedot"
  with the matched degree, school-specific
  stats when the provider matches, otherwise national figures. Uncertain
  (fuzzy) matches are flagged; anything it can't confidently match shows a
  compact "no data" note instead of a number.
- **Haku (search) pages**: one native fact row inside each result card (työttömyysaste · mediaanitulo); cards without a confident match stay untouched.
- **Popup**: on/off toggle, dataset vintage, optional dashboard deep link.

Matching runs 100% locally: AI-curated oid/title map (`data/ai-mappings.json`,
260 + 213 programmes) → exact name → curated aliases → idf-weighted fuzzy
scoring with sector/level gating. Kandiohjelma and combined 3v+2v titles
always resolve to the master's degree.

## Installing in Chrome (unpacked, from outside the Web Store)

Chrome blocks installing extensions from random websites, so sideloading goes
through **Developer Mode**. This is the officially supported path for
unpacked extensions — nothing shady, but Chrome will show you warnings.
That's normal.

1. **Get the code.** On this repo's GitHub page: `Code` → `Download ZIP`,
   then extract it anywhere (e.g. `~/sideprojects/opintopolku-sijoittumisdata`).
   Or `git clone` it. No build step — the extension runs straight from source.
2. **Open the extensions page.** Type `chrome://extensions` in the address
   bar and press Enter.
3. **Enable Developer Mode.** Toggle in the top-right corner of that page.
   Chrome may warn you that Developer Mode extensions can harm your
   computer — it says this for *all* unpacked extensions. Only proceed with
   code you trust (this repo is fully readable source: no bundled blobs,
   no minified code, no network calls — see Privacy below).
4. **Load the extension.** Click `Load unpacked` (new button, top-left) and
   select the extension folder — the one containing `manifest.json`
   (i.e. the repo root, not `data/` or `scripts/`).
5. **Pin it (optional).** Click the puzzle-piece icon in the toolbar →
   pin icon next to "Sijoittumisdata" so the popup is one click away.
6. **Try it.** Open any Opintopolku toteutus page, e.g. a Tietojenkäsittelytiede
   programme — the box appears bottom-right with the degree's stats.

Notes:

- Chrome shows a *"Disable developer mode extensions"* prompt on every
  browser restart while unpacked extensions are installed. Click Cancel to
  keep using it — this is standard Chrome behavior, not a problem with this
  extension.
- **Updates are manual.** Unpacked extensions don't auto-update: pull (or
  re-download) the repo, then hit the reload ⟳ button on the extension's
  card at `chrome://extensions`.
- **Removing it.** `chrome://extensions` → `Remove` on the extension's card.
  It stores one toggle (`enabled`) in `chrome.storage.local`, which is
  deleted with the extension.
- **Microsoft Edge** works the same way via `edge://extensions` (Developer
  Mode → Load unpacked). Firefox/Safari are not supported
  (`chrome.storage`/`chrome.runtime` MV3 APIs as used here).

## Usage

- The box is resizable (drag the bottom-right corner) and closable (×).
- Click the toolbar icon for the popup: enable/disable the extension and
  see the dataset vintage.
- If a page shows *"Tälle tutkinnolle ei löytynyt sijoittumisdataa"*,
  the programme genuinely has no counterpart in the Statistics Finland
  degree set — nothing is guessed.

## Matching cheat sheet

`match.js` is pure logic (no DOM), shared by the content script and the
tests — `npm test` must stay green:

1. AI-curated map by Opintopolku oid (page URL), then by
   koulutus oid (toteutus pages link their koulutus), then title.
2. Exact normalized degree name.
3. Curated degree/school aliases.
4. Fuzzy title scoring (0.5 accept gate, `kandiohjelma` / `(3 v + 2 v)` titles
   forced to master's level).
5. Full title + page context.

## Refreshing the data

`data/degrees.json` (295 degrees, slim short-key format) and
`data/ai-mappings.json` (496 curated oid → degree links) are committed
snapshots — the extension works offline from these.

- `npm run build:data [-- --catalog <path>]`: rebuild `data/degrees.json`
  from a dashboard `data.json` snapshot. Put it at
  `scripts/catalog.json` (gitignored) or pass `--catalog` / `CATALOG_JSON`.
- `npm run categorize -- <koulutustyyppi> [--catalog <path>]`: re-map an
  Opintopolku search (e.g. `kandi-ja-maisteri`, `amk-alempi`) to degree ids
  via LiteLLM (`LITELLM_API_KEY`, `LITELLM_BASE_URL`, `LITELLM_MODEL` in
  `.env`, see `.gitignore`). Merges per-oid; other filters are preserved.
- `npm test`: matcher + AI-map regression cases against the real data.
  Offline — run freely and often.
- `npm run test:e2e`: live-DOM Playwright suite (`tests/`, `playwright.config.js`)
  against real opintopolku.fi. Gated on purpose: needs `E2E_LIVE=1`, runs at
  most once per 24h (`E2E_FORCE=1` overrides), serial with no retries. Never
  add it to `npm test`; one proving run per change, then stop.

## Project structure

```text
manifest.json        MV3 manifest (opintopolku.fi/konfo/* content scripts)
match.js             pure matching logic (tested, no DOM)
content.js           DOM extraction (SPA-aware router) + inline panel UI
popup.html/.js       toolbar popup (toggle + vintage)
data/
  degrees.json       295 degrees with national + per-school stats
  ai-mappings.json   496 AI-curated Opintopolku oid → degree links
scripts/
  test-match.mjs     `npm test` — matcher regression suite
  build-data.mjs     `npm run build:data` — slim the catalog snapshot
  ai-categorize.mjs  `npm run categorize` — LiteLLM mapping pipeline
  ai-programs-*.json raw Opintopolku records that were categorized
```

## Privacy

Everything happens on your machine: the datasets ship inside the
extension, matching runs locally, and the only network traffic is the
Opintopolku pages you already visit. No analytics, no accounts, no data
leaves the browser. (`DASHBOARD_URL` in `content.js`/`popup.js` is empty by
default; setting it only adds an outbound link.)

## Troubleshooting

- **No box on a page**: reload the page, then the extension (⟳ at
  `chrome://extensions`). Konfo is a client-rendered SPA; the content
  script waits for hydration and re-routes on navigation, but a hard
  reload fixes most staleness.
- **Wrong degree**: open DevTools console — the script logs extracted
  signals as `[sijoittumisdata]`. Open an issue with the page URL.
- The section lives inline in the page flow (never covers content) and can
  be dismissed with × or the popup toggle.
