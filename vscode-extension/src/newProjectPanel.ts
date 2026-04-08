import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { resolveEspwrapBinary } from "./espwrapBinary";
import { ensureEspwrapCapabilities, runEspwrapCommand } from "./espwrapCli";
import {
  BLE_OPTIONS,
  CHIP_OPTIONS,
  PRESET_DEFINITIONS,
  TOGGLE_FIELDS,
  applyPreset,
  buildNewProjectCommand,
  createDefaultState,
  resolveOutputPath,
  type BleMode,
  type BuildCommandOptions,
  type EspChip,
  type NewProjectFormState,
  type ProjectPreset,
  validateNewProjectState,
} from "./formModel";

export async function openNewProjectPanel(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "espwrap.newProject",
    "ESP Wrap: New Rust Project",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    }
  );

  const config = vscode.workspace.getConfiguration("espwrap");
  const defaultChip = config.get<EspChip>("defaultChip", "esp32c3");
  const defaultInstallMissing = config.get<boolean>("defaultInstallMissingTools", false);
  const outputPath = suggestOutputPath();
  const initialState = createDefaultState(defaultChip, defaultInstallMissing, outputPath);
  const hydratedState = applyPreset(initialState, initialState.preset);
  const buildOptions = getBuildCommandOptions();
  const previewBinary = await resolveEspwrapBinary(context, output);
  let isSubmitting = false;
  let isDisposed = false;

  panel.webview.html = getHtml(panel.webview, context.extensionUri, hydratedState);
  panel.onDidDispose(() => {
    isDisposed = true;
  });

  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    try {
      if (!isRecord(message) || typeof message.type !== "string") {
        return;
      }

      if (message.type === "pickOutputPath") {
        const defaultPath = resolveOutputPath(stringValue(message.currentValue) || outputPath, buildOptions);
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          defaultUri: vscode.Uri.file(defaultPath),
          openLabel: "Use Output Folder",
        });
        const selected = picked?.[0]?.fsPath;
        if (selected) {
          await panel.webview.postMessage({ type: "pickedOutputPath", value: selected });
        }
        return;
      }

      if (!("state" in message)) {
        return;
      }

      const state = normalizeState(message.state);
      if (!state) {
        return;
      }

      if (message.type === "requestPreview") {
        await postPreview(panel.webview, state, buildOptions, previewBinary.binaryPath);
        return;
      }

      if (message.type === "submit") {
        if (isSubmitting) {
          return;
        }

        isSubmitting = true;
        await postSubmitState(panel, true);
        try {
          await createProjectFromState(context, state, output, panel, buildOptions);
        } finally {
          isSubmitting = false;
          if (!isDisposed) {
            await postSubmitState(panel, false);
          }
        }
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      output.show(true);
      output.appendLine(`[error] ${text}`);
      void vscode.window.showErrorMessage(text, "Show Output").then((selection) => {
        if (selection === "Show Output") {
          output.show(true);
        }
      });
    }
  });
}

async function postPreview(
  webview: vscode.Webview,
  state: NewProjectFormState,
  buildOptions: BuildCommandOptions,
  binaryPath: string
): Promise<void> {
  const errors = validateNewProjectState(state);
  const preview = errors.length === 0 ? buildNewProjectCommand(binaryPath, state, buildOptions).preview : "";
  await webview.postMessage({
    type: "preview",
    preview,
    errors,
  });
}

async function createProjectFromState(
  context: vscode.ExtensionContext,
  state: NewProjectFormState,
  output: vscode.OutputChannel,
  panel: vscode.WebviewPanel,
  buildOptions: BuildCommandOptions
): Promise<void> {
  const errors = validateNewProjectState(state);
  if (errors.length > 0) {
    await panel.webview.postMessage({ type: "preview", preview: "", errors });
    void vscode.window.showErrorMessage(errors[0]);
    return;
  }

  const binaryPath = (await resolveEspwrapBinary(context, output, {
    installMissing: state.installMissing,
  })).binaryPath;
  await ensureEspwrapCapabilities(binaryPath, output, {
    installMissing: state.installMissing,
  });
  const built = buildNewProjectCommand(binaryPath, state, buildOptions);
  const result = await runEspwrapCommand(binaryPath, built.args, output, {
    cwd: buildOptions.resolveOutputPathAgainst,
    title: "Creating ESP Rust project",
  });

  if (result.code !== 0) {
    throw new Error(`espwrap exited with code ${result.code}. Check the ESP Wrap output panel for details.`);
  }

  const projectUri = vscode.Uri.file(built.projectDir);
  try {
    await fs.access(projectUri.fsPath);
  } catch {
    void vscode.window.showWarningMessage(
      `Project generation completed, but ${projectUri.fsPath} could not be found automatically.`
    );
    return;
  }

  panel.dispose();
  await handleGeneratedProject(projectUri);
}

