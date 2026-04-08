import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, "..");
const packageJson = JSON.parse(await BunLikeRead(path.join(extensionDir, "package.json")));
const vsixPath = path.join(extensionDir, ".artifacts", `${packageJson.name}-${packageJson.version}.vsix`);

if (!existsSync(vsixPath)) {
  throw new Error(`Missing VSIX at ${vsixPath}. Run \`npm run package:vsix\` first.`);
}

const installArgs = ["--install-extension", vsixPath, "--force"];
const result = runVsCodeInstall(installArgs);

if (result.status !== 0) {
  throw new Error(
    `VSIX install failed. You can still install manually from VS Code with "Extensions: Install from VSIX..." and choose ${vsixPath}.`
  );
}

console.log(`Installed ${vsixPath}`);

async function BunLikeRead(target) {
  const { readFile } = await import("node:fs/promises");
  return readFile(target, "utf8");
}

function runVsCodeInstall(args) {
  if (process.platform === "win32") {
    const cli = resolveWindowsCodeCmd();
    if (!cli) {
      return { status: 1 };
    }

    return spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `& '${escapePs(cli)}' ${args.map((arg) => `'${escapePs(arg)}'`).join(" ")}`,
      ],
      { stdio: "inherit" }
    );
  }

  return spawnSync("code", args, { stdio: "inherit" });
}

function resolveWindowsCodeCmd() {
  const lookup = spawnSync("where.exe", ["code.cmd"], { encoding: "utf8" });
  if (lookup.status !== 0) {
    return null;
  }

  return lookup.stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find(Boolean) ?? null;
}

function escapePs(value) {
  return String(value).replace(/'/g, "''");
}
