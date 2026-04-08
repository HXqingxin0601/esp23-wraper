import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import {
  type EspwrapCapabilities,
  type EspwrapCapabilityRequirements,
  getConfiguredBinaryPath,
  probeEspwrapCapabilities,
} from "./espwrapCli";

export type EspwrapBinarySource =
  | "configured"
  | "bundled"
  | "workspaceDebug"
  | "workspaceRelease"
  | "path";

export interface ResolvedEspwrapBinary {
  binaryPath: string;
  source: EspwrapBinarySource;
  capabilities: EspwrapCapabilities;
}

export interface BinaryProbeFailure {
  binaryPath: string;
  source: EspwrapBinarySource;
  detail: string;
}

export interface EspwrapEnvironmentStatus {
  resolved?: ResolvedEspwrapBinary;
  fullFeatureBinary?: ResolvedEspwrapBinary;
  failures: BinaryProbeFailure[];
  configuredPath: string;
}

interface BinaryCandidate {
  binaryPath: string;
  source: EspwrapBinarySource;
}

export async function resolveEspwrapBinary(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  requirements: EspwrapCapabilityRequirements = {}
): Promise<ResolvedEspwrapBinary> {
  const status = await inspectEspwrapEnvironment(context, output);
  const matched = status.fullFeatureBinary && supportsRequirements(status.fullFeatureBinary.capabilities, requirements)
    ? status.fullFeatureBinary
    : status.resolved && supportsRequirements(status.resolved.capabilities, requirements)
      ? status.resolved
      : undefined;

  if (matched) {
    return matched;
  }

  throw new Error(buildBinaryResolutionError(status, requirements));
}

export async function inspectEspwrapEnvironment(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<EspwrapEnvironmentStatus> {
  const configuredPath = getConfiguredBinaryPath().trim();
  const candidates = await collectCandidates(context, configuredPath);
  const failures: BinaryProbeFailure[] = [];
  const successes: ResolvedEspwrapBinary[] = [];

  output.appendLine(`[info] Inspecting espwrap CLI candidates (${candidates.length})`);

  for (const candidate of candidates) {
    try {
      const capabilities = await probeEspwrapCapabilities(candidate.binaryPath);
      output.appendLine(
        `[info] Usable espwrap CLI (${describeBinarySource(candidate.source)}): ${candidate.binaryPath}`
      );
      successes.push({
        binaryPath: candidate.binaryPath,
        source: candidate.source,
        capabilities,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      output.appendLine(
        `[warn] Failed ${describeBinarySource(candidate.source)} candidate ${candidate.binaryPath}: ${detail}`
      );
      failures.push({
        binaryPath: candidate.binaryPath,
        source: candidate.source,
        detail,
      });
    }
  }

  return {
    resolved: successes[0],
    fullFeatureBinary: successes.find((candidate) =>
      supportsRequirements(candidate.capabilities, { doctorJson: true, installMissing: true })
    ),
    failures,
    configuredPath,
  };
}

export function describeBinarySource(source: EspwrapBinarySource): string {
  switch (source) {
    case "configured":
      return "Configured Path";
    case "bundled":
      return "Bundled CLI";
    case "workspaceDebug":
      return "Workspace Debug Build";
    case "workspaceRelease":
      return "Workspace Release Build";
    case "path":
      return "PATH Command";
    default:
      return "Unknown";
  }
}

function supportsRequirements(
  capabilities: EspwrapCapabilities,
  requirements: EspwrapCapabilityRequirements
): boolean {
  if (requirements.doctorJson && !capabilities.supportsDoctorJson) {
    return false;
  }
  if (requirements.installMissing && !capabilities.supportsInstallMissing) {
    return false;
  }
  return true;
}

async function collectCandidates(
  context: vscode.ExtensionContext,
  configuredPath: string
): Promise<BinaryCandidate[]> {
  if (configuredPath) {
    return [
      {
        binaryPath: configuredPath,
        source: "configured",
      },
    ];
  }

  const candidates: BinaryCandidate[] = [];
  const binaryName = process.platform === "win32" ? "espwrap.exe" : "espwrap";
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  candidates.push({
    binaryPath: path.join(context.extensionUri.fsPath, "bin", binaryName),
    source: "bundled",
  });

  for (const folder of workspaceFolders) {
    candidates.push({
      binaryPath: path.join(folder.uri.fsPath, "target", "debug", binaryName),
      source: "workspaceDebug",
    });
    candidates.push({
      binaryPath: path.join(folder.uri.fsPath, "target", "release", binaryName),
      source: "workspaceRelease",
    });
    candidates.push({
      binaryPath: path.join(folder.uri.fsPath, "..", "target", "debug", binaryName),
      source: "workspaceDebug",
    });
    candidates.push({
      binaryPath: path.join(folder.uri.fsPath, "..", "target", "release", binaryName),
      source: "workspaceRelease",
    });
  }

  candidates.push({
    binaryPath: path.join(context.extensionUri.fsPath, "..", "target", "debug", binaryName),
    source: "workspaceDebug",
  });
  candidates.push({
    binaryPath: path.join(context.extensionUri.fsPath, "..", "target", "release", binaryName),
    source: "workspaceRelease",
  });
  candidates.push({
    binaryPath: "espwrap",
    source: "path",
  });

  return dedupeCandidates(await filterExistingCandidates(candidates));
}

async function filterExistingCandidates(candidates: readonly BinaryCandidate[]): Promise<BinaryCandidate[]> {
  const filtered: BinaryCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.source === "path" || candidate.source === "configured") {
      filtered.push(candidate);
      continue;
    }

    if (await fileExists(candidate.binaryPath)) {
      filtered.push(candidate);
    }
  }

  return filtered;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function dedupeCandidates(candidates: readonly BinaryCandidate[]): BinaryCandidate[] {
  const seen = new Set<string>();
  const unique: BinaryCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.source}:${candidate.binaryPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

function buildBinaryResolutionError(
  status: EspwrapEnvironmentStatus,
  requirements: EspwrapCapabilityRequirements
): string {
  const missingRequirements: string[] = [];
  if (requirements.doctorJson) {
    missingRequirements.push("`espwrap doctor --json`");
  }
  if (requirements.installMissing) {
    missingRequirements.push("`espwrap new --install-missing`");
  }

  if (status.resolved) {
    const version = status.resolved.capabilities.version ? `Detected ${status.resolved.capabilities.version}. ` : "";
    return `${version}The available espwrap CLI at \`${status.resolved.binaryPath}\` does not support ${missingRequirements.join(
      " and "
    )}. Build the latest espwrap or configure a newer binary in \`espwrap.binaryPath\`.`;
  }

  const tried = status.failures.length > 0
    ? ` Tried: ${status.failures.map((entry) => `\`${entry.binaryPath}\``).join(", ")}.`
    : "";
  return `Could not find a usable espwrap CLI.${tried} Build this repository or set \`espwrap.binaryPath\` manually.`;
}