async function handleGeneratedProject(projectUri: vscode.Uri): Promise<void> {
  const behavior = vscode.workspace
    .getConfiguration("espwrap")
    .get<"ask" | "openNewWindow" | "addToWorkspace" | "doNothing">("defaultOpenBehavior", "ask");

  if (behavior === "openNewWindow") {
    await vscode.commands.executeCommand("vscode.openFolder", projectUri, true);
    return;
  }

  if (behavior === "addToWorkspace") {
    addFolderToWorkspace(projectUri);
    return;
  }

  if (behavior === "doNothing") {
    void vscode.window.showInformationMessage(`ESP Rust project created at ${projectUri.fsPath}`);
    return;
  }

  const selection = await vscode.window.showInformationMessage(
    `ESP Rust project created at ${projectUri.fsPath}`,
    "Open in New Window",
    "Add to Workspace"
  );

  if (selection === "Open in New Window") {
    await vscode.commands.executeCommand("vscode.openFolder", projectUri, true);
  } else if (selection === "Add to Workspace") {
    addFolderToWorkspace(projectUri);
  }
}

async function postSubmitState(panel: vscode.WebviewPanel, busy: boolean): Promise<void> {
  try {
    await panel.webview.postMessage({ type: "submitState", busy });
  } catch {
    // The panel may have been disposed after a successful project creation.
  }
}

function addFolderToWorkspace(projectUri: vscode.Uri): void {
  const current = vscode.workspace.workspaceFolders ?? [];
  const index = current.length;
  const success = vscode.workspace.updateWorkspaceFolders(index, 0, {
    uri: projectUri,
    name: path.basename(projectUri.fsPath),
  });
  if (!success) {
    void vscode.window.showWarningMessage(
      `Failed to add ${projectUri.fsPath} to the current workspace.`
    );
  }
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri, state: NewProjectFormState): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "newProject.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "newProject.css"));
  const nonce = String(Date.now());
  const payload = {
    initialState: state,
    metadata: {
      chips: CHIP_OPTIONS,
      presets: PRESET_DEFINITIONS,
      toggles: TOGGLE_FIELDS,
      bleOptions: BLE_OPTIONS,
      presetStates: Object.fromEntries(
        PRESET_DEFINITIONS.map((preset) => [preset.id, applyPreset(state, preset.id)])
      ),
    },
  };

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>ESP Wrap: New Rust Project</title>
  </head>
  <body>
    <div class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">Rust On ESP</p>
          <h1>New Project</h1>
          <p class="subtitle">
            Generate an ESP Rust starter with the common options surfaced up front and the advanced knobs tucked away.
          </p>
        </div>
        <div class="note">
          <strong>Tip</strong>
          <span>The final command is previewed live below, so advanced users can still see exactly what will run.</span>
        </div>
      </header>

      <main class="grid">
        <section class="card">
          <h2>Basics</h2>
          <div class="field">
            <label for="name">Project Name</label>
            <p>Create a new directory with this name inside the selected output folder.</p>
            <input id="name" type="text" value="${escapeHtml(state.name)}" />
          </div>
          <div class="field">
            <label for="outputPath">Output Directory</label>
            <p>Choose the parent folder where esp-generate should create the project. Relative paths are resolved from the current workspace folder, or your home directory if no workspace is open.</p>
            <div class="path-row">
              <input id="outputPath" type="text" value="${escapeHtml(state.outputPath)}" />
              <button type="button" id="pickOutputPath" class="secondary">Browse...</button>
            </div>
          </div>
          <div class="split">
            <div class="field">
              <label for="chip">Chip</label>
              <p>Pick the target chip so the template can use the right architecture and defaults.</p>
              <select id="chip">
                ${CHIP_OPTIONS.map((chip) => renderOption(chip, chip, state.chip === chip)).join("")}
              </select>
            </div>
            <div class="field">
              <label for="preset">Preset</label>
              <p>Apply a sensible starting point, then tweak individual options if needed.</p>
              <select id="preset">
                ${PRESET_DEFINITIONS.map((preset) => renderOption(preset.id, preset.label, state.preset === preset.id)).join("")}
              </select>
            </div>
          </div>
          <div id="presetDescription" class="preset-description"></div>
        </section>

        <section class="card">
          <h2>Common Options</h2>
          <div class="option-grid">
            ${TOGGLE_FIELDS.filter((field) => !field.advanced).map((field) => renderCheckbox(field, state)).join("")}
          </div>
          <div class="field">
            <label for="bleMode">BLE Stack</label>
            <p>Choose a BLE template only if you actually plan to use Bluetooth in this project.</p>
            <select id="bleMode">
              ${renderOption("none", "No BLE", state.bleMode === "none")}
              ${renderOption("bleps", "ble-bleps", state.bleMode === "bleps")}
              ${renderOption("trouble", "ble-trouble", state.bleMode === "trouble")}
            </select>
          </div>
        </section>

        <section class="card">
          <details>
            <summary>Advanced</summary>
            <div class="advanced">
              <div class="option-grid">
                ${TOGGLE_FIELDS.filter((field) => field.advanced).map((field) => renderCheckbox(field, state)).join("")}
              </div>
              <div class="field">
                <label for="espGenerateBin">esp-generate Binary</label>
                <p>Override the esp-generate executable if you want to use a custom path or wrapper script.</p>
                <input id="espGenerateBin" type="text" value="${escapeHtml(state.espGenerateBin)}" />
              </div>
              <div class="field">
                <label for="extraEspwrapArgs">Extra espwrap Args</label>
                <p>Append uncommon espwrap flags before <code>--</code>. Flags already modeled above, such as <code>--name</code>, are blocked to prevent conflicts.</p>
                <input id="extraEspwrapArgs" type="text" value="${escapeHtml(state.extraEspwrapArgs)}" />
              </div>
              <div class="field">
                <label for="extraGenerateArgs">Extra esp-generate Args</label>
                <p>Append raw esp-generate flags after <code>--</code> when the built-in form is not enough. Form-managed flags like <code>--chip</code> and <code>--output-path</code> stay locked to the controls above.</p>
                <textarea id="extraGenerateArgs" rows="3">${escapeHtml(state.extraGenerateArgs)}</textarea>
              </div>
            </div>
          </details>
        </section>

        <section class="card preview-card">
          <h2>Preview</h2>
          <p>The preview below is built from your current selections and runs through the espwrap CLI.</p>
          <div id="errors" class="errors" hidden></div>
          <pre id="commandPreview"></pre>
          <div class="actions">
            <button type="button" id="copyCommand" class="secondary">Copy Command</button>
            <button type="button" id="submitButton" class="primary">Generate Project</button>
          </div>
        </section>
      </main>
    </div>

    <script id="espwrap-data" type="application/json">${escapeHtml(JSON.stringify(payload))}</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function renderCheckbox(field: { key: string; label: string; description: string }, state: NewProjectFormState): string {
  const checked = Boolean(state[field.key as keyof NewProjectFormState]);
  return `<label class="toggle">
    <span class="toggle-top">
      <input data-toggle="${field.key}" type="checkbox" ${checked ? "checked" : ""} />
      <strong>${escapeHtml(field.label)}</strong>
    </span>
    <span class="toggle-description">${escapeHtml(field.description)}</span>
  </label>`;
}

