import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildSlackAgentRunEnvelope,
  canonicalJsonSha256,
  createDiagnosticBackend,
  DiagnosticContractError,
  loadProjectRegistry,
  slackAgentRunLimits
} from "../src/diagnostic/index.js";

const policy = {
  expectedBindingCount: 2,
  workspaceId: "T00000000",
  linearTeamId: "11111111-1111-1111-1111-111111111111",
  linearTeamKey: "DEN",
  defaultAgentMode: "both-parallel",
  allowedAgentModes: ["claude", "chatgpt", "both-parallel", "both-sequential", "review"],
  allowedUserIds: ["U00000000"],
  allowedUserGroupIds: [],
  writePolicy: "draft_pull_request",
  budgetPolicy: {
    max_concurrent_runs: 4,
    max_runtime_secs: 900,
    max_tokens: 250_000,
    max_spend_cents: 1_000,
    max_retries: 2
  },
  rejectedChannelIds: ["C99999999"]
};

function binding(index) {
  const suffix = String(index).padStart(8, "0");
  return {
    workspace_id: policy.workspaceId,
    channel_id: `C${suffix}`,
    linear_team_id: policy.linearTeamId,
    linear_team_key: policy.linearTeamKey,
    linear_project_id: `22222222-2222-2222-2222-${String(index).padStart(12, "0")}`,
    default_repository: `example/project-${index}`,
    repository_allowlist: [`example/project-${index}`],
    default_agent_mode: policy.defaultAgentMode,
    allowed_agent_modes: [...policy.allowedAgentModes],
    allowed_user_ids: [...policy.allowedUserIds],
    allowed_user_group_ids: [],
    write_policy: policy.writePolicy,
    budget_policy: { ...policy.budgetPolicy },
    updated_by: `DEN-${100 + index}`,
    updated_at: "2026-08-01T19:12:00Z"
  };
}

function document() {
  return { schema_version: 1, bindings: [binding(1), binding(2)] };
}

function writeRegistry(value = document(), raw) {
  const directory = mkdtempSync(join(tmpdir(), "slack-diagnostic-registry-"));
  const path = join(directory, "registry.json");
  writeFileSync(path, raw ?? `${JSON.stringify(value, null, 2)}\n`);
  return { path, value };
}

function loadFixture(fixture = writeRegistry()) {
  return loadProjectRegistry({
    path: fixture.path,
    expectedDigest: canonicalJsonSha256(fixture.value),
    sourceRepository: "example/reviewed-registry",
    sourceRef: "refs/heads/main",
    sourceCommit: "a".repeat(40),
    authority: "external_reviewed_registry",
    policy
  });
}

function envelope(overrides = {}) {
  return {
    provider: "chatgpt",
    action: "implement",
    prompt: "Implement DEN-101 with tests.",
    workspaceId: policy.workspaceId,
    channelId: "C00000001",
    requesterUserId: policy.allowedUserIds[0],
    repository: "example/project-1",
    linearTeamId: policy.linearTeamId,
    linearProjectId: "22222222-2222-2222-2222-000000000001",
    linearRunProjectId: "33333333-3333-3333-3333-333333333333",
    linearIssue: "DEN-101",
    writePolicy: "draft_pull_request",
    contextMessages: [
      { userId: policy.allowedUserIds[0], ts: "1000.000001", text: "first" },
      { userId: null, ts: "1001.000001", text: "second" }
    ],
    identitySeed: "Ev0123456789",
    ...overrides
  };
}

test("loads a digest-locked registry and exposes only public route metadata", () => {
  const registry = loadFixture();
  assert.equal(registry.bindings.length, 2);
  assert.equal(registry.resolve("C00000001").repository, "example/project-1");
  assert.equal(registry.resolve("C12345678"), null);
  const summary = registry.publicSummary();
  assert.equal(summary.authority, "external_reviewed_registry");
  const rendered = JSON.stringify(summary);
  assert.doesNotMatch(rendered, /U00000000/);
  assert.doesNotMatch(rendered, /maxSpendCents/);
});

