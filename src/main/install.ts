import AdmZip from "adm-zip";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Progress } from "../shared/types";
import {
  ASSET_BASE,
  VERSION_MANIFEST,
  downloadFile,
  fetchJson,
  isValid,
  libraryPath,
  nativeClassifier,
  rulesAllow,
  runPool,
  type AssetIndex,
  type Library,
  type VersionJson,
  type VersionManifest
} from "./mojang";

const FABRIC_META = "https://meta.fabricmc.net/v2";
const MAVEN_CENTRAL = "https://libraries.minecraft.net/";

export type ProgressSink = (progress: Progress) => void;

export function versionDir(gameDir: string, versionId: string): string {
  return join(gameDir, "versions", versionId);
}

export function versionJsonPath(gameDir: string, versionId: string): string {
  return join(versionDir(gameDir, versionId), `${versionId}.json`);
}

export function versionJarPath(gameDir: string, versionId: string): string {
  return join(versionDir(gameDir, versionId), `${versionId}.jar`);
}

export function nativesDir(gameDir: string, versionId: string): string {
  return join(versionDir(gameDir, versionId), "natives");
}

export async function loadManifest(): Promise<VersionManifest> {
  return fetchJson<VersionManifest>(VERSION_MANIFEST);
}

export async function fetchVanillaJson(gameDir: string, versionId: string): Promise<VersionJson> {
  const target = versionJsonPath(gameDir, versionId);

  if (existsSync(target)) {
    return JSON.parse(readFileSync(target, "utf8")) as VersionJson;
  }

  const manifest = await loadManifest();
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) throw new Error(`Unknown Minecraft version: ${versionId}`);

  const json = await fetchJson<VersionJson>(entry.url);
  mkdirSync(versionDir(gameDir, versionId), { recursive: true });
  writeFileSync(target, JSON.stringify(json, null, 2), "utf8");
  return json;
}

export async function latestFabricLoader(minecraft: string): Promise<string> {
  const loaders = await fetchJson<{ loader: { version: string; stable: boolean } }[]>(
    `${FABRIC_META}/versions/loader/${minecraft}`
  );
  const stable = loaders.find((l) => l.loader.stable) ?? loaders[0];
  if (!stable) throw new Error(`Fabric does not support Minecraft ${minecraft} yet`);
  return stable.loader.version;
}

export async function installFabric(gameDir: string, minecraft: string): Promise<string> {
  const loader = await latestFabricLoader(minecraft);
  const versionId = `fabric-loader-${loader}-${minecraft}`;
  const target = versionJsonPath(gameDir, versionId);

  if (!existsSync(target)) {
    const json = await fetchJson<VersionJson>(`${FABRIC_META}/versions/loader/${minecraft}/${loader}/profile/json`);
    mkdirSync(versionDir(gameDir, versionId), { recursive: true });
    writeFileSync(target, JSON.stringify(json, null, 2), "utf8");
  }

  return versionId;
}

export async function resolveVersionJson(gameDir: string, versionId: string): Promise<VersionJson> {
  const path = versionJsonPath(gameDir, versionId);
  const own = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as VersionJson)
    : await fetchVanillaJson(gameDir, versionId);

  if (!own.inheritsFrom) return own;

  const parent = await resolveVersionJson(gameDir, own.inheritsFrom);

  return {
    ...parent,
    ...own,
    id: own.id,
    mainClass: own.mainClass ?? parent.mainClass,
    assets: own.assets ?? parent.assets,
    assetIndex: own.assetIndex ?? parent.assetIndex,
    downloads: own.downloads ?? parent.downloads,
    javaVersion: own.javaVersion ?? parent.javaVersion,
    libraries: [...(own.libraries ?? []), ...(parent.libraries ?? [])],
    arguments: {
      game: [...(own.arguments?.game ?? []), ...(parent.arguments?.game ?? [])],
      jvm: [...(own.arguments?.jvm ?? []), ...(parent.arguments?.jvm ?? [])]
    },
    minecraftArguments: own.minecraftArguments ?? parent.minecraftArguments
  };
}

export function usableLibraries(version: VersionJson): Library[] {
  return version.libraries.filter((lib) => rulesAllow(lib.rules));
}

