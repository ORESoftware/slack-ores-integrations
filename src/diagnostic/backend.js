// @ts-check

import { DiagnosticContractError } from "./contract-error.js";
import { buildSlackAgentRunEnvelope } from "./run-envelope.js";

function isInputItem(value) {
  return Boolean(value && typeof value === "object");
}

function latestPrompt(input) {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) throw new DiagnosticContractError("Diagnostic input must be text or message items.");
  const item = [...input].reverse().find((candidate) => isInputItem(candidate) && candidate.role === "user");
  return isInputItem(item) && typeof item.content === "string" ? item.content : "";
}

export function createDiagnosticBackend(options) {
  if (!options?.registry || typeof options.registry.resolve !== "function") {
    throw new DiagnosticContractError("A reviewed project registry is required.");
  }
  if (typeof options.linearRunProjectId !== "string" || !options.linearRunProjectId) {
    throw new DiagnosticContractError("A Linear run-ledger project ID is required.");
  }
  const provider = options.provider ?? "chatgpt";
  const action = options.action ?? "triage";

  return async function runDiagnostic(input, dependencies = {}) {
    const prompt = latestPrompt(input);
    const historyTurns =
      typeof input === "string" ? 1 : input.filter((item) => isInputItem(item) && item.role === "user").length;
    const channelId = String(dependencies.channelId ?? "");
    const route = options.registry.resolve(channelId);
    if (!route) {
      return {
        finalOutput:
          "Diagnostic mode executed no provider, Slack, Linear, or GitHub side effects.\n\n" +
          `No reviewed project route exists for channel \`${channelId || "unknown"}\`.`,
        history: [],
        executionBackend: "diagnostic",
        sideEffectsExecuted: false,
        route: null,
        envelope: null
      };
    }

    const envelope = buildSlackAgentRunEnvelope({
      provider,
      action,
      prompt,
      workspaceId: route.workspaceId,
      channelId: route.channelId,
      requesterUserId: String(dependencies.userId ?? ""),
      repository: route.repository,
      linearTeamId: route.linearTeamId,
      linearProjectId: route.linearProjectId,
      linearRunProjectId: options.linearRunProjectId,
      linearIssue: dependencies.linearIssue ?? null,
      writePolicy: route.writePolicy,
      contextMessages: dependencies.contextMessages ?? [],
      identitySeed: String(dependencies.requestId ?? `${route.channelId}:${prompt}`)
    });
    const writeLine = dependencies.explicitWriteIntent
      ? "A write prefix was supplied, but diagnostic mode exposes no write tools and executed no side effect."
      : "No write capability was requested or exposed.";

    return {
      finalOutput:
        "Diagnostic mode executed no provider, Slack, Linear, or GitHub side effects.\n\n" +
        `Route: \`${route.repository}\` → Linear project \`${route.linearProjectId}\`\n` +
        `Draft run: \`${envelope.run_id}\` · mode \`${route.defaultAgentMode}\` · policy \`${route.writePolicy}\`\n` +
        `Diagnostic history turns: ${historyTurns}\n${writeLine}`,
      history: [],
      executionBackend: "diagnostic",
      sideEffectsExecuted: false,
      route: {
        channelId: route.channelId,
        repository: route.repository,
        linearProjectId: route.linearProjectId,
        writePolicy: route.writePolicy
      },
      envelope
    };
  };
}
