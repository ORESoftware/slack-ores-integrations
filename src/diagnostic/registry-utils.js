// @ts-check

import { createHash } from "node:crypto";
import { DiagnosticContractError } from "./contract-error.js";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJsonSha256(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DiagnosticContractError(`${label} must be an object.`);
  }
  return value;
}

export function exactKeys(value, expected, label) {
  const present = new Set(Object.keys(value));
  if (present.size !== expected.size || [...expected].some((key) => !present.has(key))) {
    throw new DiagnosticContractError(`${label} does not match the reviewed registry schema.`);
  }
}

export function textValue(value, label, pattern) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 255 ||
    value.includes("\0") ||
    (pattern && !pattern.test(value))
  ) {
    throw new DiagnosticContractError(`${label} is invalid.`);
  }
  return value;
}

export function stringArray(value, label, pattern) {
  if (!Array.isArray(value)) {
    throw new DiagnosticContractError(`${label} must be an array.`);
  }
  const result = value.map((item, index) => textValue(item, `${label}[${index}]`, pattern));
  if (new Set(result).size !== result.length) {
    throw new DiagnosticContractError(`${label} contains duplicates.`);
  }
  return result;
}

export function integerValue(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new DiagnosticContractError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function sameValue(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) {
    throw new DiagnosticContractError(`${label} has drifted from the reviewed policy.`);
  }
}