function renderOption(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function suggestOutputPath(): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceFolder) {
    return path.dirname(workspaceFolder);
  }
  return os.homedir();
}

function getBuildCommandOptions(): BuildCommandOptions {
  return {
    resolveOutputPathAgainst: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
  };
}

function normalizeState(value: unknown): NewProjectFormState | null {
  if (!isRecord(value)) {
    return null;
  }

  const chip = typeof value.chip === "string" && CHIP_OPTIONS.includes(value.chip as EspChip)
    ? (value.chip as EspChip)
    : "esp32c3";
  const preset = typeof value.preset === "string" && PRESET_DEFINITIONS.some((item) => item.id === value.preset)
    ? (value.preset as ProjectPreset)
    : "recommended";
  const bleMode = typeof value.bleMode === "string" && BLE_OPTIONS.includes(value.bleMode as BleMode)
    ? (value.bleMode as BleMode)
    : "none";

  return {
    name: stringValue(value.name),
    outputPath: stringValue(value.outputPath),
    chip,
    preset,
    probeRs: booleanValue(value.probeRs),
    embassy: booleanValue(value.embassy),
    alloc: booleanValue(value.alloc),
    wifi: booleanValue(value.wifi),
    bleMode,
    defmt: booleanValue(value.defmt),
    log: booleanValue(value.log),
    espBacktrace: booleanValue(value.espBacktrace),
    unstableHal: booleanValue(value.unstableHal),
    panicRttTarget: booleanValue(value.panicRttTarget),
    embeddedTest: booleanValue(value.embeddedTest),
    wokwi: booleanValue(value.wokwi),
    ci: booleanValue(value.ci),
    installMissing: booleanValue(value.installMissing),
    espGenerateBin: stringValue(value.espGenerateBin) || "esp-generate",
    extraEspwrapArgs: stringValue(value.extraEspwrapArgs),
    extraGenerateArgs: stringValue(value.extraGenerateArgs),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
