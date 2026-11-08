// Node smoke tests for match.js against the real slim dataset.
// Usage: npm test
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// match.js is a classic browser script (shares globals with the content script),
// so load it in a vm context instead of importing it as ESM.
const matchSource = readFileSync(join(root, "match.js"), "utf-8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${matchSource}\n;globalThis.__matcherApi = { createMatcher };`, sandbox);
const { createMatcher } = sandbox.__matcherApi;
let data;
try {
  data = JSON.parse(readFileSync(join(root, "data/degrees.json"), "utf-8"));
} catch (error) {
  console.error("Failed to read data/degrees.json — run npm run build:data first:", error);
  process.exit(1);
}
const { match } = createMatcher(data.degrees);

const cases = [
  {
    name: "HY CS master's toteutus wording",
    signals: {
      title: "Tietojenkäsittelytieteen maisteriohjelma",
      provider: "Helsingin yliopisto",
      extra: "Filosofian maisteri, luonnontieteellinen ala",
    },
    expectDegree: "Tietojenkäsittelytiede (fil. maist.)",
    expectSchool: "Helsingin yliopisto",
  },
  {
    name: "Exact degree name + school",
    signals: {
      title: "Tietotekniikka (dipl.ins.)",
      provider: "Aalto-yliopisto",
    },
    expectDegree: "Tietotekniikka (dipl.ins.)",
    expectSchool: "Aalto-yliopisto",
  },
  {
    name: "Tradenomi liiketalous wording",
    signals: {
      title: "Tradenomi (AMK), liiketalous",
      provider: "Metropolia Ammattikorkeakoulu",
    },
    expectDegree: "Tradenomi (AMK), talous, hallinto ja markkinointi",
    expectSchool: "Metropolia Ammattikorkeakoulu",
  },
  {
    name: "Kauppatieteiden maisteriohjelma",
    signals: {
      title: "Kauppatieteiden maisteriohjelma",
      provider: "Turun yliopisto",
    },
    expectDegree: "Liiketaloustieteet (kauppat. maist.)",
  },
  {
    name: "Unknown programme returns null, never a guess",
    signals: {
      title: "Kvanttitietokoneiden huolto-ohjelma",
      provider: "Helsingin yliopisto",
    },
    expectDegree: null,
  },
  {
    name: "Live toteutus: kandiohjelma resolves to master's",
    signals: {
      title: "Tietojenkäsittelytieteen kandiohjelma, syksy 2027",
      provider: "Helsingin yliopisto",
      extra: "Yliopistokoulutus Tietojenkäsittelytiede",
    },
    expectDegree: "Tietojenkäsittelytiede (fil. maist.)",
    expectSchool: "Helsingin yliopisto",
  },
  {
    name: "Live koulutus: combined 3v+2v resolves to master's, national scope",
    signals: {
      title: "Tietojenkäsittelytiede, kandidaatti ja maisteri (3 v + 2 v)",
      provider: "",
      extra:
        "Tutkintonimikkeet Luonnontieteiden kandidaatti Filosofian maisteri Koulutustyyppi Yliopistokoulutus",
    },
    expectDegree: "Tietojenkäsittelytiede (fil. maist.)",
    expectSchool: null,
  },
  {
    // The "(3 v + 2 v)" product rule fires even when the title never
    // mentions the master's level explicitly.
    name: "Bare 3v+2v title resolves to master's without level words",
    signals: {
      title: "Tietojenkäsittelytiede (3 v + 2 v)",
      provider: "",
      extra: "Yliopistokoulutus",
    },
    expectDegree: "Tietojenkäsittelytiede (fil. maist.)",
    expectSchool: null,
  },
  {
    // Regression: toteutus 1.2.246.562.17.00000000000000041390. The koulutus
    // link names both levels ("kandidaatti ja maisteri") and the provider
    // link is the faculty, but kandiohjelma titles resolve to master's.
    name: "Live toteutus: faculty provider + dual-level koulutus is master's",
    signals: {
      title: "Tietojenkäsittelytieteen kandiohjelma, syksy 2027",
      provider: "Matemaattis-luonnontieteellinen tiedekunta",
      extra:
        "Luonnont. kand., tietojenkäsittelytiede Fil. maist., tietojenkäsittelytiede Tietojenkäsittelytiede, kandidaatti ja maisteri (3 v + 2 v)",
    },
    expectDegree: "Tietojenkäsittelytiede (fil. maist.)",
    expectSchool: null,
  },
  {
    name: "Search-style signals: master's with provider in card text",
    signals: {
      title: "Tietojenkäsittelytiede, maisteri (2 v)",
      provider: "Itä-Suomen yliopisto",
      extra:
        "Tietojenkäsittelytieteen opiskelulla Jyväskylässä Filosofian maisteri 120 opintopistettä Itä-Suomen yliopisto",
    },
    expectDegree: "Tietojenkäsittelytiede (fil. maist.)",
    expectSchool: "Itä-Suomen yliopisto",
  },
  {
    name: "School alias: Aalto short form",
    signals: {
      title: "Tietotekniikka (dipl.ins.)",
      provider: "Aalto",
    },
    expectDegree: "Tietotekniikka (dipl.ins.)",
    expectSchool: "Aalto-yliopisto",
  },
  {
    name: "Parenthetical campus qualifier does not block title match",
    signals: {
      title: "Tietojenkäsittelytiede (Kokkolan yliopistokeskus Chydenius), maisteri (2 v)",
      provider: "Jyväskylän yliopisto",
    },
    expectDegree: "Tietojenkäsittelytiede (fil. maist.)",
  },
  {
    name: "Datatiede alias resolves to CS master's",
    signals: {
      title: "Datatieteen maisteriohjelma, filosofian maisteri (2 v)",
      provider: "Helsingin yliopisto",
    },
    expectDegree: "Tietojenkäsittelytiede (fil. maist.)",
  },
];

let failures = 0;
for (const testCase of cases) {
  const result = match(testCase.signals);
  const degree = result?.degree?.name || null;
  const school = result?.school?.n || null;
  const degreeOk = degree === testCase.expectDegree;
  const schoolOk =
    testCase.expectSchool === undefined || school === testCase.expectSchool;
  if (degreeOk && schoolOk) {
    console.log(`ok   ${testCase.name} (${result?.method} ${result?.score})`);
  } else {
    failures += 1;
    console.log(`FAIL ${testCase.name}`);
    console.log(`     expected degree: ${testCase.expectDegree}, got: ${degree}`);
    if (testCase.expectSchool !== undefined) {
      console.log(`     expected school: ${testCase.expectSchool}, got: ${school}`);
    }
  }
}

if (failures > 0) {
  console.error(`${failures} failing case(s)`);
  process.exit(1);
}
console.log("all extension matcher cases pass");

// AI-curated mapping cases: exact oid/title hits beat fuzzy, with school
// still resolved from the provider at runtime.
const aiMatcher = createMatcher(data.degrees, {
  byOid: {
    "1.2.246.562.13.00000000000000002809": {
      title: "Elokuvaäänitys ja -äänisuunnittelu, taiteen kandidaatti ja maisteri (3 v + 2 v)",
      degree: "university-722101",
      confidence: 1,
    },
  },
});
const aiCases = [
  {
    name: "AI map: oid hit wins even with misleading title",
    signals: {
      title: "Some completely unrelated wording",
      provider: "Aalto-yliopisto",
      extra: "",
      oid: "1.2.246.562.13.00000000000000002809",
    },
    expectDegree: "Taiteen maisteri",
  },
  {
    name: "AI map: koulutusOid resolves toteutus-style page",
    signals: {
      title: "Elokuvaäänityksen kandiohjelma, syksy 2027",
      provider: "Aalto-yliopisto",
      extra: "",
      oid: "1.2.246.562.17.00000000000000000000",
      koulutusOid: "1.2.246.562.13.00000000000000002809",
    },
    expectDegree: "Taiteen maisteri",
  },
];
for (const testCase of aiCases) {
  const result = aiMatcher.match(testCase.signals);
  if (result?.degree?.name === testCase.expectDegree && result?.method === "ai") {
    console.log(`ok   ${testCase.name} (${result.method} ${result.score})`);
  } else {
    failures += 1;
    console.log(`FAIL ${testCase.name}`);
    console.log(
      `     expected degree: ${testCase.expectDegree}, got: ${result?.degree?.name} (${result?.method})`,
    );
  }
}
if (failures > 0) {
  console.error(`${failures} failing case(s)`);
  process.exit(1);
}
console.log("all AI mapping cases pass");
