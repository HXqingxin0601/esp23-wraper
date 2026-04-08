import * as vscode from "vscode";

import type { DoctorReport } from "./espwrapCli";

export function showDoctorPanel(context: vscode.ExtensionContext, report: DoctorReport): void {
  const panel = vscode.window.createWebviewPanel(
    "espwrap.doctor",
    "ESP Wrap: Doctor",
    vscode.ViewColumn.Active,
    {
      enableScripts: false,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    }
  );

  const styleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "newProject.css"));
  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${panel.webview.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>ESP Wrap Doctor</title>
  </head>
  <body>
    <div class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">Diagnostics</p>
          <h1>Doctor Report</h1>
          <p class="subtitle">Structured environment checks from <code>espwrap doctor --json</code>.</p>
        </div>
        <div class="note">
          <strong>Summary</strong>
          <span>${report.summary.failures} failure(s), ${report.summary.warnings} warning(s)</span>
        </div>
      </header>
      <main class="grid doctor-grid">
        ${report.checks.map(renderCheck).join("")}
      </main>
    </div>
  </body>
</html>`;
}

function renderCheck(check: DoctorReport["checks"][number]): string {
  return `<section class="card doctor-card">
    <div class="doctor-status doctor-status-${check.status}">${check.status.toUpperCase()}</div>
    <h2>${escapeHtml(check.name)}</h2>
    <p>${escapeHtml(check.detail)}</p>
    <small>${check.required ? "Required for core flows" : "Helpful, but not strictly required"}</small>
  </section>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
