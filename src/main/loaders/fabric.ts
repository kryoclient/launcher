import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { LoaderVersion } from "../../shared/types";
import { versionDir, versionJsonPath } from "../install";
import { fetchJson, type VersionJson } from "../mojang";

const FABRIC_META = "https://meta.fabricmc.net/v2";
const QUILT_META = "https://meta.quiltmc.org/v3";

interface LoaderEntry {
  loader: { version: string; stable: boolean; build: number };
}

function metaRoot(flavor: "fabric" | "quilt"): string {
  return flavor === "fabric" ? FABRIC_META : QUILT_META;
}

export async function fabricLikeVersions(
  flavor: "fabric" | "quilt",
  minecraft: string
): Promise<LoaderVersion[]> {
  const entries = await fetchJson<LoaderEntry[]>(`${metaRoot(flavor)}/versions/loader/${minecraft}`);

  return entries.map((entry) => ({
    id: entry.loader.version,
    label: entry.loader.version,
    stable: entry.loader.stable ?? !/beta|alpha|pre|rc/i.test(entry.loader.version),
    recommended: false
  }));
}

export async function installFabricLike(
  flavor: "fabric" | "quilt",
  gameDir: string,
  minecraft: string,
  loaderVersion: string
): Promise<string> {
  let loader = loaderVersion;

  if (!loader) {
    const available = await fabricLikeVersions(flavor, minecraft);
    const pick = available.find((entry) => entry.recommended) ?? available.find((entry) => entry.stable) ?? available[0];
    if (!pick) throw new Error(`${flavor} has no build for Minecraft ${minecraft} yet`);
    loader = pick.id;
  }

  const prefix = flavor === "fabric" ? "fabric-loader" : "quilt-loader";
  const versionId = `${prefix}-${loader}-${minecraft}`;
  const target = versionJsonPath(gameDir, versionId);

  if (!existsSync(target)) {
    const json = await fetchJson<VersionJson>(
      `${metaRoot(flavor)}/versions/loader/${minecraft}/${loader}/profile/json`
    );
    mkdirSync(versionDir(gameDir, versionId), { recursive: true });
    writeFileSync(target, JSON.stringify(json, null, 2), "utf8");
  }

  return versionId;
}
