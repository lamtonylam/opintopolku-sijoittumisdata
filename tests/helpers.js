// Shared harness for the live-DOM suite: loads the real extension sources
// (match.js, then content.js — same order as manifest.json) into the live
// Konfo page with stubbed extension APIs. Data comes from the committed
// snapshots, so tests assert the real pipeline end to end.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const matchSrc = readFileSync(join(root, "match.js"), "utf8");
const contentSrc = readFileSync(join(root, "content.js"), "utf8");
const degreesTxt = readFileSync(join(root, "data/degrees.json"), "utf8");
const aiTxt = readFileSync(join(root, "data/ai-mappings.json"), "utf8");

export const URLS = {
  toteutus:
    "https://opintopolku.fi/konfo/fi/toteutus/1.2.246.562.17.00000000000000038892",
  koulutus:
    "https://opintopolku.fi/konfo/fi/koulutus/1.2.246.562.13.00000000000000002808",
  haku: "https://opintopolku.fi/konfo/fi/haku/tietojenk%C3%A4sittelytiede?koulutustyyppi=maisteri&order=desc&size=20&sort=score",
};

export async function gotoKonfo(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("main h1, main .EntiteettiKortti-paperRoot", {
    timeout: 60000,
    state: "attached", // haku h1 is display:none; presence is what matters
  });
  await page.waitForTimeout(2500); // let the SPA hydrate
  await page.evaluate(
    ({ matchSrc, contentSrc, degreesTxt, aiTxt }) => {
      window.chrome = {
        storage: { local: { get: async () => ({}) } },
        runtime: { getURL: (p) => `chrome-stub://${p}` },
      };
      const realFetch = window.fetch.bind(window);
      window.fetch = (url, ...rest) => {
        const s = String(url);
        if (s === "chrome-stub://data/degrees.json")
          return Promise.resolve(new Response(degreesTxt, { status: 200 }));
        if (s === "chrome-stub://data/ai-mappings.json")
          return Promise.resolve(new Response(aiTxt, { status: 200 }));
        return realFetch(url, ...rest);
      };
      // eslint-disable-next-line no-eval
      eval(matchSrc);
      // eslint-disable-next-line no-eval
      eval(contentSrc); // bottom block calls init() once the DOM is ready
    },
    { matchSrc, contentSrc, degreesTxt, aiTxt },
  );
  await page.waitForTimeout(4000); // init fetch + match + render + observers settle
}

export function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (error) =>
    errors.push(`pageerror: ${String(error.message).slice(0, 200)}`),
  );
  return errors;
}
