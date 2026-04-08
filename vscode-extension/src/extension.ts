import * as vscode from "vscode";

import { showDoctorPanel } from "./doctorPanel";
import { resolveEspwrapBinary } from "./espwrapBinary";
import { runDoctor } from "./espwrapCli";
import { EspwrapHomeViewProvider, LAST_DOCTOR_SUMMARY_KEY } from "./homeView";
import { openNewProjectPanel } from "./newProjectPanel";
import { openPatchPanel } from "./patchPanel";

let outputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("ESP Wrap");
  context.subscriptions.push(outputChannel);

  const homeViewProvider = new EspwrapHomeViewProvider(context, outputChannel);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(EspwrapHomeViewProvider.viewType, homeViewProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("espwrap.binaryPath")) {
        homeViewProvider.refresh();
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("espwrap.openHome", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.espwrap");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("espwrap.newProject", async () => {
      try {
        await openNewProjectPanel(context, outputChannel!);
        await homeViewProvider.refresh();
      } catch (error) {
        await reportError(error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("espwrap.patchCurrentWorkspace", async () => {
      try {
        await openPatchPanel(context, outputChannel!);
        await homeViewProvider.refresh();
      } catch (error) {
        await reportError(error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("espwrap.doctor", async () => {
      try {
        const binary = await resolveEspwrapBinary(context, outputChannel!, { doctorJson: true });
        const report = await runDoctor(binary.binaryPath, outputChannel!);
        await context.workspaceState.update(LAST_DOCTOR_SUMMARY_KEY, {
          timestamp: new Date().toISOString(),
          failures: report.summary.failures,
          warnings: report.summary.warnings,
          ok: report.summary.ok,
        });
        showDoctorPanel(context, report);
        await homeViewProvider.refresh();
      } catch (error) {
        await reportError(error);
      }
    })
  );
}

export function deactivate(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}

async function reportError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  outputChannel?.show(true);
  outputChannel?.appendLine(`[error] ${message}`);
  await vscode.window.showErrorMessage(message, "Show Output").then((selection) => {
    if (selection === "Show Output") {
      outputChannel?.show(true);
    }
  });
}
