import * as vscode from "vscode";

import { describeBinarySource, inspectEspwrapEnvironment } from "./espwrapBinary";
import {
  type CachedDoctorSummary,
  type HomeViewRenderInput,
  renderHomeDocument,
} from "./homeViewContent";

export const LAST_DOCTOR_SUMMARY_KEY = "espwrap.lastDoctorSummary";

export class EspwrapHomeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "espwrap.home";

  private view: vscode.WebviewView | undefined;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webviewView.webview.html = this.renderLoading(webviewView.webview);
    void this.refresh();

    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isRecord(message) || typeof message.type !== "string") {
        return;
      }

      if (message.type === "runCommand" && typeof message.command === "string") {
        await vscode.commands.executeCommand(message.command);
        return;
      }

      if (message.type === "openSettings") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "espwrap.binaryPath");
        return;
      }

      if (message.type === "refreshHome") {
        await this.refresh();
      }
    });
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      const environment = await inspectEspwrapEnvironment(this.context, this.output);
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "No workspace open";
      const lastDoctor = this.context.workspaceState.get<CachedDoctorSummary | undefined>(LAST_DOCTOR_SUMMARY_KEY);
      const preferredBinary = environment.fullFeatureBinary ?? environment.resolved;
      this.view.webview.html = this.renderDocument(this.view.webview, {
        workspaceFolder,
        configuredPath: environment.configuredPath,
        resolvedBinary: preferredBinary
          ? {
            sourceLabel: describeBinarySource(preferredBinary.source),
            version: preferredBinary.capabilities.version || "Unavailable",
            binaryPath: preferredBinary.binaryPath,
            supportsDoctorJson: preferredBinary.capabilities.supportsDoctorJson,
            supportsInstallMissing: preferredBinary.capabilities.supportsInstallMissing,
          }
          : undefined,
        hasFullFeatureBinary: Boolean(environment.fullFeatureBinary),
        failures: environment.failures.map((entry) => ({
          sourceLabel: describeBinarySource(entry.source),
          binaryPath: entry.binaryPath,
          detail: entry.detail,
        })),
        lastDoctor,
      });
    } catch (error) {
      this.view.webview.html = this.renderDocument(this.view.webview, {
        workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "No workspace open",
        configuredPath: "",
        hasFullFeatureBinary: false,
        failures: [
          {
            sourceLabel: "PATH Command",
            binaryPath: "espwrap",
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  }

  private renderLoading(webview: vscode.Webview): string {
    return this.renderDocument(webview, {
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "No workspace open",
      configuredPath: "",
      hasFullFeatureBinary: false,
      failures: [],
    });
  }

  private renderDocument(webview: vscode.Webview, input: HomeViewRenderInput): string {
    return renderHomeDocument({
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "homeView.js")).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "homeView.css")).toString(),
      nonce: String(Date.now()),
      cspSource: webview.cspSource,
      input,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
