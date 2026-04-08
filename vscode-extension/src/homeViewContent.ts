export interface CachedDoctorSummary {
  timestamp: string;
  failures: number;
  warnings: number;
  ok: boolean;
}

export interface HomeResolvedBinaryInfo {
  sourceLabel: string;
  version: string;
  binaryPath: string;
  supportsDoctorJson: boolean;
  supportsInstallMissing: boolean;
}

export interface HomeFailureEntry {
  sourceLabel: string;
  binaryPath: string;
  detail: string;
}

export interface HomeViewRenderInput {
  workspaceFolder: string;
  configuredPath: string;
  resolvedBinary?: HomeResolvedBinaryInfo;
  hasFullFeatureBinary: boolean;
  failures: HomeFailureEntry[];
  lastDoctor?: CachedDoctorSummary;
}

interface HomeBadge {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
}

interface HomeViewModel {
  statusTone: "good" | "warn" | "bad";
  statusMessage: string;
  badges: HomeBadge[];
  lastDoctorText: string;
  lastDoctorSummary: string;
}

export function renderHomeDocument(args: {
  scriptUri: string;
  styleUri: string;
  nonce: string;
  cspSource: string;
  input: HomeViewRenderInput;
}): string {
  const model = buildHomeViewModel(args.input);
  const resolved = args.input.resolvedBinary;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'nonce-${args.nonce}'; style-src ${args.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${args.styleUri}" />
    <title>ESP Wrap</title>
  </head>
  <body>
    <div class="page">
      <header class="hero">
        <p class="eyebrow">Rust On ESP</p>
        <h1>ESP Wrap</h1>
        <p class="subtitle">Create, patch, and diagnose ESP Rust workspaces without leaving VS Code.</p>
      </header>

      <section class="card primary-card">
        <div class="section-heading">
          <p class="section-kicker">Start Here</p>
          <h2>New Rust Project</h2>
          <p class="section-copy">Open the guided project form with chip, template, and feature selections.</p>
        </div>
        ${renderActionButton("espwrap.newProject", "Create New Rust Project", "Generate a fresh ESP Rust workspace with the recommended guided flow.", "action-card-primary")}
      </section>

      ${renderFoldoutCard({
        title: "Other Actions",
        description: "Patch an existing workspace or run diagnostics when you need them.",
        body: `<div class="action-list">
          ${renderActionButton("espwrap.patchCurrentWorkspace", "Patch Current Workspace", "Open the patch form for the current workspace and preview the exact CLI call first.")}
          ${renderActionButton("espwrap.doctor", "Run Doctor", "Check espwrap, esp-generate, probe-rs, and related tools, then show the structured report.")}
        </div>`,
      })}

      ${renderFoldoutCard({
        title: "Current Setup",
        description: args.input.workspaceFolder,
        body: `<div class="meta">
          <span class="meta-label">Workspace</span>
          <code>${escapeHtml(args.input.workspaceFolder)}</code>
        </div>
        <div class="meta">
          <span class="meta-label">Configured Path</span>
          <code>${escapeHtml(args.input.configuredPath || "Auto-detect")}</code>
        </div>`,
      })}

      ${renderFoldoutCard({
        title: "Last Doctor",
        description: model.lastDoctorSummary,
        body: `<div class="tips"><p>${escapeHtml(model.lastDoctorText)}</p></div>`,
        tone: args.input.lastDoctor
          ? args.input.lastDoctor.ok
            ? "good"
            : args.input.lastDoctor.failures > 0
              ? "bad"
              : "warn"
          : "neutral",
      })}

      ${renderFoldoutCard({
        title: "CLI Status",
        description: buildStatusSummary(args.input),
        body: `<p>${escapeHtml(model.statusMessage)}</p>
        <div class="badge-grid">
          ${model.badges.map(renderBadge).join("")}
        </div>
        <div class="meta">
          <span class="meta-label">Path</span>
          <code>${escapeHtml((resolved?.binaryPath ?? args.input.configuredPath) || "Not configured")}</code>
        </div>
        <div class="meta">
          <span class="meta-label">Version</span>
          <code>${escapeHtml(resolved?.version ?? "Unavailable")}</code>
        </div>
        <div class="button-row">
          <button class="secondary" type="button" data-action="openSettings">Configure CLI Path</button>
          <button class="ghost" type="button" data-action="refreshHome">Refresh Status</button>
        </div>
        `,
        tone: model.statusTone,
      })}

      ${args.input.failures.length > 0 ? renderFoldoutCard({
        title: "Tried Candidates",
        description: `${args.input.failures.length} candidate(s) failed detection`,
        body: `
        <div class="failure-list">
          ${args.input.failures.map((entry) => `<div class="failure-item">
            <strong>${escapeHtml(entry.sourceLabel)}</strong>
            <code>${escapeHtml(entry.binaryPath)}</code>
            <span>${escapeHtml(entry.detail)}</span>
          </div>`).join("")}
        </div>
        `,
        tone: "warn",
      }) : ""}
    </div>
    <script nonce="${args.nonce}" src="${args.scriptUri}"></script>
  </body>
</html>`;
}

export function formatDoctorSummary(summary: CachedDoctorSummary): string {
  const stamp = new Date(summary.timestamp).toLocaleString();
  const state = summary.ok ? "healthy" : "needs attention";
  return `${stamp}: ${summary.failures} failure(s), ${summary.warnings} warning(s). Environment ${state}.`;
}

function buildHomeViewModel(input: HomeViewRenderInput): HomeViewModel {
  const resolved = input.resolvedBinary;
  const statusTone = input.hasFullFeatureBinary ? "good" : resolved ? "warn" : "bad";
  const statusMessage = input.hasFullFeatureBinary
    ? "Full-featured CLI detected. New Project, Patch, and Doctor should all work."
    : resolved
      ? "A usable CLI was found, but some newer extension features are still missing."
      : "No usable espwrap CLI was detected yet.";

  const badges: HomeBadge[] = [
    {
      label: "Readiness",
      value: input.hasFullFeatureBinary ? "Ready" : resolved ? "Partial" : "Missing",
      tone: statusTone,
    },
    {
      label: "Source",
      value: resolved?.sourceLabel ?? "Not found",
      tone: resolved ? "neutral" : "bad",
    },
    {
      label: "Mode",
      value: input.configuredPath ? "Pinned Path" : "Auto-detect",
      tone: "neutral",
    },
  ];

  if (resolved) {
    badges.push(
      {
        label: "doctor --json",
        value: resolved.supportsDoctorJson ? "Supported" : "Missing",
        tone: resolved.supportsDoctorJson ? "good" : "warn",
      },
      {
        label: "--install-missing",
        value: resolved.supportsInstallMissing ? "Supported" : "Missing",
        tone: resolved.supportsInstallMissing ? "good" : "warn",
      }
    );
  }

  if (input.lastDoctor) {
    badges.push({
      label: "Last Doctor",
      value: input.lastDoctor.ok ? "Healthy" : "Needs Attention",
      tone: input.lastDoctor.ok ? "good" : input.lastDoctor.failures > 0 ? "bad" : "warn",
    });
  }

  return {
    statusTone,
    statusMessage,
    badges,
    lastDoctorText: input.lastDoctor
      ? formatDoctorSummary(input.lastDoctor)
      : "No doctor run has been recorded in this workspace yet.",
    lastDoctorSummary: input.lastDoctor
      ? input.lastDoctor.ok
        ? `${input.lastDoctor.failures} failure(s), ${input.lastDoctor.warnings} warning(s)`
        : `${input.lastDoctor.failures} failure(s), ${input.lastDoctor.warnings} warning(s)`
      : "No doctor run recorded yet.",
  };
}

function renderActionButton(command: string, title: string, description: string, className = ""): string {
  const classes = ["action-card", className].filter(Boolean).join(" ");
  return `<button class="${classes}" type="button" data-command="${escapeHtml(command)}">
    <span class="action-title">${escapeHtml(title)}</span>
    <span class="action-description">${escapeHtml(description)}</span>
  </button>`;
}

function renderFoldoutCard(args: {
  title: string;
  description: string;
  body: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}): string {
  const tone = args.tone ? ` foldout-${args.tone}` : "";
  return `<details class="card foldout${tone}">
    <summary>
      <div class="foldout-heading">
        <span class="foldout-title">${escapeHtml(args.title)}</span>
        <span class="foldout-description">${escapeHtml(args.description)}</span>
      </div>
      <span class="foldout-chevron" aria-hidden="true"></span>
    </summary>
    <div class="foldout-body">${args.body}</div>
  </details>`;
}

function renderBadge(badge: HomeBadge): string {
  return `<div class="badge badge-${badge.tone}">
    <span class="badge-label">${escapeHtml(badge.label)}</span>
    <strong class="badge-value">${escapeHtml(badge.value)}</strong>
  </div>`;
}

function buildStatusSummary(input: HomeViewRenderInput): string {
  const resolved = input.resolvedBinary;
  const readiness = input.hasFullFeatureBinary ? "Ready" : resolved ? "Partial" : "Missing";
  const source = resolved?.sourceLabel ?? "No CLI detected";
  return `${readiness} - ${source}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
