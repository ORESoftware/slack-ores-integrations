// @ts-check

import {
  AGENT_MODES,
  BUDGET_KEYS,
  SLACK_ID_PATTERN,
  UUID_PATTERN,
  WRITE_POLICIES
} from "./registry-constants.js";
import {
  exactKeys,
  integerValue,
  objectValue,
  stringArray,
  textValue
} from "./registry-utils.js";
import { DiagnosticContractError } from "./contract-error.js";

export function validateRegistryPolicy(raw) {
  const policy = objectValue(raw, "Project registry policy");
  const allowedAgentModes = stringArray(policy.allowedAgentModes, "Allowed agent modes");
  if (allowedAgentModes.some((mode) => !AGENT_MODES.has(mode))) {
    throw new DiagnosticContractError("Allowed agent-mode policy is unsupported.");
  }
  const defaultAgentMode = textValue(policy.defaultAgentMode, "Default agent mode");
  if (!allowedAgentModes.includes(defaultAgentMode)) {
    throw new DiagnosticContractError("Default agent mode is not allowed.");
  }
  const writePolicy = textValue(policy.writePolicy, "Write policy");
  if (!WRITE_POLICIES.has(writePolicy)) {
    throw new DiagnosticContractError("Write policy is unsupported.");
  }
  const budget = objectValue(policy.budgetPolicy, "Budget policy");
  exactKeys(budget, BUDGET_KEYS, "Budget policy");
  return {
    expectedBindingCount: integerValue(policy.expectedBindingCount, "Binding count", 1, 1_000),
    workspaceId: textValue(policy.workspaceId, "Workspace ID", SLACK_ID_PATTERN),
    linearTeamId: textValue(policy.linearTeamId, "Linear team ID", UUID_PATTERN),
    linearTeamKey: textValue(policy.linearTeamKey, "Linear team key", /^[A-Z0-9]{2,10}$/),
    defaultAgentMode,
    allowedAgentModes,
    allowedUserIds: stringArray(policy.allowedUserIds, "Allowed user IDs", SLACK_ID_PATTERN),
    allowedUserGroupIds: stringArray(
      policy.allowedUserGroupIds,
      "Allowed user-group IDs",
      SLACK_ID_PATTERN
    ),
    writePolicy,
    budgetPolicy: {
      max_concurrent_runs: integerValue(budget.max_concurrent_runs, "Concurrent-run limit", 1, 64),
      max_runtime_secs: integerValue(budget.max_runtime_secs, "Runtime limit", 1, 86_400),
      max_tokens: integerValue(budget.max_tokens, "Token limit", 1, 10_000_000),
      max_spend_cents: integerValue(budget.max_spend_cents, "Spend limit", 0, 1_000_000),
      max_retries: integerValue(budget.max_retries, "Retry limit", 0, 20)
    },
    rejectedChannelIds: new Set(
      stringArray(policy.rejectedChannelIds ?? [], "Rejected channel IDs", SLACK_ID_PATTERN)
    )
  };
}
