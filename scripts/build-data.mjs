// Builds data/degrees.json from a dashboard data.json catalog snapshot.
// Slimmed + short keys so the MV3 bundle stays small and offline.
//
// Usage: node scripts/build-data.mjs [--catalog path]
// Catalog: --catalog <path>, CATALOG_JSON env, or scripts/catalog.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogFlag = process.argv.indexOf("--catalog");
const catalogPath =
  (catalogFlag !== -1 && process.argv[catalogFlag + 1]) ||
  process.env.CATALOG_JSON ||
  join(root, "scripts", "catalog.json");
let source;
try {
  source = JSON.parse(readFileSync(catalogPath, "utf-8"));
} catch (error) {
  console.error(
    `Failed to read/parse catalog ${catalogPath}: ${error.message}. ` +
      "Place a data.json snapshot at scripts/catalog.json or pass --catalog <path>.",
  );
  process.exit(1);
}

const round1 = (value) => Math.round(value * 10) / 10;

const degrees = source.degrees.map((degree) => ({
  id: degree.id,
  name: degree.name,
  sector: degree.sector,
  level: degree.level,
  field: degree.field,
  // national stats (short keys: u = unemployment %, m = median income,
  // r = residents, g = graduates)
  u: round1(degree.national.unemploymentRate),
  m: degree.national.medianIncome,
  r: degree.national.residents,
  g: degree.national.graduates,
  schools: degree.schools.map((school) => ({
    n: school.name,
    u: round1(school.unemploymentRate),
    m: school.medianIncome,
    r: school.residents,
    g: school.graduates,
  })),
}));

const out = {
  meta: {
    graduationYear: source.meta.graduationYear,
    incomeYear: source.meta.incomeYear,
    degreeCount: degrees.length,
    builtAt: new Date().toISOString(),
  },
  degrees,
};

const outDir = join(root, "data");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "degrees.json");
writeFileSync(outPath, JSON.stringify(out));

const kb = Math.round(Buffer.byteLength(JSON.stringify(out)) / 1024);
console.log(`wrote ${outPath} (${degrees.length} degrees, ${kb} kB)`);
