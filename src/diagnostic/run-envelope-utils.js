// @ts-check

import { createHash } from "node:crypto";
import { IDENTIFIER_PATTERN } from "./run-envelope-constants.js";
import { DiagnosticContractError } from "./contract-error.js";

export function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

export function boundedRunText(value, label, maximum) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    byteLength(value) > maximum
  ) {
    throw new DiagnosticContractError(`${label} is invalid.`);
  }
  return value;
}

export function runIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new DiagnosticContractError(`${label} is invalid.`);
  }
  return value;
}

export function compareSlackTimestamps(left, right) {
  const [leftSeconds = "0", leftFraction = ""] = left.split(".");
  const [rightSeconds = "0", rightFraction = ""] = right.split(".");
  const secondsComparison = BigInt(leftSeconds) - BigInt(rightSeconds);
  if (secondsComparison !== 0n) return secondsComparison < 0n ? -1 : 1;
  return leftFraction.padEnd(12, "0").localeCompare(rightFraction.padEnd(12, "0"));
}

export function deterministicRunId(seed) {
  return `ores-${createHash("sha256")
    .update(boundedRunText(seed, "Run identity seed", 8_192), "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

export function deterministicBridgeWorkflowId(seed) {
  const value = boundedRunText(seed, "Workflow identity seed", 8_192);
  return `bridge-${createHash("sha256")
    .update(`workflow:${value}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}
