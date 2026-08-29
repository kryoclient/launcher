import AdmZip from "adm-zip";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { LoaderVersion, Progress } from "../../shared/types";
import { resolveVersionJson, versionDir, versionJarPath, versionJsonPath } from "../install";
import { downloadFile, fetchJson, libraryPath, type VersionJson } from "../mojang";

const OPTIFINE_SITE = "https://optifine.net";
const BMCL_MIRROR = "https://bmclapi2.bangbang93.com/optifine";
const AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KryoClient/1.0";

interface MirrorEntry {
  mcversion: string;
  patch: string;
  type: string;
  filename?: string;
}

export interface OptifineFile {
  fileName: string;
  minecraft: string;
  edition: string;
}

export function parseOptifineFile(fileName: string): OptifineFile | null {
  const clean = fileName.replace(/^preview_/, "").replace(/\.jar$/, "");
  const parts = clean.split("_");
  if (parts.length < 3 || parts[0] !== "OptiFine") return null;
  return { fileName, minecraft: parts[1], edition: parts.slice(2).join("_") };
}

async function officialList(minecraft: string): Promise<string[]> {
  const response = await fetch(`${OPTIFINE_SITE}/downloads`, { headers: { "User-Agent": AGENT } });
  if (!response.ok) throw new Error(`OptiFine site returned ${response.status}`);

  const html = await response.text();
  const found = new Set<string>();

  for (const match of html.matchAll(/adloadx\?f=((?:preview_)?OptiFine_[^&"']+\.jar)/g)) {
    const parsed = parseOptifineFile(match[1]);
    if (parsed && parsed.minecraft === minecraft) found.add(match[1]);
  }

  return [...found];
}

async function mirrorList(minecraft: string): Promise<string[]> {
  const entries = await fetchJson<MirrorEntry[]>(`${BMCL_MIRROR}/${minecraft}`);
  return entries
    .map((entry) => entry.filename ?? `OptiFine_${entry.mcversion}_${entry.type}_${entry.patch}.jar`)
    .filter((name) => parseOptifineFile(name)?.minecraft === minecraft);
}

export async function optifineVersions(minecraft: string): Promise<LoaderVersion[]> {
  const sources = await Promise.allSettled([officialList(minecraft), mirrorList(minecraft)]);
  const names = new Set<string>();

  for (const source of sources) {
    if (source.status !== "fulfilled") continue;
    for (const name of source.value) names.add(name);
  }

  const sorted = [...names].sort((a, b) => {
    const previewA = a.startsWith("preview_");
    const previewB = b.startsWith("preview_");
    if (previewA !== previewB) return previewA ? 1 : -1;
    return b.localeCompare(a, "en", { numeric: true });
  });

  return sorted.map((name) => {
    const parsed = parseOptifineFile(name);
    return {
      id: name,
      label: parsed ? parsed.edition : name,
      stable: !name.startsWith("preview_"),
      recommended: false
    };
  });
}

async function streamTo(url: string, target: string, headers: Record<string, string>): Promise<void> {
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);

  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temp));

  const zip = new AdmZip(temp);
  if (zip.getEntries().length === 0) throw new Error("Download did not return a jar");

  const { renameSync } = await import("node:fs");
  renameSync(temp, target);
}

async function downloadOfficial(fileName: string, target: string): Promise<void> {
  const gate = `${OPTIFINE_SITE}/adloadx?f=${encodeURIComponent(fileName)}`;
  const page = await fetch(gate, { headers: { "User-Agent": AGENT } });
  if (!page.ok) throw new Error(`OptiFine gateway returned ${page.status}`);

  const html = await page.text();
  const link = html.match(/href=['"](downloadx\?f=[^'"]+)['"]/);
  if (!link) throw new Error("OptiFine download token not found");

  await streamTo(`${OPTIFINE_SITE}/${link[1].replace(/&amp;/g, "&")}`, target, {
    "User-Agent": AGENT,
    Referer: gate
  });
}

async function downloadMirror(file: OptifineFile, target: string): Promise<void> {
  const clean = file.fileName.replace(/^preview_/, "").replace(/\.jar$/, "");
  const parts = clean.split("_");
  const patch = parts[parts.length - 1];
  const type = parts.slice(2, -1).join("_");
  await streamTo(`${BMCL_MIRROR}/${file.minecraft}/${type}/${patch}`, target, { "User-Agent": AGENT });
}

