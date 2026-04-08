export interface PatchFormState {
  projectPath: string;
  chip: string;
  bin: string;
  dryRun: boolean;
  backup: boolean;
}

export interface PatchWorkspaceOption {
  label: string;
  path: string;
}

export function renderPatchDocument(args: {
  scriptUri: string;
  styleUri: string;
  nonce: string;
  cspSource: string;
  state: PatchFormState;
  workspaces: readonly PatchWorkspaceOption[];
}): string {
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
    <title>ESP Wrap: Patch Current Workspace</title>
  </head>
  <body>
    <div class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">Workspace Repair</p>
          <h1>Patch Current Workspace</h1>
          <p class="subtitle">Preview and apply espwrap patch against an existing ESP Rust project without jumping through multiple quick-picks.</p>
        </div>
        <div class="note">
          <strong>Tip</strong>
          <span>Use dry-run first when you want to inspect the exact command and the target workspace.</span>
        </div>
      </header>

      <main class="grid">
        <section class="card">
          <h2>Target</h2>
          <div class="field">
            <label for="projectPath">Workspace Folder</label>
            <p>Select which open workspace folder should receive the \`.vscode\` patch.</p>
            <select id="projectPath">
              ${args.workspaces.map((folder) => renderOption(folder.path, `${folder.label} (${folder.path})`, args.state.projectPath === folder.path)).join("")}
            </select>
          </div>
        </section>

        <section class="card">
          <h2>Overrides</h2>
          <div class="field">
            <label for="chip">Chip Override</label>
            <p>Leave blank to let espwrap auto-detect the chip from the project metadata.</p>
            <input id="chip" type="text" value="${escapeHtml(args.state.chip)}" />
          </div>
          <div class="field">
            <label for="bin">Binary Override</label>
            <p>Leave blank to let espwrap auto-detect the binary name.</p>
            <input id="bin" type="text" value="${escapeHtml(args.state.bin)}" />
          </div>
        </section>

        <section class="card">
          <h2>Patch Options</h2>
          <div class="option-grid">
            ${renderCheckbox("backup", "Create backups", "Write .bak files before overwriting project-local VS Code files.", args.state.backup)}
            ${renderCheckbox("dryRun", "Dry run", "Preview the patch without writing any files.", args.state.dryRun)}
          </div>
        </section>

        <section class="card preview-card">
          <h2>Preview</h2>
          <p>The preview below shows the exact espwrap patch command that will run.</p>
          <div id="errors" class="errors" hidden></div>
          <pre id="commandPreview"></pre>
          <div class="actions">
            <button type="button" id="copyCommand" class="secondary">Copy Command</button>
            <button type="button" id="submitButton" class="primary">Run Patch</button>
          </div>
        </section>
      </main>
    </div>

    <script id="espwrap-patch-data" type="application/json">${escapeHtml(JSON.stringify({
      initialState: args.state,
      workspaces: args.workspaces,
    }))}</script>
    <script nonce="${args.nonce}" src="${args.scriptUri}"></script>
  </body>
</html>`;
}

function renderOption(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function renderCheckbox(key: string, label: string, description: string, checked: boolean): string {
  return `<label class="toggle">
    <span class="toggle-top">
      <input data-toggle="${key}" type="checkbox" ${checked ? "checked" : ""} />
      <strong>${escapeHtml(label)}</strong>
    </span>
    <span class="toggle-description">${escapeHtml(description)}</span>
  </label>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
