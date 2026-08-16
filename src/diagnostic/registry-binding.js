// @ts-check

import {
  BINDING_KEYS,
  BUDGET_KEYS,
  ISO_TIME_PATTERN,
  ISSUE_PATTERN,
  REPOSITORY_PATTERN,
  SLACK_ID_PATTERN,
  UUID_PATTERN
} from "./registry-constants.js";
import {
  exactKeys,
  integerValue,
  objectValue,
  sameValue,
  stringArray,
  textValue
} from "./registry-utils.js";
import { DiagnosticContractError } from "./contract-error.js";

export function validateRegistryBinding(raw, index, policy, state) {
  const label = `Project registry binding ${index}`;
  const binding = objectValue(raw, label);
  exactKeys(binding, BINDING_KEYS, label);
  const budget = objectValue(binding.budget_policy, `${label} budget`);
  exactKeys(budget, BUDGET_KEYS, `${label} budget`);

  const workspaceId = textValue(binding.workspace_id, `${label} workspace`, SLACK_ID_PATTERN);
  const channelId = textValue(binding.channel_id, `${label} channel`, SLACK_ID_PATTERN);
  const linearTeamId = textValue(binding.linear_team_id, `${label} Linear team`, UUID_PATTERN);
  const linearTeamKey = textValue(
    binding.linear_team_key,
    `${label} Linear team key`,
    /^[A-Z0-9]{2,10}$/
  );
  const linearProjectId = textValue(
    binding.linear_project_id,
    `${label} Linear project`,
    UUID_PATTERN
  );
  const repository = textValue(
    binding.default_repository,
    `${label} repository`,
    REPOSITORY_PATTERN
  );
  const repositoryAllowlist = stringArray(
    binding.repository_allowlist,
    `${label} repository allowlist`,
    REPOSITORY_PATTERN
  );
  const defaultAgentMode = textValue(binding.default_agent_mode, `${label} default mode`);
  const allowedAgentModes = stringArray(binding.allowed_agent_modes, `${label} allowed modes`);
  const allowedUserIds = stringArray(
    binding.allowed_user_ids,
    `${label} users`,
    SLACK_ID_PATTERN
  );
  const allowedUserGroupIds = stringArray(
    binding.allowed_user_group_ids,
    `${label} user groups`,
    SLACK_ID_PATTERN
  );
  const writePolicy = textValue(binding.write_policy, `${label} write policy`);
  const budgetPolicy = {
    max_concurrent_runs: integerValue(
      budget.max_concurrent_runs,
      `${label} concurrent runs`,
      1,
      64
    ),
    max_runtime_secs: integerValue(budget.max_runtime_secs, `${label} runtime`, 1, 86_400),
    max_tokens: integerValue(budget.max_tokens, `${label} tokens`, 1, 10_000_000),
    max_spend_cents: integerValue(budget.max_spend_cents, `${label} spend`, 0, 1_000_000),
    max_retries: integerValue(budget.max_retries, `${label} retries`, 0, 20)
  };

  if (
    workspaceId !== policy.workspaceId ||
    linearTeamId !== policy.linearTeamId ||
    linearTeamKey !== policy.linearTeamKey ||
    policy.rejectedChannelIds.has(channelId) ||
    state.channels.has(channelId) ||
    state.repositories.has(repository.toLowerCase()) ||
    state.projectIds.has(linearProjectId) ||
    repositoryAllowlist.length !== 1 ||
    repositoryAllowlist[0] !== repository
  ) {
    throw new DiagnosticContractError(`${label} has an invalid or duplicate route boundary.`);
  }
  sameValue(defaultAgentMode, policy.defaultAgentMode, `${label} default mode`);
  sameValue(allowedAgentModes, policy.allowedAgentModes, `${label} allowed modes`);
  sameValue(allowedUserIds, policy.allowedUserIds, `${label} users`);
  sameValue(allowedUserGroupIds, policy.allowedUserGroupIds, `${label} user groups`);
  sameValue(writePolicy, policy.writePolicy, `${label} write policy`);
  sameValue(budgetPolicy, policy.budgetPolicy, `${label} budget policy`);

  const updatedAt = textValue(binding.updated_at, `${label} updated at`, ISO_TIME_PATTERN);
  if (!Number.isFinite(Date.parse(updatedAt))) {
    throw new DiagnosticContractError(`${label} updated at is invalid.`);
  }
  state.channels.add(channelId);
  state.repositories.add(repository.toLowerCase());
  state.projectIds.add(linearProjectId);
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
    updatedBy: textValue(binding.updated_by, `${label} updated by`, ISSUE_PATTERN),
    updatedAt
  };
}
