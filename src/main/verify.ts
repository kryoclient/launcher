import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Stamp {
  size: number;
  mtimeMs: number;
  sha1: string;
}

const MAX_ENTRIES = 4000;

let root: string | null = null;
let stamps = new Map<string, Stamp>();
let dirty = false;

export function cacheDir(gameDir: string): string {
  return join(gameDir, "cache");
}

function cacheFile(gameDir: string): string {
  return join(cacheDir(gameDir), "verified.json");
}

function key(path: string): string {
  const normalized = path.split("\\").join("/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function openVerificationCache(gameDir: string): void {
  if (root === gameDir) return;

  flushVerificationCache();
  root = gameDir;
  stamps = new Map();
  dirty = false;

  const path = cacheFile(gameDir);
  if (!existsSync(path)) return;

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, Stamp | null>;
    for (const [id, stamp] of Object.entries(raw)) {
      if (
        stamp &&
        typeof stamp.sha1 === "string" &&
        typeof stamp.size === "number" &&
        typeof stamp.mtimeMs === "number"
      ) {
        stamps.set(id, stamp);
      }
    }
  } catch {
    stamps = new Map();
  }
}

export function flushVerificationCache(): void {
  if (!root || !dirty) return;

  try {
    mkdirSync(cacheDir(root), { recursive: true });
    writeFileSync(cacheFile(root), JSON.stringify(Object.fromEntries(stamps)), "utf8");
  } catch {
    stamps.clear();
  }

  dirty = false;
}

export function cachedSha1(path: string): string | null {
  if (!root) return null;

  const stamp = stamps.get(key(path));
  if (!stamp) return null;

  try {
    const stat = statSync(path);
    if (stat.size !== stamp.size || Math.round(stat.mtimeMs) !== stamp.mtimeMs) return null;
    return stamp.sha1;
  } catch {
    return null;
  }
}

export function rememberSha1(path: string, sha1: string): void {
  if (!root) return;

  try {
    const stat = statSync(path);
    if (stamps.size >= MAX_ENTRIES) stamps.clear();
    stamps.set(key(path), { size: stat.size, mtimeMs: Math.round(stat.mtimeMs), sha1 });
    dirty = true;
  } catch {
    return;
  }
}
