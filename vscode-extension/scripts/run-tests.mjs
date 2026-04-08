import assert from "node:assert/strict";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, "..");
const formModel = await import(pathToFileURL(path.join(extensionDir, "dist", "formModel.js")).href);
const homeViewContent = await import(pathToFileURL(path.join(extensionDir, "dist", "homeViewContent.js")).href);
const patchPanelContent = await import(pathToFileURL(path.join(extensionDir, "dist", "patchPanelContent.js")).href);

run("applies the embassy preset", () => {
  const state = formModel.createDefaultState("esp32c3", false, "D:/work");
  const next = formModel.applyPreset(state, "embassy");

  assert.equal(next.embassy, true);
  assert.equal(next.probeRs, true);
  assert.equal(next.log, true);
  assert.equal(next.espBacktrace, true);
});

run("builds a new project command with selected options", () => {
  const state = {
    ...formModel.createDefaultState("esp32s3", true, "D:/esp"),
    name: "demo",
    embassy: true,
    alloc: true,
    wifi: true,
    bleMode: "trouble",
    extraEspwrapArgs: "--bin app",
    extraGenerateArgs: "--toolchain nightly",
  };

  const built = formModel.buildNewProjectCommand("espwrap", state);

  assert.deepEqual(built.args, [
    "new",
    "--install-missing",
    "--name",
    "demo",
    "--bin",
    "app",
    "--",
    "--headless",
    "--chip",
    "esp32s3",
    "--output-path",
    path.normalize("D:/esp"),
    "-o",
    "embassy",
    "-o",
    "alloc",
    "-o",
    "wifi",
    "-o",
    "ble-trouble",
    "-o",
    "log",
    "-o",
    "esp-backtrace",
    "-o",
    "probe-rs",
    "--toolchain",
    "nightly",
  ]);
  assert.equal(built.projectDir, path.join(path.normalize("D:/esp"), "demo"));
});

run("builds a patch command with optional flags", () => {
  const built = formModel.buildPatchCommand("espwrap", {
    projectPath: "D:/esp/demo",
    chip: "esp32c3",
    bin: "firmware",
    backup: true,
    dryRun: true,
  });

  assert.deepEqual(built.args, [
    "patch",
    "D:/esp/demo",
    "--chip",
    "esp32c3",
    "--bin",
    "firmware",
    "--dry-run",
    "--backup",
  ]);
});

run("parses quoted extra args", () => {
  assert.deepEqual(formModel.parseArgString("--foo bar --name \"hello world\" 'abc def'"), [
    "--foo",
    "bar",
    "--name",
    "hello world",
    "abc def",
  ]);
});

run("rejects conflicting extra args that duplicate form-managed fields", () => {
  const state = {
    ...formModel.createDefaultState("esp32c3", false, "D:/esp"),
    name: "demo",
    extraEspwrapArgs: "--name other --install-missing",
    extraGenerateArgs: "--chip esp32s3 --output-path elsewhere",
  };

  assert.deepEqual(formModel.validateNewProjectState(state), [
    "Extra espwrap args cannot include `--name`. Project Name is already controlled by the form.",
    "Extra espwrap args cannot include `--install-missing`. Install Missing Tools is already controlled by the checkbox.",
    "Extra esp-generate args cannot include `--chip`. Chip is already selected above.",
    "Extra esp-generate args cannot include `--output-path`. Output Directory is already selected above.",
  ]);
});

run("resolves relative output paths against the provided base directory", () => {
  const state = {
    ...formModel.createDefaultState("esp32c3", false, "generated"),
    name: "demo",
  };

  const built = formModel.buildNewProjectCommand("espwrap", state, {
    resolveOutputPathAgainst: "D:/workspace",
  });

  assert.ok(built.args.includes(path.resolve("D:/workspace", "generated")));
  assert.equal(built.projectDir, path.resolve("D:/workspace", "generated", "demo"));
});

run("renders detailed CLI badges on the home page", () => {
  const html = homeViewContent.renderHomeDocument({
    scriptUri: "home.js",
    styleUri: "home.css",
    nonce: "nonce",
    cspSource: "self",
    input: {
      workspaceFolder: "D:/espwrap",
      configuredPath: "",
      resolvedBinary: {
        sourceLabel: "Bundled CLI",
        version: "espwrap 0.2.0",
        binaryPath: "D:/espwrap/bin/espwrap.exe",
        supportsDoctorJson: true,
        supportsInstallMissing: true,
      },
      hasFullFeatureBinary: true,
      failures: [],
      lastDoctor: {
        timestamp: "2026-04-07T00:00:00.000Z",
        failures: 0,
        warnings: 1,
        ok: true,
      },
    },
  });

  assert.match(html, /Readiness/);
  assert.match(html, /Ready/);
  assert.match(html, /Bundled CLI/);
  assert.match(html, /doctor --json/);
  assert.match(html, /--install-missing/);
  assert.match(html, /Last Doctor/);
  assert.match(html, /badge-good/);
  assert.ok(
    html.indexOf("<h2>New Rust Project</h2>") < html.indexOf("Other Actions"),
    "New project entry should appear before the foldout sections"
  );
  assert.match(html, /<details class="card foldout"/);
  assert.match(html, /Other Actions/);
  assert.match(html, /CLI Status/);
});

run("renders missing CLI state on the home page", () => {
  const html = homeViewContent.renderHomeDocument({
    scriptUri: "home.js",
    styleUri: "home.css",
    nonce: "nonce",
    cspSource: "self",
    input: {
      workspaceFolder: "No workspace open",
      configuredPath: "",
      hasFullFeatureBinary: false,
      failures: [
        {
          sourceLabel: "PATH Command",
          binaryPath: "espwrap",
          detail: "Could not find `espwrap`.",
        },
      ],
    },
  });

  assert.match(html, /Missing/);
  assert.match(html, /No usable espwrap CLI was detected yet/);
  assert.match(html, /Tried Candidates/);
  assert.match(html, /PATH Command/);
});

run("renders the patch workspace form controls", () => {
  const html = patchPanelContent.renderPatchDocument({
    scriptUri: "patch.js",
    styleUri: "patch.css",
    nonce: "nonce",
    cspSource: "self",
    state: {
      projectPath: "D:/esp/demo",
      chip: "esp32s3",
      bin: "firmware",
      dryRun: true,
      backup: true,
    },
    workspaces: [
      {
        label: "demo",
        path: "D:/esp/demo",
      },
    ],
  });

  assert.match(html, /Patch Current Workspace/);
  assert.match(html, /Workspace Folder/);
  assert.match(html, /Chip Override/);
  assert.match(html, /Binary Override/);
  assert.match(html, /Run Patch/);
  assert.match(html, /data-toggle="dryRun"/);
  assert.match(html, /data-toggle="backup"/);
});

console.log("All extension tests passed.");

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
