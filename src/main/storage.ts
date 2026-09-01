import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { StorageMode, StorageUsage } from "../shared/types";

const CONFIG_FILES = ["kryo-config.json", "kryo-accounts.json"];

async function folderSize(path: string): Promise<number> {
  if (!existsSync(path)) return 0;

  let total = 0;
  const queue = [path];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) break;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }

      try {
        total += (await stat(full)).size;
      } catch {
        continue;
      }
    }
  }

  return total;
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export async function storageUsage(gameDir: string, userData: string): Promise<StorageUsage> {
  const [versions, libraries, assets, runtime, instances, cache, installers, launcher] = await Promise.all([
    folderSize(join(gameDir, "versions")),
    folderSize(join(gameDir, "libraries")),
    folderSize(join(gameDir, "assets")),
    folderSize(join(gameDir, "runtime")),
    folderSize(join(gameDir, "instances")),
    folderSize(join(gameDir, "cache")),
    folderSize(join(gameDir, "installers")),
    folderSize(userData)
  ]);

  return {
    gameDir,
    versions,
    libraries,
    assets,
    runtime,
    instances,
    cache: cache + installers,
    launcher,
    total: versions + libraries + assets + runtime + instances + cache + installers + launcher
  };
}

function targetsFor(gameDir: string, mode: StorageMode): string[] {
  const cache = [join(gameDir, "cache"), join(gameDir, "installers")];

  if (mode === "cache") return cache;
  if (mode === "java") return [join(gameDir, "runtime")];
  if (mode === "game") return [join(gameDir, "versions"), join(gameDir, "libraries"), join(gameDir, "assets"), ...cache];

  return [gameDir];
}

export async function wipeStorage(gameDir: string, userData: string, mode: StorageMode): Promise<number> {
  const targets = targetsFor(gameDir, mode);
  const sizes = await Promise.all(targets.map((target) => folderSize(target)));
  let freed = sizes.reduce((sum, size) => sum + size, 0);

  for (const target of targets) {
    await rm(target, { recursive: true, force: true });
  }

  if (mode === "all") {
    for (const name of CONFIG_FILES) {
      const file = join(userData, name);
      freed += await fileSize(file);
      await rm(file, { force: true });
    }
  }

  return freed;
}
