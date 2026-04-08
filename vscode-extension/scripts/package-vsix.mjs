import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(extensionDir, "..");
const packageJsonPath = path.join(extensionDir, "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const binaryName = process.platform === "win32" ? "espwrap.exe" : "espwrap";
const candidateBinaries = [
  path.join(repoDir, "target", "release", binaryName),
  path.join(repoDir, "target", "debug", binaryName),
];
const cliBinary = candidateBinaries.find((candidate) => existsSync(candidate));

if (!cliBinary) {
  throw new Error(
    `Could not find a built espwrap binary. Expected one of: ${candidateBinaries.join(", ")}. Run \`cargo build\` first.`
  );
}

const distEntry = path.join(extensionDir, "dist", "extension.js");
if (!existsSync(distEntry)) {
  throw new Error(`Missing compiled extension entry at ${distEntry}. Run \`npm run compile\` first.`);
}

const stageRoot = path.join(extensionDir, ".vsix-staging");
const packageRoot = path.join(stageRoot, "extension");
const outputDir = path.join(extensionDir, ".artifacts");
const vsixPath = path.join(outputDir, `${packageJson.name}-${packageJson.version}.vsix`);
const zipPath = path.join(outputDir, `${packageJson.name}-${packageJson.version}.zip`);

await rm(stageRoot, { recursive: true, force: true });
await rm(vsixPath, { force: true });
await rm(zipPath, { force: true });
await mkdir(packageRoot, { recursive: true });
await mkdir(outputDir, { recursive: true });

await cp(path.join(extensionDir, "dist"), path.join(packageRoot, "dist"), { recursive: true });
await cp(path.join(extensionDir, "media"), path.join(packageRoot, "media"), { recursive: true });
await cp(path.join(extensionDir, "README.md"), path.join(packageRoot, "README.md"));
await cp(path.join(repoDir, "LICENSE"), path.join(packageRoot, "LICENSE"));
await cp(packageJsonPath, path.join(packageRoot, "package.json"));
await mkdir(path.join(packageRoot, "bin"), { recursive: true });
await cp(cliBinary, path.join(packageRoot, "bin", binaryName));

await writeFile(path.join(stageRoot, "extension.vsixmanifest"), createVsixManifest(packageJson), "utf8");
await writeFile(path.join(stageRoot, "[Content_Types].xml"), createContentTypes(), "utf8");

createArchive(stageRoot, zipPath);
await cp(zipPath, vsixPath);
await rm(zipPath, { force: true });

console.log(`Created ${vsixPath}`);
console.log(`Bundled CLI: ${cliBinary}`);

function createArchive(sourceDir, destinationPath) {
  if (process.platform === "win32") {
    const command = [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path (Join-Path '${escapePs(sourceDir)}' '*') -DestinationPath '${escapePs(destinationPath)}' -Force`,
    ];
    const result = spawnSync("powershell.exe", command, {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`Compress-Archive failed with exit code ${result.status ?? -1}.`);
    }
    return;
  }

  const result = spawnSync("zip", ["-qr", destinationPath, "."], {
    cwd: sourceDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`zip failed with exit code ${result.status ?? -1}.`);
  }
}

function createVsixManifest(pkg) {
  const tags = Array.isArray(pkg.keywords) ? pkg.keywords.join(",") : "";
  const categories = Array.isArray(pkg.categories) ? pkg.categories.join(",") : "";
  const engine = pkg.engines?.vscode ?? "*";

  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Id="${escapeXml(pkg.name)}" Version="${escapeXml(pkg.version)}" Language="en-US" Publisher="${escapeXml(pkg.publisher)}" />
    <DisplayName>${escapeXml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(pkg.description)}</Description>
    <Tags>${escapeXml(tags)}</Tags>
    <Categories>${escapeXml(categories)}</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(engine)}" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" Version="${escapeXml(engine)}" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>`;
}

function createContentTypes() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="xml" ContentType="text/xml" />
  <Default Extension="exe" ContentType="application/octet-stream" />
</Types>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapePs(value) {
  return String(value).replace(/'/g, "''");
}
