import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const commands = JSON.parse(
  fs.readFileSync(new URL("../config/commands.json", import.meta.url), "utf8")
);
const runtime = JSON.parse(
  fs.readFileSync(new URL("../config/runtime-integration.json", import.meta.url), "utf8")
);

const expectedAliases = {
  "/ores-claude": ["anthropic", "/slack/commands/ores-claude"],
  "/x-claude": ["anthropic", "/slack/commands/ores-claude"],
  "/my-claude": ["anthropic", "/slack/commands/ores-claude"],
  "/ores-chatgpt": ["openai", "/slack/commands/ores-chatgpt"],
  "/x-chatgpt": ["openai", "/slack/commands/ores-chatgpt"],
  "/my-chatgpt": ["openai", "/slack/commands/ores-chatgpt"]
};

test("production runtime and source revisions are immutable", () => {
  assert.equal(runtime.schema_version, 1);
  assert.equal(runtime.source.repository, "ORESoftware/devops-slack");
  assert.equal(runtime.source.revision, "7d7b6f2a1018204eba8b727ffa069e6bef31b6a7");
  assert.equal(runtime.production_runtime.repository, "ORESoftware/ai-agent-bridge.rs");
  assert.equal(
    runtime.production_runtime.revision,
    "03f38e876daec61eba587f6cb87393d3cc2a7dac"
  );
});

test("all six aliases map exactly once to the two signed ingress endpoints", () => {
  const actualCommands = Object.fromEntries(
    commands.map(({ command, provider }) => [command, provider])
  );
  const actualAliases = runtime.production_runtime.signed_ingress.aliases;
  assert.deepEqual(Object.keys(actualCommands).sort(), Object.keys(expectedAliases).sort());
  assert.deepEqual(Object.keys(actualAliases).sort(), Object.keys(expectedAliases).sort());

  for (const [alias, [provider, endpoint]] of Object.entries(expectedAliases)) {
    assert.equal(actualCommands[alias], provider);
    assert.equal(actualAliases[alias], endpoint);
    assert.equal(runtime.production_runtime.signed_ingress.endpoints[provider], endpoint);
  }
});
