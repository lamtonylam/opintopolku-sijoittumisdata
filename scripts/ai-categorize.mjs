// Maps Opintopolku programmes to degree ids in the catalog, using the
// LiteLLM proxy, and saves the mapping for the offline browser extension.
//
// Usage: node scripts/ai-categorize.mjs [koulutustyyppi] [--catalog path]
// e.g. node scripts/ai-categorize.mjs kandi-ja-maisteri
//      node scripts/ai-categorize.mjs amk-alempi --catalog ./catalog.json
// Reads .env: LITELLM_API_KEY, LITELLM_BASE_URL, LITELLM_MODEL
// Catalog: --catalog <path>, CATALOG_JSON env, or scripts/catalog.json
// (a data.json snapshot — see README "Refreshing the data").
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(join(root, ".env"), "utf-8").split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    // fall through to process.env
  }
  return {
    key: env.LITELLM_API_KEY || process.env.LITELLM_API_KEY,
    base: env.LITELLM_BASE_URL || process.env.LITELLM_BASE_URL,
    model: env.LITELLM_MODEL || process.env.LITELLM_MODEL,
  };
}

const { key, base, model } = loadEnv();
if (!key || !base || !model) {
  console.error("Missing LITELLM_API_KEY / LITELLM_BASE_URL / LITELLM_MODEL (.env)");
  process.exit(1);
}

const cliArgs = process.argv.slice(2);
const catalogFlag = cliArgs.indexOf("--catalog");
const catalogValue = catalogFlag !== -1 ? cliArgs[catalogFlag + 1] : null;
const catalogPath =
  catalogValue || process.env.CATALOG_JSON || join(root, "scripts", "catalog.json");
const filter =
  cliArgs.find((a) => !a.startsWith("--") && a !== catalogValue) || "kandi-ja-maisteri";
let data;
try {
  data = JSON.parse(readFileSync(catalogPath, "utf-8"));
} catch (error) {
  console.error(
    `Failed to read/parse catalog ${catalogPath}: ${error.message}. ` +
      "Place a data.json snapshot at scripts/catalog.json or pass --catalog <path>.",
  );
  process.exit(1);
}
const catalog = data.degrees.map((d) => ({
  id: d.id,
  name: d.name,
  sector: d.sector,
  level: d.level,
  field: d.field,
}));
const byId = new Map(catalog.map((d) => [d.id, d]));

// ---------------------------------------------------------------------------
// 1. Fetch every kandi+maisteri koulutus record from konfo-backend.
// ---------------------------------------------------------------------------
const JOBS = {
  "kandi-ja-maisteri": {
    programsFile: "scripts/ai-programs-kandi-maisteri.json",
    rule: `Every programme below is a combined 3-year bachelor + 2-year master ("(3 v + 2 v)"). ALWAYS choose the MASTER'S-level (upper) degree when one matches the field. Never choose a lower (kand) degree for these programmes.`,
  },
  "amk-alempi": {
    programsFile: "scripts/ai-programs-amk-alempi.json",
    rule: `Every programme below is an AMK (ammattikorkeakoulu) bachelor's-level programme. ALWAYS choose the LOWER-level AMK degree matching the field (e.g. Tradenomi (AMK), Insinööri (AMK), Sairaanhoitaja (AMK)). Never choose a ylempi AMK or university degree.`,
  },
};
const JOB = JOBS[filter];
if (!JOB) {
  console.error(`Unknown filter "${filter}". Known: ${Object.keys(JOBS).join(", ")}`);
  process.exit(1);
}
const SEARCH =
  "https://opintopolku.fi/konfo-backend/search/koulutukset" +
  `?koulutustyyppi=${filter}&lng=fi&order=desc&sort=score`;

