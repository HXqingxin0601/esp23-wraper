import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, "..");
const packageJson = JSON.parse(await readFile(path.join(extensionDir, "package.json"), "utf8"));
const vsixPath = path.join(extensionDir, ".artifacts", `${packageJson.name}-${packageJson.version}.vsix`);
const zipPath = path.join(extensionDir, ".artifacts", `${packageJson.name}-${packageJson.version}.smoke.zip`);
const extractDir = path.join(extensionDir, ".artifacts", "smoke-unpacked");

const packageResult = spawnSync(process.execPath, [path.join(scriptDir, "package-vsix.mjs")], {
  stdio: "inherit",
});
if (packageResult.status !== 0) {
  throw new Error(`VSIX packaging failed with exit code ${packageResult.status ?? -1}.`);
}

await rm(extractDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(extractDir, { recursive: true });
await cp(vsixPath, zipPath);

if (process.platform === "win32") {
  const unzipResult = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${escapePs(zipPath)}' -DestinationPath '${escapePs(extractDir)}' -Force`,
    ],
    { stdio: "inherit" }
  );
  if (unzipResult.status !== 0) {
    throw new Error(`Expand-Archive failed with exit code ${unzipResult.status ?? -1}.`);
  }
} else {
  const unzipResult = spawnSync("unzip", ["-q", zipPath, "-d", extractDir], { stdio: "inherit" });
  if (unzipResult.status !== 0) {
    throw new Error(`unzip failed with exit code ${unzipResult.status ?? -1}.`);
  }
}

const requiredEntries = [
  "[Content_Types].xml",
  "extension.vsixmanifest",
  path.join("extension", "package.json"),
  path.join("extension", "dist", "extension.js"),
  path.join("extension", "README.md"),
  path.join("extension", "bin", process.platform === "win32" ? "espwrap.exe" : "espwrap"),
];

for (const entry of requiredEntries) {
  const target = path.join(extractDir, entry);
  if (!existsSync(target)) {
    throw new Error(`Missing expected VSIX entry: ${target}`);
  }
}

console.log(`VSIX smoke test passed: ${vsixPath}`);

await rm(zipPath, { force: true });

function escapePs(value) {
  return String(value).replace(/'/g, "''");
}
