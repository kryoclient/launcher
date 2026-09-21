import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync, execFileSync } from "node:child_process";

// Archive the addon folder, minus its uncompiled sources.
function createArchive(addonDir: string, zipOutput: string) {
  const entries = fs
    .readdirSync(addonDir)
    .filter((name) => name !== "src" && name !== ".DS_Store");

  if (entries.length === 0) {
    console.error(`Nothing to archive in ${addonDir}`);
    process.exit(1);
  }

  if (process.platform === "win32") {
    // Windows ships no zip binary, but PowerShell is always available
    const quote = (p: string) => `'${p.replace(/'/g, "''")}'`;
    const sources = entries
      .map((name) => quote(path.join(addonDir, name)))
      .join(",");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Compress-Archive -Path ${sources} -DestinationPath ${quote(zipOutput)} -Force`,
      ],
      { stdio: "inherit" },
    );
    return;
  }

  execSync(
    `cd "${addonDir}" && zip -r "${zipOutput}" . -x "*.DS_Store" -x "src/*"`,
    {
      stdio: "inherit",
    },
  );
}

const rootDir = path.resolve(__dirname, "..");
const addonsBaseDir = path.join(rootDir, "addons");
const addonsSrcDir = path.join(addonsBaseDir, "src");
const addonsDistDir = path.join(addonsBaseDir, "dist");
const catalogJsonPath = path.join(addonsBaseDir, "catalog.json");

if (!fs.existsSync(addonsDistDir)) {
  fs.mkdirSync(addonsDistDir, { recursive: true });
}

if (!fs.existsSync(addonsSrcDir)) {
  console.error(`Addons source directory does not exist: ${addonsSrcDir}`);
  process.exit(1);
}

const addonDirs = fs
  .readdirSync(addonsSrcDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

console.log(`Building ${addonDirs.length} addon zip archives...`);

const catalogList: any[] = [];

for (const addonId of addonDirs) {
  const addonDir = path.join(addonsSrcDir, addonId);
  const manifestPath = path.join(addonDir, "addon.json");

  if (!fs.existsSync(manifestPath)) {
    console.warn(`Skipping ${addonId}: addon.json not found.`);
    continue;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  const srcEntry = [
    path.join(addonDir, "src", "index.js"),
    path.join(addonDir, "src", "index.tsx"),
    path.join(addonDir, "src", "index.ts"),
  ].find((p) => fs.existsSync(p));

  if (srcEntry) {
    const buildRes = await Bun.build({
      entrypoints: [srcEntry],
      outdir: addonDir,
      naming: "index.js",
      target: "browser",
      format: "esm",
      minify: true,
      external: ["react", "react-dom"],
    });

    if (!buildRes.success) {
      console.error(`Failed to build ${addonId}:`, buildRes.logs);
      process.exit(1);
    }
  }

  const zipOutput = path.join(addonsDistDir, `${addonId}.zip`);

  if (fs.existsSync(zipOutput)) {
    fs.unlinkSync(zipOutput);
  }

  createArchive(addonDir, zipOutput);

  const fileBuffer = fs.readFileSync(zipOutput);
  const stats = fs.statSync(zipOutput);
  const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  // If dev .kryoclient/addons directory exists, sync files directly for instant dev testing
  const devAddonsDir = path.join(rootDir, "src-tauri", ".kryoclient", "addons");
  if (fs.existsSync(devAddonsDir)) {
    const devAddonTarget = path.join(devAddonsDir, addonId);
    fs.mkdirSync(devAddonTarget, { recursive: true });
    fs.copyFileSync(manifestPath, path.join(devAddonTarget, "addon.json"));
    const jsEntry = path.join(addonDir, "index.js");
    if (fs.existsSync(jsEntry)) {
      fs.copyFileSync(jsEntry, path.join(devAddonTarget, "index.js"));
    }
    const cssEntry = path.join(addonDir, "style.css");
    if (fs.existsSync(cssEntry)) {
      fs.copyFileSync(cssEntry, path.join(devAddonTarget, "style.css"));
    }
  }

  // In catalog.json, automatically attach archive sizeBytes, checksum, and downloadUrl
  const catalogItem = {
    ...manifest,
    sizeBytes: stats.size,
    checksum: hash,
    downloadUrl: `https://raw.githubusercontent.com/kryoclient/launcher/new/addons/dist/${addonId}.zip`,
  };

  catalogList.push(catalogItem);
  console.log(
    `✓ Built ${addonId}.zip (${stats.size} bytes, sha256: ${hash.slice(0, 8)}...)`,
  );
}

// Keep catalog entries of addons that are published without sources in this repo
const previousCatalog: any[] = fs.existsSync(catalogJsonPath)
  ? JSON.parse(fs.readFileSync(catalogJsonPath, "utf-8"))
  : [];

const mergedCatalog = [...previousCatalog];
for (const item of catalogList) {
  const index = mergedCatalog.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    mergedCatalog[index] = item;
  } else {
    mergedCatalog.push(item);
  }
}

for (const entry of previousCatalog) {
  if (!catalogList.some((item) => item.id === entry.id)) {
    console.warn(
      `! Kept catalog entry '${entry.id}': no sources in addons/src`,
    );
  }
}

const catalogJsonContent = JSON.stringify(mergedCatalog, null, 2) + "\n";
fs.writeFileSync(catalogJsonPath, catalogJsonContent, "utf-8");

console.log(`✓ Generated ${catalogJsonPath} (${mergedCatalog.length} addons)`);
console.log(`✓ Addon archives output directory: ${addonsDistDir}`);
console.log("All addon zip archives built successfully!");
