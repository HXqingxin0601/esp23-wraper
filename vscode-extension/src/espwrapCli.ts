import { spawn } from "node:child_process";
import * as vscode from "vscode";

export interface EspwrapCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  required: boolean;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  summary: {
    failures: number;
    warnings: number;
    strict: boolean;
    ok: boolean;
  };
}

export interface EspwrapCapabilities {
  version: string;
  supportsDoctorJson: boolean;
  supportsInstallMissing: boolean;
}

export interface EspwrapCapabilityRequirements {
  doctorJson?: boolean;
  installMissing?: boolean;
}

export function getConfiguredBinaryPath(): string {
  return vscode.workspace.getConfiguration("espwrap").get<string>("binaryPath", "");
}

export async function runEspwrapCommand(
  binaryPath: string,
  args: readonly string[],
  output: vscode.OutputChannel,
  options: { cwd?: string; title: string }
): Promise<EspwrapCommandResult> {
  const commandLabel = formatShellCommand(binaryPath, args);
  output.show(true);
  output.appendLine(`$ ${commandLabel}`);

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.title,
    },
    async () =>
      new Promise<EspwrapCommandResult>((resolve, reject) => {
        const child = spawn(binaryPath, [...args], {
          cwd: options.cwd,
          env: process.env,
          windowsHide: true,
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk: Buffer | string) => {
          const text = chunk.toString();
          stdout += text;
          output.append(text);
        });

        child.stderr.on("data", (chunk: Buffer | string) => {
          const text = chunk.toString();
          stderr += text;
          output.append(text);
        });

        child.on("error", (error) => {
          reject(new Error(describeSpawnError(binaryPath, error)));
        });

        child.on("close", (code) => {
          resolve({
            code: code ?? -1,
            stdout,
            stderr,
          });
        });
      })
  );
}

export async function runDoctor(binaryPath: string, output: vscode.OutputChannel): Promise<DoctorReport> {
  await ensureEspwrapCapabilities(binaryPath, output, { doctorJson: true });
  const result = await runEspwrapCommand(binaryPath, ["doctor", "--json"], output, {
    title: "Running espwrap doctor",
  });

  if (result.code !== 0) {
    throw new Error(`espwrap doctor failed with exit code ${result.code}. See ESP Wrap output for details.`);
  }

  try {
    return JSON.parse(result.stdout) as DoctorReport;
  } catch (error) {
    throw new Error(
      `espwrap doctor returned unexpected output. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function ensureEspwrapCapabilities(
  binaryPath: string,
  output: vscode.OutputChannel,
  requirements: EspwrapCapabilityRequirements
): Promise<EspwrapCapabilities> {
  const capabilities = await probeEspwrapCapabilities(binaryPath, output);
  const missing: string[] = [];

  if (requirements.doctorJson && !capabilities.supportsDoctorJson) {
    missing.push("`espwrap doctor --json`");
  }
  if (requirements.installMissing && !capabilities.supportsInstallMissing) {
    missing.push("`espwrap new --install-missing`");
  }

  if (missing.length === 0) {
    return capabilities;
  }

  const versionDetail = capabilities.version ? `Detected ${capabilities.version}. ` : "";
  throw new Error(
    `The configured espwrap CLI does not support ${joinWithAnd(missing)}. ${versionDetail}Build the latest CLI from this repository and update the \`espwrap.binaryPath\` setting if needed.`
  );
}

export function formatShellCommand(binaryPath: string, args: readonly string[]): string {
  return [binaryPath, ...args].map(quoteShellArg).join(" ");
}

export async function probeEspwrapCapabilities(
  binaryPath: string,
  output?: vscode.OutputChannel
): Promise<EspwrapCapabilities> {
  if (output) {
    output.appendLine(`[info] Checking espwrap CLI capabilities for ${binaryPath}`);
  }

  const versionResult = await runEspwrapProbe(binaryPath, ["--version"]);
  if (versionResult.code !== 0) {
    throw new Error(formatProbeFailure(binaryPath, ["--version"], versionResult));
  }

  const doctorHelp = await runEspwrapProbe(binaryPath, ["doctor", "--help"]);
  const newHelp = await runEspwrapProbe(binaryPath, ["new", "--help"]);

  return {
    version: firstNonEmptyLine(versionResult.stdout, versionResult.stderr) ?? "",
    supportsDoctorJson: helpSupportsFlag(doctorHelp, "--json"),
    supportsInstallMissing: helpSupportsFlag(newHelp, "--install-missing"),
  };
}

function quoteShellArg(arg: string): string {
  if (!arg) {
    return "\"\"";
  }
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/(["\\])/g, "\\$1")}"`;
}

function runEspwrapProbe(binaryPath: string, args: readonly string[]): Promise<EspwrapCommandResult> {
  return new Promise<EspwrapCommandResult>((resolve, reject) => {
    const child = spawn(binaryPath, [...args], {
      env: process.env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new Error(describeSpawnError(binaryPath, error)));
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
      });
    });
  });
}

function helpSupportsFlag(result: EspwrapCommandResult, flag: string): boolean {
  if (result.code !== 0) {
    return false;
  }
  return `${result.stdout}\n${result.stderr}`.includes(flag);
}

function formatProbeFailure(binaryPath: string, args: readonly string[], result: EspwrapCommandResult): string {
  const detail = firstNonEmptyLine(result.stderr, result.stdout) ?? `exit code ${result.code}`;
  return `Could not inspect \`${binaryPath}\` with \`${formatShellCommand(binaryPath, args)}\`: ${detail}`;
}

function firstNonEmptyLine(...chunks: readonly string[]): string | undefined {
  for (const chunk of chunks) {
    const line = chunk
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0);
    if (line) {
      return line;
    }
  }
  return undefined;
}

function joinWithAnd(values: readonly string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function describeSpawnError(binaryPath: string, error: unknown): string {
  if (isNodeError(error) && error.code === "ENOENT") {
    return `Could not find \`${binaryPath}\`. Install espwrap or update the \`espwrap.binaryPath\` setting.`;
  }
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
