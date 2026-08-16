// @ts-check

import {
  MAX_REGISTRY_BYTES,
  REGISTRY_AUTHORITIES,
  REPOSITORY_PATTERN
} from "./registry-constants.js";
import { validateRegistryBinding } from "./registry-binding.js";
import { ProjectRegistry } from "./registry-model.js";
import { validateRegistryPolicy } from "./registry-policy.js";
import {
  canonicalJsonSha256,
  exactKeys,
  objectValue,
  textValue
} from "./registry-utils.js";
import { readBoundedJson } from "./strict-json.js";
import { DiagnosticContractError } from "./contract-error.js";

export function loadProjectRegistry(options) {
  if (!options || typeof options !== "object") {
    throw new DiagnosticContractError("Registry options are required.");
  }
  if (!/^[0-9a-f]{64}$/.test(options.expectedDigest)) {
    throw new DiagnosticContractError("The project registry digest is invalid.");
  }
  const sourceRepository = textValue(
    options.sourceRepository,
    "Registry source repository",
    REPOSITORY_PATTERN
  );
  const sourceRef = textValue(options.sourceRef, "Registry source ref");
  const sourceCommit = textValue(
    options.sourceCommit,
    "Registry source commit",
    /^[0-9a-f]{40}$/
  );
  const authority = options.authority ?? "development_snapshot_not_runtime_authority";
  if (!REGISTRY_AUTHORITIES.has(authority)) {
    throw new DiagnosticContractError("The project registry authority is invalid.");
  }
  const policy = validateRegistryPolicy(options.policy);
  const { absolutePath, parsed } = readBoundedJson(
    options.path,
    MAX_REGISTRY_BYTES,
    "the project registry"
  );
  const digest = canonicalJsonSha256(parsed);
  if (digest !== options.expectedDigest) {
    throw new DiagnosticContractError(
      "The project registry digest does not match the reviewed snapshot."
    );
  }

  const document = objectValue(parsed, "Project registry");
  exactKeys(document, new Set(["schema_version", "bindings"]), "Project registry");
  if (
    document.schema_version !== 1 ||
    !Array.isArray(document.bindings) ||
    document.bindings.length !== policy.expectedBindingCount
  ) {
    throw new DiagnosticContractError("The project registry shape is unsupported.");
  }
  const state = {
    channels: new Set(),
    repositories: new Set(),
    projectIds: new Set()
  };
  const bindings = document.bindings.map((binding, index) =>
    validateRegistryBinding(binding, index, policy, state)
  );
  return new ProjectRegistry(bindings, {
    sourcePath: absolutePath,
    digest,
    sourceRepository,
    sourceRef,
    sourceCommit,
    authority
  });
}
