/** Read-only drift check for the producer and optional metrics consumer scope. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const producer = JSON.parse(readFileSync(new URL("../src/morpho/curation-scope.json", import.meta.url), "utf8"));
const { scopeHash, ...payload } = producer;
assert.equal(createHash("sha256").update(JSON.stringify(payload)).digest("hex"), scopeHash, "Producer scope hash is stale");
if (process.argv[2]) {
  const consumer = JSON.parse(readFileSync(process.argv[2], "utf8"));
  assert.deepEqual(consumer, producer, "Producer and metrics indexing scope differ");
}
console.log(`Curation scope verified: ${producer.chains.length} chains, ${producer.contracts.length} contracts`);
