// @ts-check

import { createHash } from "node:crypto";
import { DiagnosticContractError } from "./contract-error.js";

const MAX_PROMPT_BYTES = 100_000;
const MAX_CONTEXT_MESSAGES = 20;
const MAX_CONTEXT_MESSAGE_BYTES = 4_000;
const MAX_CONTEXT_TOTAL_BYTES = 32_000;
const ACTIONS = new Set(["implement", "investigate", "review", "plan", "triage"]);
const PROVIDERS = new Set(["claude", "chatgpt"]);
const WRITE_POLICIES = new Set(["read_only", "linear_only", "draft_pull_request"]);
const BROADCAST_TARGETS = Object.freeze([
  "ai_agent_bridge_workflow",
  "ai_agent_coordinator_job",
  "github_branch_pr_checks",
  "linear_run_queue",
  "slack_run_thread"
]);
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,255}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ISSUE = /^[A-Z0-9]{2,10}-[1-9][0-9]*$/;
const SLACK_TIMESTAMP = /^[0-9]{1,20}\.[0-9]{1,12}$/;

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function compareSlackTimestamps(left, right) {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const leftValue = BigInt(leftParts[0] ?? "0");
  const rightValue = BigInt(rightParts[0] ?? "0");
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  const normalizedLeft = (leftParts[1] ?? "").padEnd(12, "0");
  const normalizedRight = (rightParts[1] ?? "").padEnd(12, "0");
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function boundedText(value, label, maxBytes) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || byteLength(value) > maxBytes) {
    throw new DiagnosticContractError(`${label} is invalid.`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new DiagnosticContractError(`${label} is invalid.`);
  }
  return value;
}

export function deterministicRunId(seed) {
  const normalized = boundedText(seed, "Run identity seed", 8_192);
  return `ores-${createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 24)}`;
}

export function deterministicBridgeWorkflowId(seed) {
  const normalized = boundedText(seed, "Workflow identity seed", 8_192);
  return `bridge-${createHash("sha256")
    .update(`workflow:${normalized}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

/**
 * @typedef {{ userId?: string | null, ts: string, text: string }} ChannelContextMessage
 * @typedef {{
 *   provider: "claude" | "chatgpt",
 *   action: "implement" | "investigate" | "review" | "plan" | "triage",
 *   prompt: string,
 *   workspaceId: string,
 *   channelId: string,
 *   requesterUserId: string,
 *   repository: string,
 *   linearTeamId: string,
 *   linearProjectId: string,
 *   linearRunProjectId: string,
 *   linearIssue?: string | null,
 *   writePolicy: "read_only" | "linear_only" | "draft_pull_request",
 *   contextMessages?: ChannelContextMessage[],
 *   identitySeed: string
 * }} SlackAgentRunEnvelopeInput
 */

/** @param {SlackAgentRunEnvelopeInput} input */
export function buildSlackAgentRunEnvelope(input) {
  if (!PROVIDERS.has(input.provider)) throw new DiagnosticContractError("Provider is unsupported.");
  if (!ACTIONS.has(input.action) throw new DiagnosticContractError(Action is unsupported.");
  if (!WRITE_POLICIES.has(input.writePolicy)) throw new DiagnosticContractError("Write policy is unsupported.");

  const prompt = boundedText(input.prompt, "Prompt", MAX_PROMPT_BYTES);
  const workspaceId = identifier(input.workspaceId, "Workspace ID");
  const channelId = identifier(input.channelId, "Channel ID");
  const requesterUserId = identifier(input.requesterUserId, "Requester user ID");
  if (!REPOSITORY.test(input.repository) || input.repository.endsWith(".git") || input.repository.includes("://")) {
    throw new DiagnosticContractError("Repository is invalid.");
  }

  const linearTeamId = identifier(input.linearTeamId, "Linear team ID");
  const linearProjectId = identifier(input.linearProjectId, "Linear project ID");
  const linearRunProjectId = identifier(input.linearRunProjectId, "Linear run project ID");
  if (input.linearIssue != null && !ISSUE.test(input.linearIssue)) {
    throw new DiagnosticContractError("Linear issue identifier is invalid.");
  }

  const contextMessages = input.contextMessages ?? [];
  if (!Array.isArray(contextMessages) || contextMessages.length > MAX_CONTEXT_MESSAGES) {
    throw new DiagnosticContractError("Channel context contains too many messages.");
  }

  let contextBytes = 0;
  let previousTimestamp = "";
  const messages = contextMessages.map((message, index) => {
    if (!message || typeof message !== "object") {
      throw new DiagnosticContractError(`Channel context message ${index} is invalid.`);
    }
    const timestamp = typeof message.ts === "string" && SLACK_TIMESTAMP.test(message.ts) ? message.ts : undefined;
    if (!timestamp || (previousTimestamp && compareSlackTimestamps(previousTimestamp, timestamp) > 0)) {
      throw new DiagnosticContractError("Channel context must be chronological.");
    }
    previousTimestamp = timestamp;
    const text = boundedText(message.text, `Channel context message ${index}`, MAX_CONTEXT_MESSAGE_BYTES);
    contextBytes += byteLength(text);
    if (contextBytes > MAX_CONTEXT_TOTAL_BYTES) {
      throw new DiagnosticContractError(Channel context exceeds the total byte limit.");
    }
    return {
      user_id: message.userId == null ? null : identifier(message.userId, `Channel context user ${index}`),
      ts: timestamp,
      text
    };
  });

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
      messages
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

export const slackAgentRunLimits = Object.freeze({
  maxPromptBytes: MAX_PROMPT_BYTES,
  maxContextMessages: MAX_CONTEXT_MESSAGES,
  maxContextMessageBytes: MAX_CONTEXT_MESSAGE_BYTES,
  maxContextTotalBytes: MAX_CONTEXT_TOTAL_BYTES
});
