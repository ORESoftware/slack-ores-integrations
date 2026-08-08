export const MAX_PROMPT_BYTES = 100_000;
export const MAX_CONTEXT_MESSAGES = 20;
export const MAX_CONTEXT_MESSAGE_BYTES = 4_000;
export const MAX_CONTEXT_TOTAL_BYTES = 32_000;
export const RUN_ACTIONS = new Set([
  "implement",
  "investigate",
  "review",
  "plan",
  "triage"
]);
export const RUN_PROVIDERS = new Set(["claude", "chatgpt"]);
export const RUN_WRITE_POLICIES = new Set([
  "read_only",
  "linear_only",
  "draft_pull_request"
]);
export const BROADCAST_TARGETS = Object.freeze([
  "ai_agent_bridge_workflow",
  "ai_agent_coordinator_job",
  "github_branch_pr_checks",
  "linear_run_queue",
  "slack_run_thread"
]);
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,255}$/;
export const RUN_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const RUN_ISSUE_PATTERN = /^[A-Z0-9]{2,10}-[1-9][0-9]*$/;
export const SLACK_TIMESTAMP_PATTERN = /^[0-9]{1,20}\.[0-9]{1,12}$/;
