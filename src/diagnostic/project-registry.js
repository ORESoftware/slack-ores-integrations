// @ts-check

import { createHash } from "node:crypto";
import { DiagnosticContractError } from "./contract-error.js";
import { readBoundedJson } from "./strict-json.js";

const MAX_REGISTRY_BYTES = 1_048_576;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SLACK_ID = /^[CSTUW][A-Z0-9]{8,}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ISSUE = /^[A-Z0-9]{2,10}-[1-9][0-9]*$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MODES = new Set(["claude", "chatgpt", "both-parallel", "both-sequential", "review"]);
const WRITE_POLICIES = new Set(["read_only", "linear_only", "draft_pull_request"]);
const AUTHORITIES = new Set([
  "development_snapshot_not_runtime_authority",
  "external_reviewed_registry"
]);
const BINDING_KEYS = new Set([
  "workspace_id",
  "channel_id",
  "linear_team_id",
  "linear_team_key",
  "linear_project_id",
  "default_repository",
  "repository_allowlist",
  "default_agent_mode",
  "allowed_agent_modes",
  "allowed_user_ids",
  "allowed_user_group_ids",
  "write_policy",
  "budget_policy",
  "updated_by",
  "updated_at"
]);
const BUDGET_KEYS = new Set([
  "max_concurrent_runs",
  "max_runtime_secs",
  "max_tokens",
  "max_spend_cents",
  "max_retries"
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJsonSha256(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DiagnosticContractError(`${label} must be an object.`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const present = new Set(Object.keys(value));
  if (
    present.size !== expected.size ||
    [...expected].some((key) => !present.has(key))
  ) {
    throw new DiagnosticContractError(`${label} does not match the reviewed registry schema.`);
  }
}

function text(value, label, pattern) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 255 ||
    value.includes("\0") ||
    (pattern && !pattern.test(value))
  ) {
    throw new DiagnosticContractError(`${label} is invalid.`);
  }
  return value;
}

function strings(value, label, pattern) {
  if (!Array.isArray(value)) throw new DiagnosticContractError(`${label} must be an array.`);
  const result = value.map((item, index) => text(item, `${label}[${index}]`, pattern));
  if (new Set(result).size !== result.length) {
    throw new DiagnosticContractError(`${label} contains duplicates.`);
  }
  return result;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new DiagnosticContractError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function same(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) {
    throw new DiagnosticContractError(`${label} has drifted from the reviewed policy.`);
  }
}

function validatePolicy(raw) {
  const policy = object(raw, "Project registry policy");
  const allowedAgentModes = strings(policy.allowedAgentModes, "Allowed agent modes");
  if (allowedAgentModes.some((mode) => !MODES.has(mode))) {
    throw new DiagnosticContractError("Allowed agent-mode policy is unsupported.");
  }
  const defaultAgentMode = text(policy.defaultAgentMode, "Default agent mode");
  if (!allowedAgentModes.includes(defaultAgentMode)) {
    throw new DiagnosticContractError(Default agent mode is not allowed.");
  }
  const writePolicy = text(policy.writePolicy, "Write policy");
  if (!WRITE_POLICIES.has(writePolicy)) {
    throw new DiagnosticContractError(Write policy is unsupported.");
  }
  const budget = object(policy.budgetPolicy, "Budget policy");
  exactKeys(budget, BUDGET_KEYS, Budget policy");
  return {
    expectedBindingCount: integer(policy.expectedBindingCount, "Binding count", 1, 1_000),
    workspaceId: text(policy.workspaceId, "Workspace ID", SLACK_ID),
    linearTeamId: text(policy.linearTeamId, "Linear team ID", UUID),
    linearTeamKey: text(policy.linearTeamKey, "Linear team key", /^[A-Z0-9]{2,10}$/),
    defaultAgentMode,
    allowedAgentModes,
    allowedUserIds: strings(policy.allowedUserIds, "Allowed user IDs", SLACK_ID),
    allowedUserGroupIds: strings(policy.allowedUserGroupIds, "Allowed user-group IDs", SLACK_ID),
    writePolicy,
    budgetPolicy: {
      max_concurrent_runs: integer(budget.max_concurrent_runs, "Concurrent-run limit", 1, 64),
      max_runtime_secs: integer(budget.max_runtime_secs, "Runtime limit", 1, 86_400),
      max_tokens: integer(budget.max_tokens, "Token limit", 1, 10_000_000),
      max_spend_cents: integer(budget.max_spend_cents, "Spend limit", 0, 1_000_000),
      max_retries: integer(budget.max_retries, "Retry limit", 0, 20)
    },
    rejectedChannelIds: new Set(strings(policy.rejectedChannelIds ?? [], "Rejected channel IDs", SLACK_ID))
  };
}

export class ProjectRegistry {
  constructor(bindings, metadata) {
    this.bindings = Object.freeze(bindings.map((binding) => Object.freeze({ ...binding })));
    this.metadata = Object.freeze({ ...metadata });
    this.byChannel = new Map(this.bindings.map((binding) => [binding.channelId, binding]));
  }

  resolve(channelId) {
    return this.byChannel.get(channelId) ?? null;
  }

  publicSummary() {
    return {
      schemaVersion: 1,
      authority: this.metadata.authority,
      sourceRepository: this.metadata.sourceRepository,
      sourceRef: this.metadata.sourceRef,
      sourceCommit: this.metadata.sourceCommit,
      canonicalSha256: this.metadata.digest,
      bindingCount: this.bindings.length,
      routes: this.bindings.map((binding) => ({
        channelId: binding.channelId,
        linearProjectId: binding.linearProjectId,
        repository: binding.repository,
        defaultAgentMode: binding.defaultAgentMode,
        writePolicy: binding.writePolicy
      }))
    };
  }
}

export function loadProjectRegistry(options) {
  if (!options || typeof options !== "object") {
    throw new DiagnosticContractError("Registry options are required.");
  }
  if (!/^[0-9a-f]{64}$/.test(options.expectedDigest)) {
    throw new DiagnosticContractError(The project registry digest is invalid.");
  }
  const sourceRepository = text(options.sourceRepository, "Registry source repository", REPOSITORY);
  const sourceRef = text(options.sourceRef, "Registry source ref");
  const sourceCommit = text(options.sourceCommit, "Registry source commit", /^[0-9a-f]{40}$/);
  const authority = options.authority ?? "development_snapshot_not_runtime_authority";
  if (!AUTHORITIES.has(authority)) {
    throw new DiagnosticContractError(The project registry authority is invalid.");
  }
  const policy = validatePolicy(options.policy);
  const { absolutePath, parsed } = readBoundedJson(
    options.path,
    MAX_REGISTRY_BYTES,
    "the project registry"
  );
  const digest = canonicalJsonSha256(parsed);
  if (digest !== options.expectedDigest) {
    throw new DiagnosticContractError(The project registry digest does not match the reviewed snapshot.");
  }

  const document = object(parsed, "Project registry");
  exactKeys(document, new Set(["schema_version", "bindings"]), "Project registry");
  if (
    document.schema_version !== 1 ||
    !Array.isArray(document.bindings) ||
    document.bindings.length !== policy.expectedBindingCount
  ) {
    throw new DiagnosticContractError(The project registry shape is unsupported.");
  }

  const channels = new Set();
  const repositories = new Set();
  const projectIds = new Set();
  const bindings = document.bindings.map((raw, index) => {
    const label = `Project registry binding ${index}`;
    const binding = object(raw, label);
    exactKeys(binding, BINDING_KEYS, label);
    const budget = object(binding.budget_policy, `${label} budget`);
    exactKeys(budget, BUDGET_KEYS, `${label} budget`);

    const workspaceId = text(binding.workspace_id, `${label} workspace`, SLACK_ID);
    const channelId = text(binding.channel_id, `${label} channel`, SLACK_ID);
    const linearTeamId = text(binding.linear_team_id, `${label} Linear team`, UUID);
    const linearTeamKey = text(binding.linear_team_key, `${label} Linear team key`, /^[A-Z0-9]{2,10}$/);
    const linearProjectId = text(binding.linear_project_id, `${label} Linear project`, UUID);
    const repository = text(binding.default_repository, `${label} repository`, REPOSITORY);
    const repositoryAllowlist = strings(binding.repository_allowlist, `${label} repository allowlist`, REPOSITORY);
    const defaultAgentMode = text(binding.default_agent_mode, `${label} default mode`);
    const allowedAgentModes = strings(binding.allowed_agent_modes, `${label} allowed modes`);
    const allowedUserIds = strings(binding.allowed_user_ids, `${label} users`, SLACK_ID);
    const allowedUserGroupIds = strings(binding.allowed_user_group_ids, `${label} user groups`, SLACK_ID);
    const writePolicy = text(binding.write_policy, `${label} write policy`);
    const budgetPolicy = {
      max_concurrent_runs: integer(budget.max_concurrent_runs, `${label} concurrent runs`, 1, 64),
      max_runtime_secs: integer(budget.max_runtime_secs, `${label} runtime`, 1, 86_400),
      max_tokens: integer(budget.max_tokens, `${label} tokens`, 1, 10_000_000),
      max_spend_cents: integer(budget.max_spend_cents, `${label} spend`, 0, 1_000_000),
      max_retries: integer(budget.max_retries, `${label} retries`, 0, 20)
    };

    if (
      workspaceId !== policy.workspaceId ||
      linearTeamId !== policy.linearTeamId ||
      linearTeamKey !== policy.linearTeamKey ||
      policy.rejectedChannelIds.has(channelId) ||
      channels.has(channelId) ||
      repositories.has(repository.toLowerCase()) ||
      projectIds.has(linearProjectId) ||
      repositoryAllowlist.length !== 1 ||
      repositoryAllowlist[0] !== repository
    ) {
      throw new DiagnosticContractError(`${label} has an invalid or duplicate route boundary.`);
    }
    same(defaultAgentMode, policy.defaultAgentMode, `${label} default mode`);
    same(allowedAgentModes, policy.allowedAgentModes, `${label} allowed modes`);
    same(allowedUserIds, policy.allowedUserIds, `${label} users`);
    same(allowedUserGroupIds, policy.allowedUserGroupIds, `${label} user groups`);
    same(writePolicy, policy.writePolicy, `${label} write policy`);
    same(budgetPolicy, policy.budgetPolicy, `${label} budget policy`);

    const updatedAt = text(binding.updated_at, `${label} updated at`, ISO_TIME);
    if (!Number.isFinite(Date.parse(updatedAt))) {
      throw new DiagnosticContractError(`${label} updated at is invalid.`);
    }
    channels.add(channelId);
    repositories.add(repository.toLowerCase());
    projectIds.add(linearProjectId);
    return {
      workspaceId,
      channelId,
      linearTeamId,
      linearTeamKey,
      linearProjectId,
      repository,
      repositoryAllowlist,
      defaultAgentMode,
      allowedAgentModes,
      allowedUserIds,
      allowedUserGroupIds,
      writePolicy,
      budgetPolicy,
      updatedBy: text(binding.updated_by, `${label} updated by`, ISSUE),
      updatedAt
    };
  });

  return new ProjectRegistry(bindings, {
    sourcePath: absolutePath,
    digest,
    sourceRepository,
    sourceRef,
    sourceCommit,
    authority
  });
}
