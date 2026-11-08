/**
 * Sijoittumisdata Opintopolussa — content script.
 *
 * Runs on opintopolku.fi/konfo/* pages:
 * - toteutus / koulutus pages → inline section with matched stats
 * - haku pages → one native fact row inside each result card
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
    residents: "Valmistuneita",
    national: "Koko maa",
    degree: "Tutkinto",
    approximate: "Todennäköinen vastaavuus — tarkista tutkinto.",
    noData: "Tälle tutkinnolle ei löytynyt sijoittumisdataa.",
    openComparison: "Avaa tutkintovertailu",
    source: "Lähde: Tilastokeskus",
    vintage: (g, i) => `Valmistuneet ${g}, tulot ${i}`,
  },
  sv: {
    title: "Sysselsättningsdata",
    unemployment: "Arbetslöshetsgrad",
    income: "Medianinkomst",
    residents: "Utexaminerade",
    national: "Hela landet",
    degree: "Examen",
    approximate: "Trolig matchning — kontrollera examen.",
    noData: "Ingen sysselsättningsdata hittades för denna examen.",
    openComparison: "Öppna jämförelsen",
    source: "Källa: Statistikcentralen",
    vintage: (g, i) => `Utexaminerade ${g}, inkomster ${i}`,
  },
  en: {
    title: "Graduate outcomes",
    unemployment: "Unemployment rate",
    income: "Median income",
    residents: "Graduates",
    national: "Whole country",
    degree: "Degree",
    approximate: "Probable match — please verify the degree.",
    noData: "No outcome data found for this programme.",
    openComparison: "Open comparison",
    source: "Source: Statistics Finland",
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
  // Search-result cards: the whole .EntiteettiKortti-paperRoot is wrapped in
  // a single <a> to the koulutus/toteutus page (oid in its href).
  const cards = [];
  const seen = new Set();
  document.querySelectorAll("main .EntiteettiKortti-paperRoot").forEach((root) => {
    const anchor =
      root.closest('a[href*="/toteutus/"], a[href*="/koulutus/"]') ||
      root.querySelector('a[href*="/toteutus/"], a[href*="/koulutus/"]');
    const href = (anchor && anchor.getAttribute && anchor.getAttribute("href")) || "";
    const oid = href.split("/").pop().split("?")[0];
    if (!oid || seen.has(oid)) return;
    seen.add(oid);
    const heading = root.querySelector("h2, h3");
    const title = ((heading && heading.textContent) || root.getAttribute("data-testid") || "")
      .replace(/\s+/g, " ")
      .trim();
    // Own injected rows are excluded so re-runs match on Konfo text only.
    const lines = [...root.querySelectorAll("p")]
      .filter((p) => !p.closest("[data-sijoittumis]"))
      .map((p) => (p.textContent || "").replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0);
    const provider =
      [...lines]
        .reverse()
        .find(
          (line) =>
            line.length < 80 && !/opintopist/i.test(line) && !/^\d/.test(line) && !/[%€]/.test(line),
        ) || "";
    if (title) cards.push({ oid, title, provider, text: lines.join(" ").slice(0, 1500), root });
  });
  return cards;
}

function injectCardLine(item, result, t, meta) {
  const root = item.root;
  if (!root || !root.isConnected) return;
  if (root.querySelector("[data-sijoittumis]")) return;
  if (!result) return; // no guess on cards without a confident match
  const value = result.school || result.degree;
  const text = `${t.unemployment} ${fmtPct(value.u)} · ${t.income} ${fmtEur(value.m)}`;
  const tooltip = `${result.degree.name} · ${t.vintage(meta.graduationYear, meta.incomeYear)} · ${t.source}`;
  const box = root.querySelector(".EntiteettiKortti-iconTexts");
  const template = box && box.querySelector(":scope > div > p");
  let row;
  if (box && template) {
    // Clone the card's own fact-row markup so the line is native, not a box.
    row = template.parentElement.cloneNode(false);
    const p = template.cloneNode(false);
    p.removeAttribute("id");
    p.textContent = "";
    const svg = iconSvg("stats");
    svg.setAttribute("class", "MuiSvgIcon-root MuiSvgIcon-fontSizeMedium");
    svg.style.cssText = "margin-right:8px;width:24px;height:24px;flex:none;";
    p.append(svg, document.createTextNode(text));
    p.setAttribute("title", tooltip);
    row.append(p);
  } else {
    // Fallback plain line when the card layout is unknown.
    row = buildEl("div", null);
    row.style.cssText = "margin-top:4px;font-size:16px;color:#1d1d1d;";
    row.textContent = text;
    row.setAttribute("title", tooltip);
  }
  row.setAttribute("data-sijoittumis", "true");
  (box || root).append(row);
}



// ---------------------------------------------------------------------------
// Inline section UI (Shadow DOM, isolated from Konfo styles)
//
// The panel is inserted straight into Konfo's content column, right before
// the "Koulutuksen perustiedot" section — no floating overlay. The anchor
// search avoids hashed MUI class names so it survives Konfo rebuilds.
// ---------------------------------------------------------------------------

function findPerustiedotSection() {
  const main = document.querySelector("main");
  if (!main) return null;
  for (const h of main.querySelectorAll("h2")) {
    if (/^koulutuksen perustiedot/i.test((h.textContent || "").trim())) {
      let section = h.parentElement;
      while (
        section &&
        section.parentElement &&
        section.parentElement !== main &&
        section.parentElement.children.length < 3
      ) {
        section = section.parentElement;
      }
      if (section && section.parentElement) return section;
    }
  }
  return null;
}

function findPaperStyle() {
  // Blend in: copy the neighbouring Konfo paper's background + radius
  // (papers are field-tinted on some pages, plain white on others).
  const fallback = { background: "#ffffff", radius: "4px" };
  try {
    const paper = findPerustiedotSection()?.querySelector(".MuiPaper-root");
    if (!paper) return fallback;
    const cs = getComputedStyle(paper);
    if (!cs.backgroundColor || cs.backgroundColor === "rgba(0, 0, 0, 0)") return fallback;
    return { background: cs.backgroundColor, radius: cs.borderRadius || "4px" };
  } catch {
    return fallback;
  }
}

function iconSvg(kind) {
  // Minimal 24px icons echoing Konfo's MUI icons (inherit the text color).
  // Built with DOM APIs only (no markup parsing).
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  if (kind === "income") {
    const circle = document.createElementNS(NS, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "8.5");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "2");
    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", "12");
    label.setAttribute("y", "16.5");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "12");
    label.setAttribute("font-weight", "700");
    label.setAttribute("fill", "currentColor");
    label.textContent = "€";
    svg.append(circle, label);
  } else {
    const path = document.createElementNS(NS, "path");
    path.setAttribute(
      "d",
      kind === "stats"
        ? "M5 20V10h3v10H5zm5.5 0V4h3v16h-3zM16 20v-7h3v7h-3z"
        : "M12 3 1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z",
    );
    svg.append(path);
  }
  return svg;
}

function statRow(icon, label, value, sub) {
  const row = buildEl("div", "prow");
  row.append(iconSvg(icon));
  const texts = buildEl("div", null);
  texts.append(buildEl("p", "plabel", label));
  texts.append(buildEl("p", "pvalue", value));
  if (sub) texts.append(buildEl("p", "psub", sub));
  row.append(texts);
  return row;
}

function findDetailSlot() {
  const main = document.querySelector("main");
  if (!main) return null;
  const section = findPerustiedotSection();
  if (section && section.parentElement) {
    return { parent: section.parentElement, before: section };
  }
  // Fallback: right after the h1 block.
  const h1 = main.querySelector("h1");
  if (h1) {
    let el = h1;
    for (let i = 0; i < 3; i++) {
      const parent = el.parentElement;
      if (!parent || parent === main) break;
      if (parent.children.length > 1) {
        return { parent, before: el.nextElementSibling };
      }
      el = parent;
    }
    if (el.parentElement) return { parent: el.parentElement, before: el.nextElementSibling };
  }
  return null;
}

function ensureHost() {
  const slot = findDetailSlot();
  let host = document.getElementById(PANEL_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = PANEL_ID;
  }
  host.style.display = "block";
  host.style.width = "100%";
  host.style.boxSizing = "border-box";
  host.style.margin = "24px 0 0";
  host.style.gridColumn = "1 / -1";
  host.style.flexBasis = "100%";
  if (slot) {
    if (host.parentElement !== slot.parent || host.nextElementSibling !== slot.before) {
      slot.parent.insertBefore(host, slot.before);
    }
  } else if (!host.isConnected) {
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

function renderPanel({ t, approximate, degree, school, meta, dashboardUrl }) {
  const host = ensureHost();
  host.replaceChildren();
  const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  shadow.replaceChildren();

  const hasData = Boolean(degree);
  const national = degree
    ? { u: degree.u, m: degree.m, r: degree.r, g: degree.g }
    : null;
  const shown = school || national;

  const comparisonHref =
    dashboardUrl && degree
      ? `${dashboardUrl}#/vertailu/${encodeURIComponent(degree.id)}`
      : "";

  const style = document.createElement("style");
  style.textContent = [
    ":host { all: initial; display: block; }",
    ".paper {",
    '  font-family: "Open Sans", Arial, Roboto, sans-serif;',
    "  color: #1d1d1d;",
    "  background: #fff; border-radius: 4px;",
    "  box-shadow: 0px 2px 1px -1px rgba(0,0,0,.2), 0px 1px 1px 0px rgba(0,0,0,.14), 0px 1px 3px 0px rgba(0,0,0,.12);",
    "  padding: 8px 24px 16px;",
    "}",
    ".prow { display: grid; grid-template-columns: 24px 1fr; gap: 16px; align-items: start; padding: 12px 0; }",
    ".icon { width: 24px; height: 24px; color: #1d1d1d; margin-top: 2px; flex: none; }",
    ".plabel { margin: 0; font-size: 16px; font-weight: 600; color: #1d1d1d; }",
    ".pvalue { margin: 2px 0 0; font-size: 16px; color: #1d1d1d; font-variant-numeric: tabular-nums; }",
    ".psub { margin: 2px 0 0; font-size: 14px; color: #626262; }",
    ".note { margin: 12px 0 0; font-size: 14px; color: #626262; }",
    ".warn { color: #8a5a00; }",
    ".foot { margin: 12px 0 0; padding-top: 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 12px; color: #626262; }",
    ".foot a { color: #3a7a10; text-decoration: none; }",
    ".foot a:hover { text-decoration: underline; }",
    "@media (max-width: 600px) {",
    "  .paper { padding: 8px 16px 12px; }",
    "  .prow { gap: 12px; }",
    "}",
  ].join("\n");
  shadow.append(style);

  const card = buildEl("div", "paper");
  card.setAttribute("role", "complementary");
  card.setAttribute("aria-label", t.title);

  // Paper tint follows the neighbouring Konfo card (field-tinted on some pages).
  const tint = findPaperStyle();
  card.style.backgroundColor = tint.background;
  card.style.borderRadius = tint.radius;

  const foot = buildEl("div", "foot");
  if (hasData) {
    const scopeSub = school
      ? `${school.n} · ${shown.g} ${t.residents.toLocaleLowerCase()}`
      : `${t.national} · ${shown.g} ${t.residents.toLocaleLowerCase()}`;
    card.append(
      statRow("degree", t.degree, degree.name, scopeSub),
      statRow("stats", t.unemployment, fmtPct(shown.u), null),
      statRow("income", t.income, fmtEur(shown.m), null),
    );
    if (approximate) card.append(buildEl("p", "note warn", t.approximate));
  } else {
    card.append(buildEl("p", "note", t.noData));
  }
  foot.append(
    buildEl("span", null, `${t.vintage(meta.graduationYear, meta.incomeYear)} · ${t.source}`),
  );
  if (comparisonHref && /^https:\/\//.test(dashboardUrl)) {
    const link = buildEl("a", null, t.openComparison);
    link.setAttribute("href", comparisonHref);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noreferrer");
    foot.append(link);
  }
  card.append(foot);
  shadow.append(card);
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
  // SPA router: Konfo swaps toteutus/koulutus content client-side
  // without reloading the content script, so routing is re-evaluated on
  // every URL change and detail content is watched persistently. A render
  // that fires while Konfo still shows the previous (or skeleton) content
  // is corrected as soon as the new signals arrive.
  let mode = null; // "detail" | null
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
    if (key === lastKey && document.getElementById(PANEL_ID)?.isConnected) {
      // Same content and node still anchored (Konfo re-renders often);
      // re-anchor in case surrounding DOM moved, then skip.
      ensureHost();
      return true;
    }
    lastKey = key;
    const result = match(signals);
    // Never mutate the shared dataset object (no `_fuzzy` flag on it):
    // the same degree recurs across SPA navigations and a stale flag
    // would warn on later exact matches. Pass match quality explicitly.
    const approximate = result?.method === "fuzzy";
    renderPanel({
      t: currentT(),
      approximate,
      degree: result ? result.degree : null,
      school: result ? result.school : null,
      meta: data.meta,
      dashboardUrl: DASHBOARD_URL,
    });
    return true;
  };



  const processHakuCards = () => {
    const t = currentT();
    for (const item of extractResultCards()) {
      const result = match({
        title: item.title,
        provider: item.provider,
        extra: item.text,
        oid: item.oid,
      });
      injectCardLine(item, result, t, data.meta);
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
    // Detail pages get the inline section; haku pages get one native fact
    // row per result card; anything else is left alone.
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
