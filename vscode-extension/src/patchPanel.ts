import * as vscode from "vscode";

import { resolveEspwrapBinary } from "./espwrapBinary";
import { buildPatchCommand, parseOpenOcdConfigs } from "./formModel";
import { renderPatchDocument, type PatchFormState } from "./patchPanelContent";
import { runEspwrapCommand } from "./espwrapCli";

export async function openPatchPanel(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage("Open an ESP Rust workspace before running ESP Wrap patch.");
    return;
  }

  const binary = await resolveEspwrapBinary(context, output);
  const initialState: PatchFormState = {
    projectPath: folders[0].uri.fsPath,
    chip: "",
    bin: "",
    debugBackend: "probe-rs",
    openocdConfigs: "",
    dryRun: false,
    backup: true,
  };

  const panel = vscode.window.createWebviewPanel(
    "espwrap.patchWorkspace",
    "ESP Wrap: Patch Current Workspace",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    }
  );

  let isSubmitting = false;
  let isDisposed = false;
  panel.webview.html = getHtml(panel.webview, context.extensionUri, initialState, folders);
  panel.onDidDispose(() => {
    isDisposed = true;
  });

  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    try {
      if (!isRecord(message) || typeof message.type !== "string" || !("state" in message)) {
        return;
      }

      const state = normalizeState(message.state);
      if (!state) {
        return;
      }

      if (message.type === "requestPreview") {
        await postPreview(panel.webview, binary.binaryPath, state);
        return;
      }

      if (message.type === "submit") {
        if (isSubmitting) {
          return;
        }
        isSubmitting = true;
        await postSubmitState(panel, true);
        try {
          await patchWorkspace(binary.binaryPath, output, state);
          if (!isDisposed) {
            panel.dispose();
          }
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

async function postPreview(webview: vscode.Webview, binaryPath: string, state: PatchFormState): Promise<void> {
  const errors = validatePatchState(state);
  const preview = errors.length === 0
    ? buildPatchCommand(binaryPath, {
      projectPath: state.projectPath,
      chip: state.chip,
      bin: state.bin,
      debugBackend: state.debugBackend,
      openocdConfigs: parseOpenOcdConfigs(state.openocdConfigs),
      dryRun: state.dryRun,
      backup: state.backup,
    }).preview
    : "";

  await webview.postMessage({
    type: "preview",
    preview,
    errors,
  });
}

async function patchWorkspace(binaryPath: string, output: vscode.OutputChannel, state: PatchFormState): Promise<void> {
  const errors = validatePatchState(state);
  if (errors.length > 0) {
    void vscode.window.showErrorMessage(errors[0]);
    return;
  }

  const built = buildPatchCommand(binaryPath, {
    projectPath: state.projectPath,
    chip: state.chip,
    bin: state.bin,
    debugBackend: state.debugBackend,
    openocdConfigs: parseOpenOcdConfigs(state.openocdConfigs),
    dryRun: state.dryRun,
    backup: state.backup,
  });
  const result = await runEspwrapCommand(binaryPath, built.args, output, {
    cwd: state.projectPath,
    title: "Patching current workspace with espwrap",
  });

  if (result.code !== 0) {
    throw new Error(`espwrap patch failed with exit code ${result.code}. Check the ESP Wrap output panel for details.`);
  }

  void vscode.window.showInformationMessage(
    state.dryRun
      ? `espwrap patch dry-run completed for ${state.projectPath}.`
      : `espwrap patch completed for ${state.projectPath}.`
  );
}

async function postSubmitState(panel: vscode.WebviewPanel, busy: boolean): Promise<void> {
  try {
    await panel.webview.postMessage({ type: "submitState", busy });
  } catch {
    // Panel may have closed already.
  }
}

function getHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  state: PatchFormState,
  folders: readonly vscode.WorkspaceFolder[]
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "patchProject.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "newProject.css"));
  return renderPatchDocument({
    scriptUri: scriptUri.toString(),
    styleUri: styleUri.toString(),
    nonce: String(Date.now()),
    cspSource: webview.cspSource,
    state,
    workspaces: folders.map((folder) => ({
      label: folder.name,
      path: folder.uri.fsPath,
    })),
  });
}

function validatePatchState(state: PatchFormState): string[] {
  const errors: string[] = [];
  if (!state.projectPath.trim()) {
    errors.push("Workspace folder is required.");
  }
  return errors;
}

function normalizeState(value: unknown): PatchFormState | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    projectPath: stringValue(value.projectPath),
    chip: stringValue(value.chip),
    bin: stringValue(value.bin),
    debugBackend:
      value.debugBackend === "openocd" || value.debugBackend === "none" ? value.debugBackend : "probe-rs",
    openocdConfigs: stringValue(value.openocdConfigs),
    dryRun: booleanValue(value.dryRun),
    backup: booleanValue(value.backup),
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
