import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkProvenance, validateProvenance } from "../scripts/check-provenance.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const [provenance, commands] = await Promise.all([
  readFile(resolve(root, "provenance.json"), "utf8").then(JSON.parse),
  readFile(resolve(root, "config", "commands.json"), "utf8").then(JSON.parse)
]);

test("canonical provenance pins validate against configured Slack commands", async () => {
  const result = await checkProvenance({ root });
  assert.equal(result.canonicalRepository, "ORESoftware/slack-ores-integrations");
  assert.equal(result.importedFrom.repository, "ORESoftware/devops-slack");
  assert.equal(result.productionIngress.repository, "ORESoftware/ai-agent-bridge.rs");
  assert.equal(result.gitOps.repository, "ORESoftware/k8s-cluster");
  assert.deepEqual(
    [...result.slack.commands].sort(),
    commands.map((entry) => entry.command).sort()
  );
});

test("provenance rejects command drift and duplicate aliases", () => {
  const missing = structuredClone(provenance);
  missing.slack.commands.pop();
  assert.throws(() => validateProvenance(missing, commands), /exactly match/);

  const duplicate = structuredClone(provenance);
  duplicate.slack.commands.push(duplicate.slack.commands[0]);
  assert.throws(() => validateProvenance(duplicate, commands), /must not contain duplicates/);
});

test("provenance rejects mutable or conflated source pins", () => {
  const branchPin = structuredClone(provenance);
  branchPin.importedFrom.commit = "main";
  assert.throws(() => validateProvenance(branchPin, commands), /40-character Git SHA/);

  const conflated = structuredClone(provenance);
  conflated.productionIngress.repository = conflated.importedFrom.repository;
  assert.throws(() => validateProvenance(conflated, commands), /must remain distinct/);
});

test("provenance rejects unknown fields", () => {
  const extended = structuredClone(provenance);
  extended.credential = "not-allowed";
  assert.throws(() => validateProvenance(extended, commands), /fields must be exactly/);
});
