// @ts-check

import {
  MAX_CONTEXT_MESSAGES,
  MAX_CONTEXT_MESSAGE_BYTES,
  MAX_CONTEXT_TOTAL_BYTES,
  SLACK_TIMESTAMP_PATTERN
} from "./run-envelope-constants.js";
import {
  boundedRunText,
  byteLength,
  compareSlackTimestamps,
  runIdentifier
} from "./run-envelope-utils.js";
import { DiagnosticContractError } from "./contract-error.js";

export function buildRunContext(contextMessages = []) {
  if (!Array.isArray(contextMessages) || contextMessages.length > MAX_CONTEXT_MESSAGES) {
    throw new DiagnosticContractError("Channel context contains too many messages.");
  }
  let totalBytes = 0;
  let previousTimestamp = "";
  return contextMessages.map((message, index) => {
    if (!message || typeof message !== "object" || !SLACK_TIMESTAMP_PATTERN.test(message.ts)) {
      throw new DiagnosticContractError(`Channel context message ${index} is invalid.`);
    }
    if (previousTimestamp && compareSlackTimestamps(previousTimestamp, message.ts) > 0) {
      throw new DiagnosticContractError("Channel context must be chronological.");
    }
    previousTimestamp = message.ts;
    const text = boundedRunText(
      message.text,
      `Channel context message ${index}`,
      MAX_CONTEXT_MESSAGE_BYTES
    );
    totalBytes += byteLength(text);
    if (totalBytes > MAX_CONTEXT_TOTAL_BYTES) {
      throw new DiagnosticContractError("Channel context exceeds the total byte limit.");
    }
    return {
      user_id:
        message.userId == null ? null : runIdentifier(message.userId, `Context user ${index}`),
      ts: message.ts,
      text
    };
  });
}
