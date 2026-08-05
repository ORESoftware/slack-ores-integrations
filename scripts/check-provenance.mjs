import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const commitPattern = /^[a-f0-9]{40}$/;

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} fields must be exactly: ${wanted.join(", ")}`);
  }
}

function assertRepositoryPin(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  assertExactKeys(value, ["repository", "commit"], label);
  if (!repositoryPattern.test(value.repository)) {
    throw new Error(`${label}.repository must use owner/name form`);
  }
  if (!commitPattern.test(value.commit)) {
    throw new Error(`${label}.commit must be a lowercase 40-character Git SHA`);
  }
}

export function validateProvenance(provenance, commandDefinitions) {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    throw new TypeError("provenance must be an object");
  }
  assertExactKeys(
    provenance,
    [
      "schemaVersion",
      "canonicalRepository",
      "importedFrom",
      "productionIngress",
      "gitOps",
      "slack"
    ],
    "provenance"
  );
  if (provenance.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (provenance.canonicalRepository !== "ORESoftware/slack-ores-integrations") {
    throw new Error("canonicalRepository must identify ORESoftware/slack-ores-integrations");
  }

  assertRepositoryPin(provenance.importedFrom, "importedFrom");
  assertRepositoryPin(provenance.productionIngress, "productionIngress");
  if (provenance.importedFrom.repository === provenance.productionIngress.repository) {
    throw new Error("source import and production ingress repositories must remain distinct");
  }

  if (!provenance.gitOps || typeof provenance.gitOps !== "object" || Array.isArray(provenance.gitOps)) {
    throw new TypeError("gitOps must be an object");
  }
  assertExactKeys(provenance.gitOps, ["repository"], "gitOps");
  if (provenance.gitOps.repository !== "ORESoftware/k8s-cluster") {
    throw new Error("gitOps.repository must identify ORESoftware/k8s-cluster");
  }

  if (!provenance.slack || typeof provenance.slack !== "object" || Array.isArray(provenance.slack)) {
    throw new TypeError("slack must be an object");
  }
  assertExactKeys(provenance.slack, ["appId", "workspaceId", "commands"], "slack");
  if (!/^A[A-Z0-9]{10}$/.test(provenance.slack.appId)) {
    throw new Error("slack.appId must be a Slack app identifier");
  }
  if (!/^T[A-Z0-9]{10}$/.test(provenance.slack.workspaceId)) {
    throw new Error("slack.workspaceId must be a Slack workspace identifier");
  }
  if (!Array.isArray(provenance.slack.commands)) {
    throw new TypeError("slack.commands must be an array");
  }

  const pinnedCommands = [...provenance.slack.commands].sort();
  const configuredCommands = commandDefinitions.map((entry) => entry.command).sort();
  if (new Set(pinnedCommands).size !== pinnedCommands.length) {
    throw new Error("slack.commands must not contain duplicates");
  }
  if (JSON.stringify(pinnedCommands) !== JSON.stringify(configuredCommands)) {
    throw new Error("slack.commands must exactly match config/commands.json");
  }

  return provenance;
}

export async function checkProvenance({ root = defaultRoot } = {}) {
  const [provenance, commandDefinitions] = await Promise.all([
    readFile(resolve(root, "provenance.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "config", "commands.json"), "utf8").then(JSON.parse)
  ]);
  return validateProvenance(provenance, commandDefinitions);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await checkProvenance();
  console.log("provenance.json is valid and matches the configured Slack commands");
}
