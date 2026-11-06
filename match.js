/**
 * Pure matching logic for the Sijoittumisdata browser extension.
 * No DOM, no network — works in the MV3 content script and in node tests.
 *
 * Pipeline: normalize → detect sector/level → alias lookup → idf-weighted
 * fuzzy scoring → school match → confidence gate.
 */

"use strict";

// ---------------------------------------------------------------------------
// Normalization + light Finnish stemming
// ---------------------------------------------------------------------------

const PUNCT_RE = /[.,;:!?()[\]{}"'`´’“”„+*/\\|_=@#$%^&~<>–—-]/g;

function normalizeName(value) {
  return (value || "")
    .toLocaleLowerCase("fi")
    .replace(/&/g, " ja ")
    .replace(PUNCT_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Compound tails stripped from the end of a token ("maisteriohjelma"→"maisteri").
// Longest first.
const COMPOUND_TAILS = [
  "suuntautumisvaihtoehto",
  "koulutusohjelma",
  "tutkintoohjelma",
  "ohjelma",
  "koulutus",
  "tutkinto",
  "opinnot",
  "opinto",
  "linja",
];

// Single Finnish case-ending strip, longest first. Applied at most once and
// only when the remaining stem stays reasonably long.
const CASE_ENDINGS = [
  "tten",
  "den",
  "ten",
  "seen",
  "ssa",
  "ssä",
  "sta",
  "stä",
  "lla",
  "llä",
  "lta",
  "ltä",
  "lle",
  "ksi",
  "ine",
  "na",
  "nä",
  "en",
  "in",
  "n",
];

const STOPWORDS = new Set([
  "ja",
  "sekä",
  "tai",
  "de",
  "the",
  "of",
  "in",
  "on",
  "at",
  "for",
  "koulutus",
  "tutkinto",
  "ohjelma",
  "program",
  "programme",
  "vuonna",
  "vuosi",
  "syksy",
  "kevät",
  "haku",
]);

// Word-level synonyms applied before and after stemming, so that
// Opintopolku phrasing meets Tilastokeskus degree names in the middle.
const SYNONYMS = new Map(
  Object.entries({
    kandidaatti: "kand",
    maisteri: "maist",
    diplomi: "dipl",
    filosofian: "fil",
  }),
);

function stemToken(token) {
  let stem = token;
  for (const tail of COMPOUND_TAILS) {
    if (stem.length - tail.length >= 4 && stem.endsWith(tail)) {
      stem = stem.slice(0, -tail.length);
      break;
    }
  }
  for (const ending of CASE_ENDINGS) {
    if (
      stem.length - ending.length >= 5 &&
      stem.endsWith(ending) &&
      // don't eat the final -n of words like "...ton" short stems only:
      !(ending === "n" && /[aeiouyäö][^aeiouyäö]on$/.test(stem))
    ) {
      stem = stem.slice(0, -ending.length);
      break;
    }
  }
  // Trailing -i: kandi → kand, maisteri → maister.
  if (stem.length >= 5 && stem.endsWith("i")) {
    stem = stem.slice(0, -1);
  }
  return stem;
}

function tokens(value) {
  return normalizeName(value)
    .split(" ")
    .filter((token) => token.length > 0 && !STOPWORDS.has(token) && !/^\d+$/.test(token))
    .map((token) => {
      const direct = SYNONYMS.get(token);
      const stemmed = stemToken(direct || token);
      return SYNONYMS.get(stemmed) || stemmed;
    })
    .filter((token) => token.length >= 2);
}

function tokenSetKey(stemmedTokens) {
  return [...new Set(stemmedTokens)].sort().join(" ");
}

// ---------------------------------------------------------------------------
// Curated aliases
// ---------------------------------------------------------------------------

// School alias (normalized form) → canonical school name as in data.json.
const SCHOOL_ALIASES = new Map(
  Object.entries({
    aalto: "Aalto-yliopisto",
    "aalto yliopisto": "Aalto-yliopisto",
    "helsingin yliopisto": "Helsingin yliopisto",
    "turun yliopisto": "Turun yliopisto",
    "tampereen yliopisto": "Tampereen yliopisto",
    "oulun yliopisto": "Oulun yliopisto",
    "jyväskylän yliopisto": "Jyväskylän yliopisto",
    "itä suomen yliopisto": "Itä-Suomen yliopisto",
    "ita suomen yliopisto": "Itä-Suomen yliopisto",
    "lapin yliopisto": "Lapin yliopisto",
    "vaasan yliopisto": "Vaasan yliopisto",
    "åbo akademi": "Åbo Akademi",
    "abo akademi": "Åbo Akademi",
    lut: "Lappeenrannan-Lahden teknillinen yliopisto LUT",
    "lut yliopisto": "Lappeenrannan-Lahden teknillinen yliopisto LUT",
    "lappeenrannan teknillinen yliopisto": "Lappeenrannan-Lahden teknillinen yliopisto LUT",
    "lappeenranta lahti teknillinen yliopisto lut": "Lappeenrannan-Lahden teknillinen yliopisto LUT",
    "svenska handelshögskolan": "Svenska handelshögskolan",
    hanken: "Svenska handelshögskolan",
    taideyliopisto: "Taideyliopisto",
    maanpuolustuskorkeakoulu: "Maanpuolustuskorkeakoulu",
    // AMKs
    metropolia: "Metropolia Ammattikorkeakoulu",
    "metropolia ammattikorkeakoulu": "Metropolia Ammattikorkeakoulu",
    "haaga helia": "Haaga-Helia ammattikorkeakoulu",
    "haaga helia ammattikorkeakoulu": "Haaga-Helia ammattikorkeakoulu",
    laurea: "Laurea-ammattikorkeakoulu",
    "laurea ammattikorkeakoulu": "Laurea-ammattikorkeakoulu",
    arcada: "Yrkeshögskolan Arcada",
    "yrkeshögskolan arcada": "Yrkeshögskolan Arcada",
    novia: "Yrkeshögskolan Novia",
    "yrkeshögskolan novia": "Yrkeshögskolan Novia",
    hamk: "Hämeen ammattikorkeakoulu",
    "hämeen ammattikorkeakoulu": "Hämeen ammattikorkeakoulu",
    jamk: "Jyväskylän ammattikorkeakoulu",
    "jyväskylän ammattikorkeakoulu": "Jyväskylän ammattikorkeakoulu",
    oamk: "Oulun ammattikorkeakoulu",
    "oulun ammattikorkeakoulu": "Oulun ammattikorkeakoulu",
    tamk: "Tampereen ammattikorkeakoulu",
    "tampereen ammattikorkeakoulu": "Tampereen ammattikorkeakoulu",
    lab: "LAB-ammattikorkeakoulu",
    "lab ammattikorkeakoulu": "LAB-ammattikorkeakoulu",
    xamk: "Kaakkois-Suomen ammattikorkeakoulu",
    "kaakkois suomen ammattikorkeakoulu": "Kaakkois-Suomen ammattikorkeakoulu",
    samk: "Satakunnan ammattikorkeakoulu",
    "satakunnan ammattikorkeakoulu": "Satakunnan ammattikorkeakoulu",
    seamk: "Seinäjoen ammattikorkeakoulu",
    "seinäjoen ammattikorkeakoulu": "Seinäjoen ammattikorkeakoulu",
    savonia: "Savonia-ammattikorkeakoulu",
    "savonia ammattikorkeakoulu": "Savonia-ammattikorkeakoulu",
    karelia: "Karelia-ammattikorkeakoulu",
    "karelia ammattikorkeakoulu": "Karelia-ammattikorkeakoulu",
    centria: "Centria-ammattikorkeakoulu",
    "centria ammattikorkeakoulu": "Centria-ammattikorkeakoulu",
    vamk: "Vaasan ammattikorkeakoulu",
    "vaasan ammattikorkeakoulu": "Vaasan ammattikorkeakoulu",
    "lapin ammattikorkeakoulu": "Lapin ammattikorkeakoulu",
    diak: "Diakonia-ammattikorkeakoulu",
    "diakonia ammattikorkeakoulu": "Diakonia-ammattikorkeakoulu",
    humak: "Humanistinen ammattikorkeakoulu",
    "humanistinen ammattikorkeakoulu": "Humanistinen ammattikorkeakoulu",
    polamk: "Poliisiammattikorkeakoulu",
    "poliisiammattikorkeakoulu": "Poliisiammattikorkeakoulu",
  }),
);

// Degree alias (normalized Opintopolku-style phrase) → canonical degree name.
// Seed list for the most common programme wordings; extend as mismatches
// are observed. Compared by stemmed token-set equality.
const DEGREE_ALIASES = new Map(
  Object.entries({
    "tietojenkäsittelytieteen maisteriohjelma": "Tietojenkäsittelytiede (fil. maist.)",
    "tietojenkäsittelytieteen maisteriopinnot": "Tietojenkäsittelytiede (fil. maist.)",
    "tietotekniikan maisteriohjelma": "Tietotekniikka (dipl.ins.)",
    "tietotekniikan diplomi insinööri koulutus": "Tietotekniikka (dipl.ins.)",
    "kauppatieteiden maisteriohjelma": "Liiketaloustieteet (kauppat. maist.)",
    "kauppatieteiden maisteriopinnot": "Liiketaloustieteet (kauppat. maist.)",
    "liiketalouden maisteriohjelma": "Liiketaloustieteet (kauppat. maist.)",
    "tradenomi tietojenkäsittely": "Tradenomi (AMK), tietojenkäsittely",
    "tietojenkäsittelyn tradenomi": "Tradenomi (AMK), tietojenkäsittely",
    "tradenomi liiketalous": "Tradenomi (AMK), talous, hallinto ja markkinointi",
    "liiketalouden tradenomi": "Tradenomi (AMK), talous, hallinto ja markkinointi",
  }),
);

// ---------------------------------------------------------------------------
// Sector / level detection
// ---------------------------------------------------------------------------

const UPPER_AMK_RE = /ylempi\s*\(?\s*amk|ylempi\s+ammattikorkeakoulu/i;
const AMK_RE = /\bamk\b|ammattikorkeakoulu|tradenomi|insinööri\s*\(amk\)|sairaanhoitaja|restonomi|medianomi|muotoilija\s*\(amk\)/i;
const UPPER_UNI_RE =
  /maisteri|maist\.|dipl\.ins\.|diplomi-insinööri|lisensiaatti|proviisori|magister|masters?\b|lastentarhanopettaja.*maisteri|fil\.|yhteiskuntat\. maist/i;
const LOWER_UNI_RE =
  /kandidaatti|\bkand\b|kand\.|kandiohjelma|kandidatprogram|bachelor|luonnont\. kand|hum\. kand|fil\. kand/i;

function detectSectorLevel(text) {
  const haystack = text || "";
  // Finnish/Swedish university programme markers that imply the university
  // sector even when the word "yliopisto" is absent (e.g. toteutus titles
  // like "... kandiohjelma"). Deliberately excludes bare "bachelor" /
  // "master(s)", which also appear in English AMK programme names.
  const UNI_PROGRAM_RE =
    /kandiohjelma|maisteriohjelma|kandidatprogram|magister|dipl\.ins\.|kand\.|maist\.|fil\.|proviisori|lisensiaatti/i;
  const sector = AMK_RE.test(haystack)
    ? "amk"
    : /yliopisto|maisteri|kandidaatti|tiedekorkeakoulu/i.test(haystack) ||
        UNI_PROGRAM_RE.test(haystack)
      ? "university"
      : null;
  let level = null;
  if (sector === "amk") {
    level = UPPER_AMK_RE.test(haystack) ? "upper" : "lower";
  } else if (sector === "university") {
    if (UPPER_UNI_RE.test(haystack)) level = "upper";
    else if (LOWER_UNI_RE.test(haystack)) level = "lower";
  }
  return { sector, level };
}

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

const ACCEPT_SCORE = 0.5;

function createMatcher(degrees, aiMaps) {
  const count = degrees.length;
  const docFreq = new Map();
  const degreeTokens = degrees.map((degree) => {
    const stems = tokens(`${degree.name} ${degree.field}`);
    for (const stem of new Set(stems)) {
      docFreq.set(stem, (docFreq.get(stem) || 0) + 1);
    }
    return stems;
  });
  const idf = (stem) => Math.log(1 + count / (docFreq.get(stem) || 0.5));

  const aliasKeyToDegree = new Map();
  for (const [alias, canonical] of DEGREE_ALIASES) {
    aliasKeyToDegree.set(tokenSetKey(tokens(alias)), canonical);
  }
  const byName = new Map(degrees.map((degree) => [degree.name, degree]));
  const byId = new Map(degrees.map((degree) => [degree.id, degree]).filter(([id]) => id));
  // AI-curated mappings (extension/data/ai-mappings.json): oid ->
  // {title, degree, confidence}. Title index built once for lookups
  // where only the programme name is available.
  const aiByOid = (aiMaps && aiMaps.byOid) || {};
  const aiByTitle = {};
  for (const m of Object.values(aiByOid)) {
    if (m && m.degree && m.title) aiByTitle[normalizeName(m.title)] = m;
  }

  // A query stem hits a degree stem on exact match, or when they share a
  // long prefix (Finnish genitives: tietojenkäsittelytieteen ↔
  // tietojenkäsittelytiede). Weights always come from the degree side.
  function stemHit(queryStem, degreeStem) {
    if (queryStem === degreeStem) return true;
    let shared = 0;
    while (
      shared < queryStem.length &&
      shared < degreeStem.length &&
      queryStem[shared] === degreeStem[shared]
    ) {
      shared += 1;
    }
    return shared >= 8;
  }

  function f1Score(queryStems, degreeIndex) {
    const dStems = [...new Set(degreeTokens[degreeIndex])];
    const qStems = [...new Set(queryStems)];
    const degreeWeight = dStems.reduce((sum, stem) => sum + idf(stem), 0);
    const queryWeight = qStems.reduce((sum, stem) => sum + idf(stem), 0);
    if (degreeWeight === 0 || queryWeight === 0) return 0;
    let hitWeight = 0;
    for (const degreeStem of dStems) {
      if (qStems.some((queryStem) => stemHit(queryStem, degreeStem))) {
        hitWeight += idf(degreeStem);
      }
    }
    const precision = hitWeight / degreeWeight;
    const recall = Math.min(1, hitWeight / queryWeight);
    if (precision + recall === 0) return 0;
    return (2 * precision * recall) / (precision + recall);
  }

  function matchSchool(providerText, schools) {
    if (!providerText || !schools || schools.length === 0) return null;
    const normalized = normalizeName(providerText);
    const aliased = SCHOOL_ALIASES.get(normalized);
    if (aliased) {
      const hit = schools.find((school) => school.n === aliased);
      if (hit) return { school: hit, method: "alias" };
    }
    // Token-subset match: every query token appears in the school name or vice versa.
    const queryStems = new Set(tokens(providerText));
    let best = null;
    for (const school of schools) {
      const schoolStems = new Set(tokens(school.n));
      const qInS = [...queryStems].every((stem) => schoolStems.has(stem));
      const sInQ = [...schoolStems].every((stem) => queryStems.has(stem));
      if (qInS || sInQ) {
        // Prefer the longest (most specific) name on ties.
        if (!best || school.n.length > best.school.n.length) {
          best = { school, method: "tokens" };
        }
      }
    }
    return best;
  }

  /**
   * @param signals { title, provider, extra, url }
   * @returns { degree, school, score, method } or null
   */
  // Best fuzzy hit over all degrees. Stage 1 scores the title alone
  // (hakukohde side-quests must not hijack the match); stage 2 adds
  // the extra context when the title alone is inconclusive.
  function fuzzyBest(queryStems, sector, level) {
    let best = null;
    for (let index = 0; index < degrees.length; index += 1) {
      const degree = degrees[index];
      let score = f1Score(queryStems, index);
      if (level && degree.level !== level) score *= 0.3;
      else if (sector && degree.sector !== sector) score *= 0.5;
      if (!best || score > best.score) best = { degree, score };
    }
    return best;
  }

  function findAlias(tokenSet, level) {
    for (const [key, canonical] of aliasKeyToDegree) {
      const parts = key.split(" ");
      if (!parts.every((part) => tokenSet.has(part))) continue;
      const degree = byName.get(canonical);
      if (!degree) continue;
      // A title that names a level must not resolve to another level
      // (e.g. a kandiohjelma page mentioning a maisteri hakukohde).
      if (level && degree.level !== level) continue;
      return degree;
    }
    return null;
  }

  function match(signals) {
    const title = signals.title || "";
    const combined = `${title} ${signals.extra || ""}`;
    // Level/sector from the title first: the title names the programme,
    // extras may mention several levels (combined 3v+2v programmes).
    const fromTitle = detectSectorLevel(title);
    const fromCombined = detectSectorLevel(combined);
    let level = fromTitle.level || fromCombined.level;
    const sector = fromTitle.sector || fromCombined.sector;
    // Product rule: kandiohjelma pages resolve to the master's degree.
    // Most kand graduates continue to the master's, so the master's
    // employment/income stats are the meaningful outcomes for applicants.
    // Combined "(3 v + 2 v)" programmes likewise always resolve to the
    // master's degree (fi/sv/en year-unit variants included).
    if (
      /kandiohjelma|kandidatprogram/i.test(title) ||
      /3\s*-?\s*(?:v(?:uotta)?|år|years?|yrs?|y)\s*\+\s*2\s*-?\s*(?:v(?:uotta)?|år|years?|yrs?|y)/i.test(
        title,
      )
    )
      level = "upper";

    const resolveSchool = (degree) =>
      matchSchool(signals.provider, degree.schools)?.school || null;

    // 0. AI-curated mapping (offline, exact): known Opintopolku oids
    // first, then the programme title. Beats fuzzy by construction.
    const aiEntry =
      (signals.oid && aiByOid[signals.oid]) ||
      (signals.koulutusOid && aiByOid[signals.koulutusOid]) ||
      (title && aiByTitle[normalizeName(title)]) ||
      null;
    if (aiEntry && aiEntry.degree) {
      const aiDegree = byId.get(aiEntry.degree);
      if (aiDegree) {
        return {
          degree: aiDegree,
          school: resolveSchool(aiDegree),
          score:
            typeof aiEntry.confidence === "number"
              ? Math.round(aiEntry.confidence * 100) / 100
              : 0.95,
          method: "ai",
        };
      }
    }

    // 1. Exact normalized name match.
    const normalizedTitle = normalizeName(title);
    const exact =
      byName.get(title) || degrees.find((d) => normalizeName(d.name) === normalizedTitle);
    if (exact && (!sector || exact.sector === sector) && (!level || exact.level === level)) {
      return { degree: exact, school: resolveSchool(exact), score: 1, method: "exact" };
    }

    // 2. Curated degree alias against the title.
    const titleAlias = findAlias(new Set(tokens(title)), level);
    if (titleAlias) {
      return { degree: titleAlias, school: resolveSchool(titleAlias), score: 0.95, method: "alias" };
    }

    // 3. Fuzzy on the title alone.
    const titleStems = tokens(title);
    const titleBest = titleStems.length > 0 ? fuzzyBest(titleStems, sector, level) : null;
    if (titleBest && titleBest.score >= ACCEPT_SCORE) {
      return {
        degree: titleBest.degree,
        school: resolveSchool(titleBest.degree),
        score: Math.round(titleBest.score * 100) / 100,
        method: "fuzzy-title",
      };
    }

    // 4. Curated alias against title + extra context.
    const combinedAlias = findAlias(new Set(tokens(combined)), level);
    if (combinedAlias) {
      return {
        degree: combinedAlias,
        school: resolveSchool(combinedAlias),
        score: 0.9,
        method: "alias",
      };
    }

    // 5. Fuzzy on everything.
    const queryStems = tokens(combined);
    if (queryStems.length === 0) return null;
    const best = fuzzyBest(queryStems, sector, level);
    if (!best || best.score < ACCEPT_SCORE) return null;
    return {
      degree: best.degree,
      school: resolveSchool(best.degree),
      score: Math.round(best.score * 100) / 100,
      method: "fuzzy",
    };
  }

  return { match, matchSchool, detectSectorLevel, tokens, normalizeName };
}

// Export for node tests; attach to window for the content script.
const matcherApi = { createMatcher, ACCEPT_SCORE };
if (typeof module !== "undefined" && module.exports) {
  module.exports = matcherApi;
} else if (typeof window !== "undefined") {
  window.__sijoittumisMatcher = matcherApi;
}
