import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  coverageEntityRows,
  coverageMarkdown,
  validateCoverageManifest,
  type CoverageManifest,
} from "../../src/allocation/gate4.js";
import { assertProducerCommitReachable } from "./coverage-provenance.js";

const coverageDirectory = new URL("../../coverage/allocation/", import.meta.url);
const manifestUrl = new URL("ethereum.json", coverageDirectory);
const entitiesUrl = new URL("ethereum.entities.json", coverageDirectory);
const markdownUrl = new URL("ethereum.generated.md", coverageDirectory);
const check = process.argv.includes("--check");

const manifest = validateCoverageManifest(
  JSON.parse(readFileSync(manifestUrl, "utf8")) as CoverageManifest,
);
assertProducerCommitReachable(manifest.producerCommit);
const entities = `${JSON.stringify({
  manifestVersion: manifest.manifestVersion,
  coverageRevision: manifest.coverageRevision,
  rows: coverageEntityRows(manifest),
}, null, 2)}\n`;
const markdown = coverageMarkdown(manifest);

const outputs = [
  [entitiesUrl, entities],
  [markdownUrl, markdown],
] as const;

if (check) {
  const stale = outputs.filter(([url, expected]) => readFileSync(url, "utf8") !== expected);
  if (stale.length > 0) {
    console.error(`Gate 4 coverage outputs are stale: ${stale.map(([url]) => fileURLToPath(url)).join(", ")}`);
    process.exit(1);
  }
  console.log(`Gate 4 coverage outputs: PASS (${manifest.entries.length} entries, revision ${manifest.coverageRevision})`);
} else {
  for (const [url, contents] of outputs) writeFileSync(url, contents);
  console.log(`Generated Gate 4 coverage outputs (${manifest.entries.length} entries, revision ${manifest.coverageRevision})`);
}
