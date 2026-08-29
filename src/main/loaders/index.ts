import type { LoaderId, LoaderInfo, LoaderVersion, Progress } from "../../shared/types";
import { resolveVersionJson } from "../install";
import { fabricLikeVersions, installFabricLike } from "./fabric";
import { forgeVersions, installForgeLike, neoforgeVersions } from "./forge";
import { ensureBaseJar, installOptifine, optifineVersions } from "./optifine";

export const LOADERS: LoaderInfo[] = [
  { id: "vanilla", name: "Vanilla", tag: "no mods", pickable: false },
  { id: "fabric", name: "Fabric", tag: "lightweight", pickable: true },
  { id: "quilt", name: "Quilt", tag: "fabric fork", pickable: true },
  { id: "forge", name: "Forge", tag: "classic mods", pickable: true },
  { id: "neoforge", name: "NeoForge", tag: "forge fork", pickable: true },
  { id: "optifine", name: "OptiFine", tag: "shaders", pickable: true }
];

function withRecommendation(versions: LoaderVersion[]): LoaderVersion[] {
  if (versions.length === 0) return versions;
  if (versions.some((version) => version.recommended)) return versions;

  const pick = versions.find((version) => version.stable) ?? versions[0];
  return versions.map((version) => (version === pick ? { ...version, recommended: true } : version));
}

async function fetchVersions(loader: LoaderId, minecraft: string): Promise<LoaderVersion[]> {
  switch (loader) {
    case "fabric":
      return fabricLikeVersions("fabric", minecraft);
    case "quilt":
      return fabricLikeVersions("quilt", minecraft);
    case "forge":
      return forgeVersions(minecraft);
    case "neoforge":
      return neoforgeVersions(minecraft);
    case "optifine":
      return optifineVersions(minecraft);
    default:
      return [];
  }
}

export async function loaderVersions(loader: LoaderId, minecraft: string): Promise<LoaderVersion[]> {
  if (!minecraft || loader === "vanilla") return [];
  return withRecommendation(await fetchVersions(loader, minecraft));
}

function pickDefault(versions: LoaderVersion[]): string {
  const preferred =
    versions.find((version) => version.recommended) ?? versions.find((version) => version.stable) ?? versions[0];
  return preferred?.id ?? "";
}

export async function resolveLoaderVersion(
  loader: LoaderId,
  minecraft: string,
  requested: string
): Promise<string> {
  if (loader === "vanilla") return "";

  const versions = await loaderVersions(loader, minecraft);
  if (versions.length === 0) throw new Error(`${loader} has no build for Minecraft ${minecraft} yet`);

  if (requested && versions.some((version) => version.id === requested)) return requested;
  return pickDefault(versions);
}

export async function prepareLoader(options: {
  loader: LoaderId;
  loaderVersion: string;
  gameDir: string;
  minecraft: string;
  requireJava: (major: number) => Promise<string>;
  onProgress: (progress: Progress) => void;
}): Promise<string> {
  const { loader, gameDir, minecraft, requireJava, onProgress } = options;

  if (loader === "vanilla") return minecraft;

  const version = await resolveLoaderVersion(loader, minecraft, options.loaderVersion);

  if (loader === "fabric" || loader === "quilt") {
    return installFabricLike(loader, gameDir, minecraft, version);
  }

  onProgress({ stage: "loader", label: "Preparing the base client", current: 0, total: 1, done: false });
  await ensureBaseJar(gameDir, minecraft);

  const base = await resolveVersionJson(gameDir, minecraft);
  const javaPath = await requireJava(base.javaVersion?.majorVersion ?? 8);

  if (loader === "optifine") {
    return installOptifine({ gameDir, minecraft, fileName: version, javaPath, onProgress });
  }

  return installForgeLike({ flavor: loader, gameDir, minecraft, version, javaPath, onProgress });
}
