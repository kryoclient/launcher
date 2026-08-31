import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { cachedSha1, rememberSha1 } from "./verify";

export const VERSION_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
export const ASSET_BASE = "https://resources.download.minecraft.net";

export interface ManifestEntry {
  id: string;
  type: string;
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
}

export interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: ManifestEntry[];
}

export interface Artifact {
  path?: string;
  sha1: string;
  size: number;
  url: string;
}

export interface LibraryRule {
  action: "allow" | "disallow";
  os?: { name?: string; version?: string; arch?: string };
  features?: Record<string, boolean>;
}

export interface Library {
  name: string;
  downloads?: {
    artifact?: Artifact;
    classifiers?: Record<string, Artifact>;
  };
  natives?: Record<string, string>;
  rules?: LibraryRule[];
  extract?: { exclude?: string[] };
  url?: string;
}

export interface VersionJson {
  id: string;
  inheritsFrom?: string;
  mainClass: string;
  assets: string;
  type: string;
  minecraftArguments?: string;
  arguments?: {
    game: (string | { rules: LibraryRule[]; value: string | string[] })[];
    jvm: (string | { rules: LibraryRule[]; value: string | string[] })[];
  };
  assetIndex: { id: string; sha1: string; size: number; totalSize: number; url: string };
  downloads: { client: Artifact; server?: Artifact };
  libraries: Library[];
  javaVersion?: { component: string; majorVersion: number };
  logging?: { client?: { argument: string; file: Artifact & { id: string }; type: string } };
}

export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
  map_to_resources?: boolean;
}

export function osName(): "windows" | "osx" | "linux" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "osx";
  return "linux";
}

export function osArch(): string {
  if (process.arch === "x64") return "x64";
  if (process.arch === "ia32") return "x86";
  if (process.arch === "arm64") return "arm64";
  return process.arch;
}

export function rulesAllow(rules: LibraryRule[] | undefined, features: Record<string, boolean> = {}): boolean {
  if (!rules || rules.length === 0) return true;

  let allowed = false;

  for (const rule of rules) {
    let matches = true;

    if (rule.os) {
      if (rule.os.name && rule.os.name !== osName()) matches = false;
      if (rule.os.arch && rule.os.arch !== osArch()) matches = false;
      if (rule.os.version && !new RegExp(rule.os.version).test(process.getSystemVersion?.() ?? "")) matches = false;
    }

    if (rule.features) {
      for (const [key, expected] of Object.entries(rule.features)) {
        if ((features[key] ?? false) !== expected) matches = false;
      }
    }

    if (matches) allowed = rule.action === "allow";
  }

  return allowed;
}

export function nativeClassifier(library: Library): string | null {
  if (!library.natives) return null;
  const template = library.natives[osName()];
  if (!template) return null;
  return template.replace("${arch}", process.arch === "ia32" ? "32" : "64");
}

export function libraryPath(name: string): string {
  const [coordinate, extension = "jar"] = name.split("@");
  const [group, artifact, version, classifier] = coordinate.split(":");
  const fileName = classifier
    ? `${artifact}-${version}-${classifier}.${extension}`
    : `${artifact}-${version}.${extension}`;
  return join(...group.split("."), artifact, version, fileName);
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "User-Agent": "KryoClient/1.0" } });
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
  return (await response.json()) as T;
}

export function sha1File(path: string): string {
  const cached = cachedSha1(path);
  if (cached) return cached;

  const digest = createHash("sha1").update(readFileSync(path)).digest("hex");
  rememberSha1(path, digest);
  return digest;
}

export async function sha1Of(path: string): Promise<string> {
  const cached = cachedSha1(path);
  if (cached) return cached;

  const digest = createHash("sha1").update(await readFile(path)).digest("hex");
  rememberSha1(path, digest);
  return digest;
}

export function isPresent(path: string, size?: number): boolean {
  if (!existsSync(path)) return false;
  if (size === undefined) return true;
  try {
    return statSync(path).size === size;
  } catch {
    return false;
  }
}

export async function isValid(path: string, expectedSha1?: string, expectedSize?: number): Promise<boolean> {
  if (!existsSync(path)) return false;
  if (expectedSize !== undefined) {
    try {
      if (statSync(path).size !== expectedSize) return false;
    } catch {
      return false;
    }
  }
  if (!expectedSha1) return true;
  try {
    return (await sha1Of(path)) === expectedSha1;
  } catch {
    return false;
  }
}

export async function downloadFile(url: string, target: string, sha1?: string, size?: number): Promise<void> {
  if (await isValid(target, sha1, size)) return;

  mkdirSync(dirname(target), { recursive: true });

  const response = await fetch(url, { headers: { "User-Agent": "KryoClient/1.0" } });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);

  const temp = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temp));

  if (sha1) {
    const actual = createHash("sha1").update(readFileSync(temp)).digest("hex");
    if (actual !== sha1) {
      await rm(temp, { force: true });
      throw new Error(`Checksum mismatch for ${url}`);
    }
  }

  await rename(temp, target);
  if (sha1) rememberSha1(target, sha1);
}

export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}
