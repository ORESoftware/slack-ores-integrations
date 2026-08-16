// @ts-check

import {
  BROADCAST_TARGETS,
  MAX_PROMPT_BYTES,
  RUN_ACTIONS,
  RUN_ISSUE_PATTERN,
  RUN_PROVIDERS,
  RUN_REPOSITORY_PATTERN,
  RUN_WRITE_POLICIES
} from "./run-envelope-constants.js";
import { buildRunContext } from "./run-context.js";
import {
  boundedRunText,
  deterministicBridgeWorkflowId,
  deterministicRunId,
  runIdentifier
} from "./run-envelope-utils.js";
import { DiagnosticContractError } from "./contract-error.js";

export function buildSlackAgentRunEnvelope(input) {
  if (!input || typeof input !== "object") {
    throw new DiagnosticContractError("Run-envelope input is required.");
  }
  if (!RUN_PROVIDERS.has(input.provider)) {
    throw new DiagnosticContractError("Provider is unsupported.");
  }
  if (!RUN_ACTIONS.has(input.action)) {
    throw new DiagnosticContractError("Action is unsupported.");
  }
  if (!RUN_WRITE_POLICIES.has(input.writePolicy)) {
    throw new DiagnosticContractError("Write policy is unsupported.");
  }

  const prompt = boundedRunText(input.prompt, "Prompt", MAX_PROMPT_BYTES);
  const workspaceId = runIdentifier(input.workspaceId, "Workspace ID");
  const channelId = runIdentifier(input.channelId, "Channel ID");
  const requesterUserId = runIdentifier(input.requesterUserId, "Requester user ID");
  if (
    typeof input.repository !== "string" ||
    !RUN_REPOSITORY_PATTERN.test(input.repository) ||
    input.repository.endsWith(".git") ||
    input.repository.includes("://")
  ) {
    throw new DiagnosticContractError("Repository is invalid.");
  }
  const linearTeamId = runIdentifier(input.linearTeamId, "Linear team ID");
  const linearProjectId = runIdentifier(input.linearProjectId, "Linear project ID");
  const linearRunProjectId = runIdentifier(input.linearRunProjectId, "Linear run project ID");
  if (input.linearIssue != null && !RUN_ISSUE_PATTERN.test(input.linearIssue)) {
    throw new DiagnosticContractError("Linear issue identifier is invalid.");
  }

  return {
    schema_version: 1,
    run_id: deterministicRunId(input.identitySeed),
    bridge_workflow_id: deterministicBridgeWorkflowId(input.identitySeed),
    provider: input.provider,
    action: input.action,
    prompt,
    origin: {
      workspace_id: workspaceId,
      channel_id: channelId,
      requester_user_id: requesterUserId
    },
    context: {
      trust: "untrusted_channel_context",
      selection: "latest_non_bot_channel_messages",
      messages: buildRunContext(input.contextMessages)
    },
    routing: {
      repository: input.repository,
      linear_team_id: linearTeamId,
      linear_project_id: linearProjectId,
      linear_run_project_id: linearRunProjectId,
      linear_issue: input.linearIssue ?? null,
      write_policy: input.writePolicy
    },
    broadcast_targets: [...BROADCAST_TARGETS]
  };
}
