import { BUNDLED_CHANGELOG } from "../shared/changelog";
import type { ReleaseEntry } from "../shared/types";

const RELEASES_API = "https://api.github.com/repos/kryoclient/launcher/releases?per_page=40";
const CACHE_MS = 600_000;

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: GithubAsset[];
}

let cache: { at: number; entries: ReleaseEntry[] } | null = null;

const NOISE = /\.(blockmap|yml)$/i;

function toEntry(release: GithubRelease): ReleaseEntry {
  const version = release.tag_name.replace(/^v/, "");

  return {
    tag: release.tag_name,
    version,
    name: release.name?.trim() || `KRYO Client ${version}`,
    channel: release.prerelease ? "beta" : "stable",
    publishedAt: (release.published_at ?? "").slice(0, 10),
    notes: (release.body ?? "").trim(),
    url: release.html_url,
    bundled: false,
    assets: release.assets
      .filter((asset) => !NOISE.test(asset.name))
      .map((asset) => ({
        name: asset.name,
        sizeMb: Math.round(asset.size / 104857.6) / 10,
        url: asset.browser_download_url
      }))
  };
}

function merge(live: ReleaseEntry[]): ReleaseEntry[] {
  const byTag = new Map<string, ReleaseEntry>();

  for (const entry of BUNDLED_CHANGELOG) byTag.set(entry.tag, entry);

  for (const entry of live) {
    const bundled = byTag.get(entry.tag);
    byTag.set(entry.tag, {
      ...entry,
      notes: entry.notes || bundled?.notes || "",
      publishedAt: entry.publishedAt || bundled?.publishedAt || ""
    });
  }

  return [...byTag.values()].sort((a, b) => b.tag.localeCompare(a.tag, "en", { numeric: true }));
}

export async function listReleases(refresh: boolean): Promise<ReleaseEntry[]> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.entries;

  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "KryoClient/1.0" }
    });

    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

    const payload = (await response.json()) as GithubRelease[];
    const entries = merge(payload.filter((release) => !release.draft).map(toEntry));

    cache = { at: Date.now(), entries };
    return entries;
  } catch {
    return cache?.entries ?? merge([]);
  }
}
