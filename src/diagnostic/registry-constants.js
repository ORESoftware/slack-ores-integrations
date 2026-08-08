export const MAX_REGISTRY_BYTES = 1_048_576;
export const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const SLACK_ID_PATTERN = /^[CSTUW][A-Z0-9]{8,}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const ISSUE_PATTERN = /^[A-Z0-9]{2,10}-[1-9][0-9]*$/;
export const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
export const AGENT_MODES = new Set([
  "claude",
  "chatgpt",
  "both-parallel",
  "both-sequential",
  "review"
]);
export const WRITE_POLICIES = new Set([
  "read_only",
  "linear_only",
  "draft_pull_request"
]);
export const REGISTRY_AUTHORITIES = new Set([
  "development_snapshot_not_runtime_authority",
  "external_reviewed_registry"
]);
export const BINDING_KEYS = new Set([
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
export const BUDGET_KEYS = new Set([
  "max_concurrent_runs",
  "max_runtime_secs",
  "max_tokens",
  "max_spend_cents",
  "max_retries"
]);
