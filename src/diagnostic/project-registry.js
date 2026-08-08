// @ts-check

import { createHash } from "node:crypto";
import { DiagnosticContractError } from "./contract-error.js";
import { readBoundedJson } from "./strict-json.js";

const MAX_REGISTRY_BYTES = 1_048_576;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SLACK_ID_PATTERN = /^[CSTUW][A-Z0-9]{8,}$/;
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ISSUE_PATTERN = /^[A-Z0-9]{2,10}-[1-9][0-9]*$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SUPPORTED_AGENT_MODES = Object.freeze(["claude", "chatgpt", "both-parallel", "both-sequential", "review"]);
const SUPPORTED_WRITE_POLICIES = new Set(["read_only", "linear_only", "draft_pull_request"]);
const SUPPORTED_AUTHORITIES = new Set(["development_snapshot_not_runtime_authority", "external_reviewed_registry"]);
const REQUIRED_BINDING_KEYS = new Set([
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
const REQUIRED_BUDGET_KEYS = new Set([
  "max_concurrent_runs",
  "max_runtime_secs",
  "max_tokens",
  "max_spend_cents",
  "max_retries"
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJsonSha256(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DiagnosticContractError(`${label} must be an object.`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

function exactKeys(value, required, label) {
  const present = new Set(Object.keys(value));
  const missing = [...required].filter((key) => !present.has(key));
  const unknown = [...present].filter((key) => !required.has(key));
  if (missing.length || unknown.length) {
    throw new DiagnosticContractError(`${label} does not match the reviewed registry schema.`);
  }
}

function nonEmptyString(value, label, pattern) {
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

function stringArray(value, label, pattern) {
  if (!Array.isArray(value)) throw new DiagnosticContractError(`${label} must be an array.`);
  const items = value.map((item, index) => nonEmptyString(item, `${label}[${index}]`, pattern));
  if (new Set(items).size !== items.length) throw new DiagnosticContractError(`${label} contains duplicates.`);
  return items;
}

function boundedInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new DiagnosticContractError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return Number(value);
}

function exactArray(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) {
    throw new DiagnosticContractError(`${label} has drifted from the reviewed policy.`);
  }
}

function validatePolicy(policy) {
  const value = objectValue(policy, "Project registry policy");
  const expectedBindingCount = boundedInteger(value.expectedBindingCount, "Expected binding count", 1, 1_000);
  const workspaceId = nonEmptyString(value.workspaceId, "Expected workspace ID", SLACK_ID_PATTERN);
  const linearTeamId = nonEmptyString(value.linearTeamId, "Expected Linear team ID", UUID_PATTERN);
  const linearTeamKey = nonEmptyString(value.linearTeamKey, "Expected Linear team key", /^[A-Z0-9]{2,10}$/);
  const allowedAgentModes = stringArray(value.allowedAgentModes, "Expected allowed agent modes");
  if (allowedAgentModes.some((mode) => !SUPPORTED_AGENT_MODES.includes(mode))) {
    throw new DiagnosticContractError("Expected agent-mode policy is unsupported.");
  }
  const defaultAgentMode = nonEmptyString(value.defaultAgentMode, "Expected default agent mode");
  if (!allowedAgentModes.includes(defaultAgentMode)) {
    throw new DiagnosticContractError("Expected default agent mode is not allowed.");
  }
  const allowedUserIds = stringArray(value.allowedUserIds, "Expected user IDs", SLACK_ID_PATTERN);
  const allowedUserGroupIds = stringArray(value.allowedUserGroupIds, "Expected user-group IDs", SLACK_ID_PATTERN);
  const writePolicy = nonEmptyString(value.writePolicy, "Expected write policy");
  if (!SUPPORTED_WRITE_POLICIES.has(writePolicy)) {
    throw new DiagnosticContractError("Expected write policy is unsupported.");
  }
  const budget = objectValue(value.budgetPolicy, "Expected budget policy");
  exactKeys(budget, REQUIRED_BUDGET_KEYS, "Expected budget policy");
  const budgetPolicy = {
    maxConcurrentRuns: boundedInteger(budget.max_concurrent_runs, "Expected concurrent-run limit", 1, 64),
    maxRuntimeSecs: boundedInteger(budget.max_runtime_secs, "Expected runtime limit", 1, 86_400),
    maxTokens: boundedInteger(budget.max_tokens, "Expected token limit", 1, 10_000_000),
    maxSpendCents: boundedInteger(budget.max_spend_cents, "Expected spend limit", 0, 1_000_000),
    maxRetries: boundedInteger(budget.max_retries, "Expected retry limit", 0, 20)
  };
  return {
    expectedBindingCount,
    workspaceId,
    linearTeamId,
    linearTeamKey,
    allowedAgentModes,
    defaultAgentMode,
    allowedUserIds,
    allowedUserGroupIds,
    writePolicy,
    budgetPolicy,
    rejectedChannelIds: new Set(stringArray(value.rejectedChannelIds ?? [], "Rejected channel IDs", SLACK_ID_PATTERN))
  };
}

export class ProjectRegistry {
  constructor(bindings, metadata) {
    this.bindings = Object.freeze(
      bindings.map((binding) =>
        Object.freeze({
          ...binding,
          repositoryAllowlist: Object.freeze([...binding.repositoryAllowlist]),
          allowedAgentModes: Object.freeze([...binding.allowedAgentModes]),
          allowedUserIds: Object.freeze([...binding.allowedUserIds]),
          allowedUserGroupIds: Object.freeze([...binding.allowedUserGroupIds]),
          budgetPolicy: Object.freeze({ ...binding.budgetPolicy })
        })
      )
    );
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
  if (!options || typeof options !== "object") throw new DiagnosticContractError("Registry options are required.");
  if (!/^[0-9a-f]{64}$/.test(options.expectedDigest)) {
    throw new DiagnosticContractError("The project registry digest is invalid.");
  }
  if (!REPOSITORY_PATTERN.test(options.sourceRepository)) {
    throw new DiagnosticContractError("The project registry source repository is invalid.");
  }
  if (!/^[0-9a-f]{40}$/.test(options.sourceCommit)) {
    throw new DiagnosticContractError("The project registry source commit is invalid.");
  }
  const authority = options.authority ?? "development_snapshot_not_runtime_authority";
  if (!SUPPORTED_AUTHORITIES.has(authority)) {
    throw new DiagnosticContractError("The project registry authority is invalid.");
  }
  const policy = validatePolicy(options.policy);
  const { absolutePath, parsed } = readBoundedJson(options.path, MAX_REGISTRY_BYTES, "the project registry");
  const digest = canonicalJsonSha256(parsed);
  if (digest !== options.expectedDigest) {
    throw new DiagnosticContractError("The project registry digest does not match the reviewed snapshot.");
  }

  const document = objectValue(parsed, "Project registry");
  exactKeys(document, new Set(["schema_version", "bindings"]), "Project registry");
  if (
    document.schema_version !== 1 ||
    !Array.isArray(document.bindings) ||
    document.bindings.length !== policy.expectedBindingCount
  ) {
    throw new DiagnosticContractError("The project registry shape is unsupported.");
  }

  const channels = new Set();
  const repositories = new Set();
  const projectIds = new Set();
  const bindings = document.bindings.map((item, index) => {
    const label = `Project registry binding ${index}`;
    const binding = objectValue(item, label);
    exactKeys(binding, REQUIRED_BINDING_KEYS, label);
    const budget = objectValue(binding.budget_policy, `${label} budget`);
    exactKeys(budget, REQUIRED_BUDGET_KEYS, `${label} budget`);

    const workspaceId = nonEmptyString(binding.workspace_id, `${label} workspace`, SLACK_ID_PATTERN);
    const channelId = nonEmptyString(binding.channel_id, `${label} channel`, SLACK_ID_PATTERN);
    const linearTeamId = nonEmptyString(binding.linear_team_id, `${label} Linear team`, UUID_PATTERN);
    const linearTeamKey = nonEmptyString(binding.linear_team_key, `${label} Linear team key`, /^[A-Z0-9]{2,10}$/);
    const linearProjectId = nonEmptyString(binding.linear_project_id, `${label} Linear project`, UUID_PATTERN);
    const repository = nonEmptyString(binding.default_repository, `${label} repository`, REPOSITORY_PATTERN);
    const repositoryAllowlist = stringArray(binding.repository_allowlist, `${label} repository allowlist`, REPOSITORY_PATTERN);
    const allowedAgentModes = stringArray(binding.allowed_agent_modes, `${label} allowed modes`);
    const defaultAgentMode = nonEmptyString(binding.default_agent_mode, `${label} default mode`);
    const allowedUserIds = stringArray(binding.allowed_user_ids, `${label} users`, SLACK_ID_PATTERN);
    const allowedUserGroupIds = stringArray(binding.allowed_user_group_ids, `${label} user groups`, SLACK_ID_PATTERN);
    const writePolicy = nonEmptyString(binding.write_policy, `${label} write policy`);

    if (workspaceId !== policy.workspaceId || policy.rejectedChannelIds.has(channelId) || channels.has(channelId)) {
      throw new DiagnosticContractError(`${label} has an invalid or duplicate Slack route.`);
    }
    if (
      repositories.has(repository.toLowerCase()) ||
      repositoryAllowlist.length !== 1 ||
      repositoryAllowlist[0] !== repository
    ) {
      throw new DiagnosticContractError(`${label} has an invalid repository boundary.`);
    }
    if (projectIds.has(linearProjectId)) {
      throw new DiagnosticContractError(`${label} duplicates a Linear project UUID.`);
    }
    if (linearTeamId !== policy.linearTeamId || linearTeamKey !== policy.linearTeamKey) {
      throw new DiagnosticContractError(`${label} has an unexpected Linear team.`);
    }
    if (defaultAgentMode !== policy.defaultAgentMode) {
      throw new DiagnosticContractError(`${label} has drifted default agent mode.`);
    }
    exactArray(allowedAgentModes, policy.allowedAgentModes, `${label} allowed modes`);
    exactArray(allowedUserIds, policy.allowedUserIds, `${label} users`);
    exactArray(allowedUserGroupIds, policy.allowedUserGroupIds, `${label} user groups`);
    if (writePolicy !== policy.writePolicy || !SUPPORTED_WRITE_POLICIES.has(writePolicy)) {
      throw new DiagnosticContractError(`${label} has drifted write policy.`);
    }

    const budgetPolicy = {
      maxConcurrentRuns: boundedInteger(budget.max_concurrent_runs, `${label} max concurrent runs`, 1, 64),
      maxRuntimeSecs: boundedInteger(budget.max_runtime_secs, `${label} max runtime`, 1, 86_400),
      maxTokens: boundedInteger(budget.max_tokens, `${label} max tokens`, 1, 10_000_000),
      maxSpendCents: boundedInteger(budget.max_spend_cents, `${label} max spend`, 0, 1_000_000),
      maxRetries: boundedInteger(budget.max_retries, `${label} max retries`, 0, 20)
    };
    if (canonical(budgetPolicy) !== canonical(policy.budgetPolicy)) {
      throw new DiagnosticContractError(`${label} has drifted budget policy.`);
    }

    const updatedAt = nonEmptyString(binding.updated_at, `${label} updated at`, ISO_TIMESTAMP_PATTERN);
    if (!Number.isFinite(Date.parse(updatedAt)) throw new DiagnosticContractError(`${label} updated at is invalid.`);

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
      updatedBy: nonEmptyString(binding.updated_by, `${label} updated by`, ISSUE_PATTERN),
      updatedAt
    };
  });

  return new ProjectRegistry(bindings, {
    sourcePath: absolutePath,
    digest,
    sourceRepository: options.sourceRepository,
    sourceRef: nonEmptyString(options.sourceRef, "Project registry source ref"),
    sourceCommit: options.sourceCommit,
    authority
  });
}