test("rejects digest drift, unknown fields, policy drift, and duplicate routes", () => {
  const fixture = writeRegistry();
  assert.throws(
    () =>
      loadProjectRegistry({
        path: fixture.path,
        expectedDigest: "0".repeat(64),
        sourceRepository: "example/reviewed-registry",
        sourceRef: "refs/heads/main",
        sourceCommit: "a".repeat(40),
        policy
      }),
    DiagnosticContractError
  );

  for (const mutate of [
    (value) => {
      value.bindings[0].unexpected = true;
    },
    (value) => {
      value.bindings[0].write_policy = "read_only";
    },
    (value) => {
      value.bindings[1].channel_id = value.bindings[0].channel_id;
    },
    (value) => {
      value.bindings[0].budget_policy.max_spend_cents = 999;
    }
  ]) {
    const value = document();
    mutate(value);
    assert.throws(() => loadFixture(writeRegistry(value)), DiagnosticContractError);
  }
});

test("rejects duplicate JSON keys even when the last value matches", () => {
  const value = document();
  const normal = `${JSON.stringify(value, null, 2)}\n`;
  const raw = normal.replace('"schema_version": 1', '"schema_version": 2,\n  "schema_version": 1');
  const fixture = writeRegistry(value, raw);
  assert.throws(() => loadFixture(fixture), /duplicate JSON key/);
});

test("builds deterministic strict coordinator envelopes", () => {
  const result = buildSlackAgentRunEnvelope(envelope());
  assert.equal(result.schema_version, 1);
  assert.match(result.run_id, /^ores-[0-9a-f]{24}$/);
  assert.match(result.bridge_workflow_id, /^bridge-[0-9a-f]{24}$/);
  assert.equal(result.context.trust, "untrusted_channel_context");
  assert.equal(result.routing.repository, "example/project-1");
  assert.deepEqual(result.broadcast_targets, [
    "ai_agent_bridge_workflow",
    "ai_agent_coordinator_job",
    "github_branch_pr_checks",
    "linear_run_queue",
    "slack_run_thread"
  ]);
  assert.deepEqual(buildSlackAgentRunEnvelope(envelope()), result);
});

test("rejects malformed routes, oversized context, and nonchronological Slack messages", () => {
  assert.throws(() => buildSlackAgentRunEnvelope(envelope({ action: "delete" })), DiagnosticContractError);
  assert.throws(
    () => buildSlackAgentRunEnvelope(envelope({ repository: "https://github.com/example/project" })),
    DiagnosticContractError
  );
  assert.throws(
    () =>
      buildSlackAgentRunEnvelope(
        envelope({
          contextMessages: Array.from({ length: slackAgentRunLimits.maxContextMessages + 1 }, (_, index) => ({
            ts: `${index}.1`,
            text: "x"
          }))
        })
      ),
    DiagnosticContractError
  );
  assert.throws(
    () =>
      buildSlackAgentRunEnvelope(
        envelope({
          contextMessages: [
            { ts: "1001.1", text: "later" },
            { ts: "1000.1", text: "earlier" }
          ]
        })
      ),
    /chronological/
  );
});

test("diagnostic backend resolves reviewed routes and executes no side effects", async () => {
  const registry = loadFixture();
  const run = createDiagnosticBackend({
    registry,
    linearRunProjectId: "33333333-3333-3333-3333-333333333333"
  });
  const result = await run("triage this work", {
    userId: policy.allowedUserIds[0],
    channelId: "C00000001",
    requestId: "Ev-diagnostic-1",
    explicitWriteIntent: true
  });
  assert.equal(result.executionBackend, "diagnostic");
  assert.equal(result.sideEffectsExecuted, false);
  assert.equal(result.route.repository, "example/project-1");
  assert.match(result.envelope.run_id, /^ores-[0-9a-f]{24}$/);
  assert.match(result.finalOutput, /executed no provider, Slack, Linear, or GitHub side effects/i);
});

test("diagnostic backend does not invent routes for unmapped channels", async () => {
  const run = createDiagnosticBackend({
    registry: loadFixture(),
    linearRunProjectId: "33333333-3333-3333-3333-333333333333"
  });
  const result = await run("triage", {
    userId: policy.allowedUserIds[0],
    channelId: "C12345678",
    requestId: "Ev-diagnostic-2"
  });
  assert.equal(result.sideEffectsExecuted, false);
  assert.equal(result.route, null);
  assert.equal(result.envelope, null);
});

test("fixture remains stable for provenance review", () => {
  const fixture = writeRegistry();
  const parsed = JSON.parse(readFileSync(fixture.path, "utf8"));
  assert.equal(canonicalJsonSha256(parsed), canonicalJsonSha256(fixture.value));
});
