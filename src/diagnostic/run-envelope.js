export { buildSlackAgentRunEnvelope } from "./run-envelope-builder.js";
export {
  deterministicBridgeWorkflowId,
  deterministicRunId
} from "./run-envelope-utils.js";

import {
  MAX_CONTEXT_MESSAGES,
  MAX_CONTEXT_MESSAGE_BYTES,
  MAX_CONTEXT_TOTAL_BYTES,
  MAX_PROMPT_BYTES
} from "./run-envelope-constants.js";

export const slackAgentRunLimits = Object.freeze({
  maxPromptBytes: MAX_PROMPT_BYTES,
  maxContextMessages: MAX_CONTEXT_MESSAGES,
  maxContextMessageBytes: MAX_CONTEXT_MESSAGE_BYTES,
  maxContextTotalBytes: MAX_CONTEXT_TOTAL_BYTES
});
