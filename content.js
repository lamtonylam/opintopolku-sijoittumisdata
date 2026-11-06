/**
 * Sijoittumisdata Opintopolussa — content script.
 *
 * Runs on opintopolku.fi/konfo/* pages:
 * - toteutus / koulutus pages → full floating panel with matched stats
 * - haku (search result) pages → compact inline badges per result card
 *
 * Signal extraction is DOM-based with layered fallbacks, because Konfo's
 * markup is generated and selectors may change. If extraction fails, the
 * script does nothing (never shows a wrong number).
 */
"use strict";

const DASHBOARD_URL = ""; // e.g. "https://example.fi" — dashboard links hidden when empty.
const PANEL_ID = "sijoittumisdata-panel";
const DEBUG = false;

function log(...args) {
  if (DEBUG) console.log("[sijoittumisdata]", ...args);
}

function detectLang(pathname) {
  const match = pathname.match(/^\/konfo\/(fi|sv|en)\//);
  return match ? match[1] : "fi";
}

function detectPageType(pathname) {
  if (/\/konfo\/(fi|sv|en)\/toteutus\//.test(pathname)) return "toteutus";
  if (/\/konfo\/(fi|sv|en)\/koulutus\//.test(pathname)) return "koulutus";
  if (/\/konfo\/(fi|sv|en)\/haku\//.test(pathname)) return "haku";
  return "other";
}

const STRINGS = {
  fi: {
    title: "Sijoittumisdata",
    unemployment: "Työttömyysaste",
    income: "Mediaanitulo",
    residents: "Suomessa asuvia",
    school: "Oppilaitos",
    national: "Koko maa",
    approximate: "Todennäköinen vastaavuus — tarkista tutkinto.",
    noData: "Tälle tutkinnolle ei löytynyt sijoittumisdataa.",
    openComparison: "Avaa tutkintovertailu",
    close: "Sulje",
    vintage: (g, i) => `Valmistuneet ${g}, tulot ${i}`,
  },
  sv: {
    title: "Sysselsättningsdata",
    unemployment: "Arbetslöshetsgrad",
    income: "Medianinkomst",
    residents: "Bosatta i Finland",
    school: "Läroanstalt",
    national: "Hela landet",
    approximate: "Trolig matchning — kontrollera examen.",
    noData: "Ingen sysselsättningsdata hittades för denna examen.",
    openComparison: "Öppna jämförelsen",
    close: "Stäng",
    vintage: (g, i) => `Utexaminerade ${g}, inkomster ${i}`,
  },
  en: {
    title: "Graduate outcomes",
    unemployment: "Unemployment rate",
    income: "Median income",
    residents: "Residing in Finland",
    school: "Institution",
    national: "Whole country",
    approximate: "Probable match — please verify the degree.",
    noData: "No outcome data found for this programme.",
    openComparison: "Open comparison",
    close: "Close",
    vintage: (g, i) => `Graduates ${g}, income ${i}`,
  },
};

function fmtPct(value) {
  return `${String(value).replace(".", ",")} %`;
}

function fmtEur(value) {
  return `${Number(value).toLocaleString("fi-FI")} €`;
}

// ---------------------------------------------------------------------------
// Signal extraction (layered fallbacks)
// ---------------------------------------------------------------------------

function firstText(selectors, root) {
  const scope = root || document;
  for (const selector of selectors) {
    const el = scope.querySelector(selector);
    if (el && el.textContent && el.textContent.trim()) {
      return el.textContent.trim();
    }
  }
  return "";
}

// Stable Konfo hooks (verified against the live DOM: MUI markup where the
// degree names sit behind aria-labelledby anchors, not in dl/table rows).
const LABELLED_IDS = ["tutkintonimikkeet", "koulutustyyppi", "koulutusala"];

function labelledValues() {
  const out = [];
  LABELLED_IDS.forEach((id) => {
    document.querySelectorAll(`[aria-labelledby="${id}"]`).forEach((el) => {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text && !out.includes(text)) out.push(text);
    });
  });
  return out;
}

function extractDetailPage(pageType) {
  // Title: h1 first, then og:title, then document.title.
  const h1 = firstText(["main h1", "h1"]);
  const ogTitle = document.querySelector('meta[property="og:title"]');
  const title = h1 || (ogTitle && ogTitle.getAttribute("content")) || document.title;

  // Provider: prefer the university-level oppilaitos link. Toteutus pages
  // often link both the university and the faculty (tiedekunta/faculty);
  // the faculty name is not in the dataset, so it must not shadow the
  // university. Koulutus pages list several toteutukset → national scope.
  let provider = "";
  if (pageType !== "koulutus") {
    const scope = document.querySelector("main") || document;
    const providerLinks = [...scope.querySelectorAll('a[href*="/oppilaitos/"]')]
      .map((a) => (a.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const isFaculty = (name) => /tiedekunta|faculty|fakultet|institutionen/i.test(name);
    provider =
      providerLinks.find((name) => !isFaculty(name)) || providerLinks[0] || "";
  }

  // Koulutus link from a toteutus page (names the degree level); its oid
  // keys the AI-curated mapping, so toteutus pages resolve exactly.
  const koulutusLink = document.querySelector('a[href*="/koulutus/"]');
  const koulutusName =
    koulutusLink && koulutusLink.textContent.trim() ? koulutusLink.textContent.trim() : "";
  const oidIn = (href) => {
    const m = href && href.match(/1\.2\.246\.[0-9.]+/);
    return m ? m[0] : "";
  };

  return {
    title: title.replace(/\s+/g, " ").trim(),
    provider,
    oid: oidIn(window.location.pathname),
    koulutusOid: oidIn(koulutusLink && koulutusLink.getAttribute("href")),
    extra: [...labelledValues(), koulutusName].filter(Boolean).join(" ").slice(0, 4000),
  };
}

function extractResultCards() {
  // Search-result cards (verified hook: .EntiteettiKortti-paperRoot).
  // Card tail holds tutkintonimike, laajuus and the provider, in that order.
  const anchors = document.querySelectorAll(
    'main a[href*="/toteutus/"], main a[href*="/koulutus/"]',
  );
  const cards = [];
  const seen = new Set();
  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const oid = href.split("/").pop().split("?")[0];
    if (!oid || seen.has(oid)) return;
    seen.add(oid);
    const card =
      anchor.closest(".EntiteettiKortti-paperRoot") ||
      anchor.closest("article, li") ||
      anchor.parentElement ||
      anchor;
    const text = (card.textContent || "").replace(/\s+/g, " ").trim().slice(0, 1500);
    const heading = card.querySelector("h2, h3");
    const title = ((heading && heading.textContent) || anchor.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    const lines = [...card.querySelectorAll("p")]
      .map((p) => (p.textContent || "").replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0);
    const provider =
      [...lines]
        .reverse()
        .find((line) => line.length < 80 && !/opintopist/i.test(line) && !/^\d/.test(line)) ||
      "";
    if (title) cards.push({ oid, title, provider, text, anchor });
  });
  return cards;
}

// ---------------------------------------------------------------------------
// Panel UI (Shadow DOM, isolated from Konfo styles)
// ---------------------------------------------------------------------------

function ensureHost() {
  let host = document.getElementById(PANEL_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = PANEL_ID;
    document.body.appendChild(host);
  }
  return host;
}

function buildEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function renderPanel({ t, degree, school, meta, dashboardUrl }) {
  const host = ensureHost();
  host.replaceChildren();
  const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  shadow.replaceChildren();

  const hasData = Boolean(degree);
  const national = degree
    ? { u: degree.u, m: degree.m, r: degree.r }
    : null;
  const shown = school || national;
  const scopeLabel = school ? `${t.school}: ${school.n}` : t.national;

  const comparisonHref =
    dashboardUrl && degree
      ? `${dashboardUrl}#/vertailu/${encodeURIComponent(degree.id)}`
      : "";

  const style = document.createElement("style");
  style.textContent = [
    ":host { all: initial; }",
    ".card {",
    "  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;",
    "  width: min(400px, calc(100vw - 32px));",
    "  max-height: min(520px, calc(100vh - 32px));",
    "  min-width: 280px; min-height: 160px;",
    "  resize: both; overflow: auto;",
    '  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;',
    "  font-size: 13px; line-height: 1.45; color: #1a1a1a;",
    "  background: #fff; border: 1px solid #e2e2e2; border-radius: 12px;",
    "  box-shadow: 0 8px 30px rgba(0,0,0,.18);",
    "  padding: 16px 18px;",
    "}",
    ".card.empty {",
    "  width: auto; max-width: min(340px, calc(100vw - 32px));",
    "  min-width: 0; min-height: 0; resize: none;",
    "  background: #f4f5f7; padding: 12px 14px;",
    "}",
    ".card.empty .note { margin-top: 4px; }",
    ".card.empty .foot { margin-top: 6px; }",
    ".head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
    ".head b { font-size: 13px; }",
    ".head button {",
    "  border: 0; background: transparent; cursor: pointer;",
    "  font-size: 16px; line-height: 1; color: #666; padding: 2px 6px;",
    "}",
    ".degree { margin: 6px 0 2px; font-weight: 600; }",
    ".scope { color: #666; font-size: 12px; }",
    ".stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }",
    ".stat { background: #f5f6f8; border-radius: 8px; padding: 8px 10px; }",
    ".stat span { display: block; font-size: 11px; color: #666; }",
    ".stat b { font-size: 16px; font-variant-numeric: tabular-nums; }",
    ".note { margin-top: 8px; font-size: 11px; color: #666; }",
    ".warn { color: #8a5a00; }",
    ".foot { margin-top: 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }",
    ".foot a { color: #0b5fff; font-size: 12px; }",
    ".foot span { font-size: 11px; color: #888; }",
  ].join("\n");
  shadow.append(style);

  const card = buildEl("div", hasData ? "card" : "card empty");
  card.setAttribute("role", "complementary");
  card.setAttribute("aria-label", t.title);

  const head = buildEl("div", "head");
  head.append(buildEl("b", null, t.title));
  const closeButton = buildEl("button", null, "\u00d7");
  closeButton.setAttribute("type", "button");
  closeButton.setAttribute("aria-label", t.close);
  closeButton.addEventListener("click", () => host.remove());
  head.append(closeButton);
  card.append(head);

  const vintageText = t.vintage(meta.graduationYear, meta.incomeYear);
  const foot = buildEl("div", "foot");

  if (hasData) {
    card.append(buildEl("p", "degree", degree.name));
    card.append(
      buildEl("p", "scope", `${scopeLabel} \u00b7 ${shown.r} ${t.residents.toLocaleLowerCase()}`),
    );

    const stats = buildEl("div", "stats");
    const statU = buildEl("div", "stat");
    statU.append(buildEl("span", null, t.unemployment), buildEl("b", null, fmtPct(shown.u)));
    const statM = buildEl("div", "stat");
    statM.append(buildEl("span", null, t.income), buildEl("b", null, fmtEur(shown.m)));
    stats.append(statU, statM);
    card.append(stats);

    if (degree._fuzzy) card.append(buildEl("p", "note warn", t.approximate));

    if (comparisonHref && /^https:\/\//.test(dashboardUrl)) {
      const link = buildEl("a", null, t.openComparison);
      link.setAttribute("href", comparisonHref);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noreferrer");
      foot.append(link);
    } else {
      foot.append(buildEl("span"));
    }
    foot.append(buildEl("span", null, vintageText));
  } else {
    card.append(buildEl("p", "note", t.noData));
    foot.append(buildEl("span"), buildEl("span", null, vintageText));
  }
  card.append(foot);
  shadow.append(card);
}

function injectBadge(card, result, t) {
  if (card.querySelector("[data-sijoittumis-badge]")) return;
  const badge = document.createElement("div");
  badge.setAttribute("data-sijoittumis-badge", "true");
  badge.textContent = result
    ? `${t.title}: ${result.degree.name} — ${fmtPct(result.school ? result.school.u : result.degree.u)} / ${fmtEur(result.school ? result.school.m : result.degree.m)}`
    : `${t.title}: ${t.noData}`;
  badge.style.cssText =
    "margin-top:6px;font-size:12px;color:#1a1a1a;background:#f0f4ff;" +
    "border:1px solid #ccd8ff;border-radius:6px;padding:4px 8px;";
  const anchor = card.anchor;
  if (anchor.parentElement) {
    anchor.parentElement.insertBefore(badge, anchor.nextSibling);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function init() {
  try {
    const stored = await chrome.storage.local.get({ enabled: true });
    if (stored.enabled === false) return;
  } catch {
    // storage unavailable — continue enabled.
  }

  let data;
  try {
    const response = await fetch(chrome.runtime.getURL("data/degrees.json"));
    data = await response.json();
  } catch (error) {
    log("dataset load failed", error);
    return;
  }

  // AI-curated oid -> degree mapping (offline). Optional: fuzzy matching
  // is the fallback when the file is missing or has no entry.
  let aiByOid = {};
  try {
    const aiResponse = await fetch(chrome.runtime.getURL("data/ai-mappings.json"));
    if (aiResponse.ok) aiByOid = (await aiResponse.json()).mappings || {};
  } catch (error) {
    log("AI mappings unavailable, fuzzy only", error);
  }

  const api = window.__sijoittumisMatcher;
  if (!api) {
    log("match.js not loaded");
    return;
  }
  const { match } = api.createMatcher(data.degrees, { byOid: aiByOid });
  // SPA router: Konfo swaps toteutus/koulutus/haku content client-side
  // without reloading the content script, so routing is re-evaluated on
  // every URL change and detail content is watched persistently. A render
  // that fires while Konfo still shows the previous (or skeleton) content
  // is corrected as soon as the new signals arrive.
  let mode = null; // "detail" | "haku" | null
  let lastKey = "";
  let detailObserver = null;
  let hakuObserver = null;
  let debounceTimer = 0;

  const currentT = () => STRINGS[detectLang(window.location.pathname)] || STRINGS.fi;
  const isPlaceholderTitle = (title) =>
    !title || /^opintopolku$/i.test(title) || title.length < 4;

  const renderDetail = () => {
    const signals = extractDetailPage(detectPageType(window.location.pathname));
    log("signals:", signals);
    if (isPlaceholderTitle(signals.title)) return false;
    const key = `${signals.title}||${signals.provider}||${signals.extra}`;
    if (key === lastKey) return true;
    lastKey = key;
    const result = match(signals);
    if (result && result.method === "fuzzy") result.degree._fuzzy = true;
    renderPanel({
      t: currentT(),
      degree: result ? result.degree : null,
      school: result ? result.school : null,
      meta: data.meta,
      dashboardUrl: DASHBOARD_URL,
    });
    return true;
  };

  const processHakuCards = () => {
    const t = currentT();
    for (const card of extractResultCards()) {
      const result = match({
        title: card.title,
        provider: card.provider,
        extra: card.text,
        oid: card.oid,
      });
      injectBadge(card, result, t);
    }
  };

  const teardown = () => {
    if (detailObserver) detailObserver.disconnect();
    if (hakuObserver) hakuObserver.disconnect();
    detailObserver = null;
    hakuObserver = null;
    lastKey = "";
    const host = document.getElementById(PANEL_ID);
    if (host) host.remove();
  };

  const route = () => {
    const pageType = detectPageType(window.location.pathname);
    const want =
      pageType === "toteutus" || pageType === "koulutus"
        ? "detail"
        : pageType === "haku"
          ? "haku"
          : null;
    log("route:", pageType, "->", want);
    if (want !== mode) {
      teardown();
      mode = want;
      if (mode === "detail") {
        renderDetail();
        // Persistent watch: Konfo hydrates late and may briefly keep
        // the previous page's DOM after navigation. Debounced;
        // renderDetail is a no-op when signals are unchanged.
        detailObserver = new MutationObserver(() => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(renderDetail, 200);
        });
        detailObserver.observe(document.documentElement, { childList: true, subtree: true });
      } else if (mode === "haku") {
        processHakuCards();
        hakuObserver = new MutationObserver(() => processHakuCards());
        hakuObserver.observe(document.body, { childList: true, subtree: true });
      }
    } else if (mode === "detail") {
      renderDetail();
    } else if (mode === "haku") {
      processHakuCards();
    }
  };

  route();
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      route();
    }
  }, 500);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