function runJava(java: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(java, args, { cwd });
    let tail = "";

    const collect = (chunk: Buffer): void => {
      tail = `${tail}${chunk.toString()}`.slice(-2000);
    };

    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`OptiFine patcher failed (exit ${code}). ${tail.trim().split("\n").slice(-2).join(" ")}`));
    });
  });
}

function consoleJava(javaPath: string): string {
  if (/javaw\.exe$/i.test(javaPath)) return javaPath.replace(/javaw\.exe$/i, "java.exe");
  if (/javaw$/.test(javaPath)) return javaPath.replace(/javaw$/, "java");
  return javaPath;
}

function extractLaunchwrapper(zip: AdmZip, gameDir: string): string | null {
  const entry = zip.getEntries().find((item) => /^launchwrapper-of-[\d.]+\.jar$/.test(item.entryName));
  if (!entry) return null;

  const version = entry.entryName.replace("launchwrapper-of-", "").replace(".jar", "");
  const target = join(gameDir, "libraries", libraryPath(`optifine:launchwrapper-of:${version}`));

  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.getData());
  }

  return version;
}

export async function installOptifine(options: {
  gameDir: string;
  minecraft: string;
  fileName: string;
  javaPath: string;
  onProgress: (progress: Progress) => void;
}): Promise<string> {
  const { gameDir, minecraft, fileName, javaPath, onProgress } = options;

  const file = parseOptifineFile(fileName);
  if (!file) throw new Error(`${fileName} is not an OptiFine build`);
  if (file.minecraft !== minecraft) throw new Error(`${fileName} does not target Minecraft ${minecraft}`);

  const versionId = `${minecraft}-OptiFine_${file.edition}`;
  const libraryName = `optifine:OptiFine:${minecraft}_${file.edition}`;
  const patched = join(gameDir, "libraries", libraryPath(libraryName));

  onProgress({ stage: "loader", label: `Fetching ${fileName}`, current: 0, total: 3, done: false });

  const installer = join(gameDir, "installers", fileName);

  if (!existsSync(installer)) {
    try {
      await downloadOfficial(fileName, installer);
    } catch {
      await downloadMirror(file, installer);
    }
  }

  const zip = new AdmZip(installer);

  onProgress({ stage: "loader", label: "Unpacking OptiFine", current: 1, total: 3, done: false });
  const launchwrapper = extractLaunchwrapper(zip, gameDir);

  if (!existsSync(patched)) {
    onProgress({ stage: "loader", label: "Patching the client jar", current: 2, total: 3, done: false });
    mkdirSync(dirname(patched), { recursive: true });

    await runJava(
      consoleJava(javaPath),
      ["-cp", installer, "optifine.Patcher", versionJarPath(gameDir, minecraft), installer, patched],
      gameDir
    );
  }

  const base = await resolveVersionJson(gameDir, minecraft);
  const libraries = launchwrapper
    ? [{ name: `optifine:launchwrapper-of:${launchwrapper}` }, { name: libraryName }]
    : [
        { name: "net.minecraft:launchwrapper:1.12", url: "https://libraries.minecraft.net/" },
        { name: libraryName }
      ];

  const json: Partial<VersionJson> & { id: string } = {
    id: versionId,
    inheritsFrom: minecraft,
    type: base.type ?? "release",
    mainClass: "net.minecraft.launchwrapper.Launch",
    libraries,
    arguments: { game: ["--tweakClass", "optifine.OptiFineTweaker"], jvm: [] }
  };

  if (!base.arguments && base.minecraftArguments) {
    json.minecraftArguments = `${base.minecraftArguments} --tweakClass optifine.OptiFineTweaker`;
  }

  mkdirSync(versionDir(gameDir, versionId), { recursive: true });
  writeFileSync(versionJsonPath(gameDir, versionId), JSON.stringify(json, null, 2), "utf8");

  onProgress({ stage: "loader", label: "OptiFine ready", current: 3, total: 3, done: false });

  return versionId;
}

export async function ensureBaseJar(gameDir: string, minecraft: string): Promise<void> {
  const jar = versionJarPath(gameDir, minecraft);
  if (existsSync(jar)) return;

  const base = await resolveVersionJson(gameDir, minecraft);
  const client = base.downloads?.client;
  if (!client) throw new Error(`Minecraft ${minecraft} has no client download`);

  await downloadFile(client.url, jar, client.sha1, client.size);
}