export function libraryTargets(gameDir: string, version: VersionJson): { path: string; url: string; sha1?: string; size?: number }[] {
  const targets: { path: string; url: string; sha1?: string; size?: number }[] = [];

  for (const lib of usableLibraries(version)) {
    const artifact = lib.downloads?.artifact;

    if (artifact) {
      const relative = artifact.path ?? libraryPath(lib.name);
      targets.push({
        path: join(gameDir, "libraries", relative),
        url: artifact.url,
        sha1: artifact.sha1,
        size: artifact.size
      });
    } else if (!lib.natives) {
      const relative = libraryPath(lib.name).split("\\").join("/");
      const base = lib.url ?? MAVEN_CENTRAL;
      targets.push({
        path: join(gameDir, "libraries", libraryPath(lib.name)),
        url: `${base.endsWith("/") ? base : `${base}/`}${relative}`
      });
    }

    const classifier = nativeClassifier(lib);
    const native = classifier ? lib.downloads?.classifiers?.[classifier] : undefined;
    if (native) {
      targets.push({
        path: join(gameDir, "libraries", native.path ?? libraryPath(`${lib.name}:${classifier}`)),
        url: native.url,
        sha1: native.sha1,
        size: native.size
      });
    }
  }

  return targets;
}

export async function extractNatives(gameDir: string, version: VersionJson): Promise<void> {
  const outDir = nativesDir(gameDir, version.id);
  mkdirSync(outDir, { recursive: true });

  for (const lib of usableLibraries(version)) {
    const classifier = nativeClassifier(lib);
    if (!classifier) continue;

    const native = lib.downloads?.classifiers?.[classifier];
    if (!native) continue;

    const jar = join(gameDir, "libraries", native.path ?? libraryPath(`${lib.name}:${classifier}`));
    if (!existsSync(jar)) continue;

    const zip = new AdmZip(jar);
    const excludes = lib.extract?.exclude ?? [];

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (excludes.some((prefix) => entry.entryName.startsWith(prefix))) continue;
      if (entry.entryName.includes("../")) continue;
      zip.extractEntryTo(entry, outDir, false, true);
    }
  }
}

export async function installVersion(
  gameDir: string,
  versionId: string,
  onProgress: ProgressSink
): Promise<VersionJson> {
  onProgress({ stage: "manifest", label: "Reading version manifest", current: 0, total: 1, done: false });

  const version = await resolveVersionJson(gameDir, versionId);

  onProgress({ stage: "client", label: `Downloading client ${version.id}`, current: 0, total: 1, done: false });

  const clientJar = versionJarPath(gameDir, version.id);
  const clientSource = version.downloads?.client;
  if (clientSource) {
    await downloadFile(clientSource.url, clientJar, clientSource.sha1, clientSource.size);
  }

  const libs = libraryTargets(gameDir, version);
  let libDone = 0;
  onProgress({ stage: "libraries", label: "Downloading libraries", current: 0, total: libs.length, done: false });

  await runPool(libs, 12, async (target) => {
    try {
      await downloadFile(target.url, target.path, target.sha1, target.size);
    } catch (error) {
      if (target.sha1) throw error;
    }
    libDone += 1;
    onProgress({
      stage: "libraries",
      label: "Downloading libraries",
      current: libDone,
      total: libs.length,
      done: false
    });
  });

  onProgress({ stage: "natives", label: "Unpacking natives", current: 0, total: 1, done: false });
  await extractNatives(gameDir, version);

  const indexPath = join(gameDir, "assets", "indexes", `${version.assetIndex.id}.json`);
  await downloadFile(version.assetIndex.url, indexPath, version.assetIndex.sha1, version.assetIndex.size);
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as AssetIndex;

  const objects = Object.entries(index.objects);
  let assetDone = 0;
  onProgress({ stage: "assets", label: "Downloading assets", current: 0, total: objects.length, done: false });

  await runPool(objects, 16, async ([, object]) => {
    const sub = object.hash.slice(0, 2);
    const target = join(gameDir, "assets", "objects", sub, object.hash);
    if (!(await isValid(target, object.hash, object.size))) {
      await downloadFile(`${ASSET_BASE}/${sub}/${object.hash}`, target, object.hash, object.size);
    }
    assetDone += 1;
    if (assetDone % 25 === 0 || assetDone === objects.length) {
      onProgress({
        stage: "assets",
        label: "Downloading assets",
        current: assetDone,
        total: objects.length,
        done: false
      });
    }
  });

  if (version.logging?.client?.file) {
    const logFile = version.logging.client.file;
    await downloadFile(
      logFile.url,
      join(gameDir, "assets", "log_configs", logFile.id),
      logFile.sha1,
      logFile.size
    );
  }

  onProgress({ stage: "idle", label: "Ready", current: 1, total: 1, done: true });
  return version;
}
