import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ModEntry, ModrinthHit } from "../shared/types";
import { downloadFile, fetchJson } from "./mojang";

const MODRINTH = "https://api.modrinth.com/v2";

interface SearchResponse {
  hits: {
    project_id: string;
    slug: string;
    title: string;
    description: string;
    downloads: number;
    categories: string[];
    icon_url: string | null;
  }[];
}

interface ProjectVersion {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: { url: string; filename: string; primary: boolean; hashes: { sha1?: string }; size: number }[];
}

export function modsDir(gameDir: string, profileId: string): string {
  const dir = join(gameDir, "instances", profileId, "mods");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function listMods(gameDir: string, profileId: string): ModEntry[] {
  const dir = modsDir(gameDir, profileId);

  return readdirSync(dir)
    .filter((file) => file.endsWith(".jar") || file.endsWith(".jar.disabled"))
    .map((file) => {
      const enabled = file.endsWith(".jar");
      const base = enabled ? file.slice(0, -4) : file.slice(0, -13);
      return {
        fileName: file,
        name: base.replace(/[-_]/g, " "),
        enabled,
        sizeKb: Math.round(statSync(join(dir, file)).size / 1024)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function toggleMod(gameDir: string, profileId: string, fileName: string): ModEntry[] {
  const dir = modsDir(gameDir, profileId);
  const source = join(dir, fileName);
  if (!existsSync(source)) return listMods(gameDir, profileId);

  const target = fileName.endsWith(".jar.disabled")
    ? join(dir, fileName.slice(0, -9))
    : join(dir, `${fileName}.disabled`);

  renameSync(source, target);
  return listMods(gameDir, profileId);
}

export function deleteMod(gameDir: string, profileId: string, fileName: string): ModEntry[] {
  const target = join(modsDir(gameDir, profileId), fileName);
  if (existsSync(target)) unlinkSync(target);
  return listMods(gameDir, profileId);
}

export async function searchMods(query: string, gameVersion: string): Promise<ModrinthHit[]> {
  const facets = JSON.stringify([["project_type:mod"], ["categories:fabric"], [`versions:${gameVersion}`]]);
  const url = `${MODRINTH}/search?query=${encodeURIComponent(query)}&limit=20&index=relevance&facets=${encodeURIComponent(facets)}`;

  const response = await fetchJson<SearchResponse>(url);

  return response.hits.map((hit) => ({
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    downloads: hit.downloads,
    categories: hit.categories.slice(0, 3),
    iconUrl: hit.icon_url
  }));
}

export async function installMod(
  gameDir: string,
  profileId: string,
  projectId: string,
  gameVersion: string
): Promise<ModEntry[]> {
  const versions = await fetchJson<ProjectVersion[]>(
    `${MODRINTH}/project/${projectId}/version?loaders=["fabric"]&game_versions=["${gameVersion}"]`
  );

  const version = versions[0];
  if (!version) throw new Error(`No Fabric build of this mod for Minecraft ${gameVersion}`);

  const file = version.files.find((f) => f.primary) ?? version.files[0];
  if (!file) throw new Error("Mod version has no downloadable file");

  await downloadFile(file.url, join(modsDir(gameDir, profileId), file.filename), file.hashes.sha1, file.size);
  return listMods(gameDir, profileId);
}