async function fetchAll() {
  const all = [];
  let page = 1;
  const size = 100;
  for (;;) {
    const res = await fetch(`${SEARCH}&page=${page}&size=${size}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) throw new Error(`search page ${page}: HTTP ${res.status}`);
    const body = await res.json();
    all.push(...body.hits);
    console.log(`fetched page ${page}: ${body.hits.length} hits (total ${body.total})`);
    if (body.hits.length < size || all.length >= body.total) break;
    page += 1;
  }
  return all;
}

const fi = (obj) => (obj && obj.fi ? obj.fi.trim().replace(/\s+/g, " ") : "");

function toProgram(hit) {
  return {
    oid: hit.oid,
    title: fi(hit.nimi),
    provider: fi(hit.toteutustenTarjoajat && hit.toteutustenTarjoajat.nimi),
    tutkintonimikkeet: (hit.tutkintonimikkeet || []).map((t) => fi(t.nimi)).filter(Boolean),
    codes: (hit.koulutukset || []).map((k) => k.koodiUri).filter(Boolean),
    laajuus: hit.opintojenLaajuusNumero || null,
  };
}

// ---------------------------------------------------------------------------
// 2. Ask the model to map programs -> degree ids, in batches.
// ---------------------------------------------------------------------------
const catalogText = catalog
  .map((d) => `${d.id} | ${d.name} | ${d.sector} ${d.level} | ${d.field}`)
  .join("\n");

function programText(p, i) {
  return (
    `${i + 1}. oid=${p.oid} | ${p.title} | provider: ${p.provider || "?"} | ` +
    `tutkinnot: ${p.tutkintonimikkeet.join("; ") || "?"} | ` +
    `codes: ${p.codes.join(", ") || "?"} | ${p.laajuus || "?"}op`
  );
}

const SYSTEM = `You map Finnish Opintopolku study programmes to degree ids from a fixed catalog.
Rules:
- ${JOB.rule}
- The "codes" field holds Opintopolku degree codes like koulutus_742201#12: match by the NUMERIC part against catalog ids (e.g. 742201 matches university-742201). The code's degree name may differ in wording from the catalog name; the numeric code wins on conflicts.
- Match by academic field/subject (e.g. tietojenkäsittelytiede -> Tietojenkäsittelytiede, oikeustiede -> Oikeustiede). Provider/university is irrelevant to the choice.
- If no catalog degree fits the field (e.g. no equivalent exists), use null with a short reason. Never invent ids; use only ids from the catalog.
- Respond with JSON only: {"mappings": [{"oid": "...", "degree": "<catalog id or null>", "confidence": 0.0-1.0, "reason": "<very short>"}]} — one entry per programme, same order.`;

async function mapBatch(programs) {
  const user =
    `CATALOG (id | name | sector level | field):\n${catalogText}\n\n` +
    `PROGRAMMES:\n${programs.map(programText).join("\n")}`;
  const call = async (extra) =>
    fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user + (extra || "") },
        ],
      }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      return body.choices[0].message.content;
    });
  let raw;
  try {
    raw = await call("");
  } catch (err) {
    console.log(`  batch call failed (${err.message}), retrying once`);
    raw = await call("\n\nPrevious attempt failed. Reply with JSON only.");
  }
  const parse = (text) => {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`LLM returned invalid JSON: ${String(text).slice(0, 200)}`);
    }
    const list = Array.isArray(parsed) ? parsed : parsed.mappings;
    if (!Array.isArray(list)) throw new Error("LLM did not return a mappings array");
    return list;
  };
  try {
    return parse(raw);
  } catch (err) {
    console.log(`  ${err.message}, retrying once with strict reminder`);
    return parse(await call("\n\nReply with JSON only. No prose."));
  }
}

// ---------------------------------------------------------------------------
// 3. Run + save.
// ---------------------------------------------------------------------------
const hits = await fetchAll();
const programs = hits.map(toProgram);
writeFileSync(join(root, JOB.programsFile), JSON.stringify(programs, null, 1));
console.log(`saved ${programs.length} programs to ${JOB.programsFile}`);

const BATCH = 25;
const byOid = {};
let mapped = 0;
for (let i = 0; i < programs.length; i += BATCH) {
  const batch = programs.slice(i, i + BATCH);
  console.log(`mapping ${i + 1}-${i + batch.length} of ${programs.length}...`);
  let list;
  try {
    list = await mapBatch(batch);
  } catch (error) {
    // Never lose completed batches: log, skip, keep mapping the rest.
    console.log(`  batch ${i + 1}-${i + batch.length} failed (${error.message}) — skipped, rerun later`);
    continue;
  }
  const byOidInBatch = new Map(list.map((m) => [m.oid, m]));
  for (const p of batch) {
    const m = byOidInBatch.get(p.oid);
    let degree = m && m.degree ? String(m.degree) : null;
    if (degree && !byId.has(degree)) {
      console.log(`  WARN unknown degree id "${degree}" for ${p.oid} — nulled`);
      degree = null;
    }
    if (degree) mapped += 1;
    byOid[p.oid] = {
      title: p.title,
      degree,
      confidence: m && typeof m.confidence === "number" ? m.confidence : null,
      reason: (m && m.reason) || "",
    };
  }
}

// Merge into the shared extension mapping (one entry per oid; reruns
// overwrite their own filter's entries, other filters are preserved).
const outDir = join(root, "data");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "ai-mappings.json");
let merged = {};
let sources = {};
try {
  const prev = JSON.parse(readFileSync(outPath, "utf-8"));
  merged = prev.mappings || {};
  sources = (prev.meta && prev.meta.sources) || {};
} catch {
  // first run: nothing to merge
}
for (const [oid, m] of Object.entries(byOid)) merged[oid] = m;
sources[filter] = {
  model,
  builtAt: new Date().toISOString(),
  programCount: programs.length,
  mappedCount: mapped,
};
const totalMapped = Object.values(merged).filter((m) => m.degree).length;
const out = {
  meta: { builtAt: new Date().toISOString(), sources },
  mappings: merged,
};
writeFileSync(outPath, JSON.stringify(out));
const unmapped = programs.filter((p) => !byOid[p.oid].degree);
console.log(`\nmapped ${mapped}/${programs.length} ${filter} programmes (${totalMapped} mapped total)`);
if (unmapped.length) {
  console.log("unmapped:");
  unmapped.forEach((p) => console.log(`  - ${p.title} [${p.oid}] (${byOid[p.oid].reason})`));
}
console.log("wrote data/ai-mappings.json");
