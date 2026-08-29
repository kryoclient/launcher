import AdmZip from "adm-zip";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import type { LoaderVersion, Progress } from "../../shared/types";
import { versionDir, versionJarPath, versionJsonPath } from "../install";
import { downloadFile, fetchJson, libraryPath, sha1File, type Library, type VersionJson } from "../mojang";

const FORGE_INDEX = "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json";
const FORGE_PROMOS = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const FORGE_MAVEN = "https://maven.minecraftforge.net";
const NEO_MAVEN = "https://maven.neoforged.net/releases";
const NEO_API = "https://maven.neoforged.net/api/maven/versions/releases";

export type ForgeFlavor = "forge" | "neoforge";

interface ProcessorSpec {
  sides?: string[];
  jar: string;
  classpath: string[];
  args: string[];
  outputs?: Record<string, string>;
}

interface InstallProfile {
  spec?: number;
  version?: string;
  json?: string;
  minecraft?: string;
  libraries?: Library[];
  data?: Record<string, { client: string; server: string }>;
  processors?: ProcessorSpec[];
  install?: { path: string; filePath: string; target: string; minecraft: string };
  versionInfo?: VersionJson;
}

function librariesDir(gameDir: string): string {
  return join(gameDir, "libraries");
}

function coordPath(gameDir: string, coord: string): string {
  return join(librariesDir(gameDir), libraryPath(coord));
}

function neoPrefix(minecraft: string): string | null {
  const match = minecraft.match(/^1\.(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  return `${match[1]}.${match[2] ?? "0"}.`;
}

export async function forgeVersions(minecraft: string): Promise<LoaderVersion[]> {
  const index = await fetchJson<Record<string, string[]>>(FORGE_INDEX);
  const builds = index[minecraft];
  if (!builds || builds.length === 0) return [];

  let recommended = "";
  try {
    const promos = await fetchJson<{ promos: Record<string, string> }>(FORGE_PROMOS);
    recommended = promos.promos[`${minecraft}-recommended`] ?? promos.promos[`${minecraft}-latest`] ?? "";
  } catch {
    recommended = "";
  }

  return [...builds].reverse().map((build) => {
    const short = build.replace(`${minecraft}-`, "");
    const isRecommended = Boolean(recommended) && short.split("-")[0] === recommended;
    return { id: build, label: short, stable: true, recommended: isRecommended };
  });
}

export async function neoforgeVersions(minecraft: string): Promise<LoaderVersion[]> {
  if (minecraft === "1.20.1") {
    const legacy = await fetchJson<{ versions: string[] }>(`${NEO_API}/net/neoforged/forge`);
    return legacy.versions
      .filter((version) => version.startsWith("1.20.1-"))
      .reverse()
      .map((version) => ({
        id: version,
        label: version.replace("1.20.1-", ""),
        stable: !version.includes("beta"),
        recommended: false
      }));
  }

  const prefix = neoPrefix(minecraft);
  if (!prefix) return [];

  const listing = await fetchJson<{ versions: string[] }>(`${NEO_API}/net/neoforged/neoforge`);

  return listing.versions
    .filter((version) => version.startsWith(prefix))
    .reverse()
    .map((version) => ({
      id: version,
      label: version,
      stable: !version.includes("beta"),
      recommended: false
    }));
}

function installerUrl(flavor: ForgeFlavor, minecraft: string, version: string): string {
  if (flavor === "forge") {
    return `${FORGE_MAVEN}/net/minecraftforge/forge/${version}/forge-${version}-installer.jar`;
  }
  if (minecraft === "1.20.1") {
    return `${NEO_MAVEN}/net/neoforged/forge/${version}/forge-${version}-installer.jar`;
  }
  return `${NEO_MAVEN}/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
}

function consoleJava(javaPath: string): string {
  if (/javaw\.exe$/i.test(javaPath)) return javaPath.replace(/javaw\.exe$/i, "java.exe");
  if (/javaw$/.test(javaPath)) return javaPath.replace(/javaw$/, "java");
  return javaPath;
}

function mainClassOf(jar: string): string {
  const manifest = new AdmZip(jar)
    .readAsText("META-INF/MANIFEST.MF")
    .replace(/\r\n /g, "")
    .replace(/\n /g, "");
  const match = manifest.match(/Main-Class:\s*(\S+)/);
  if (!match) throw new Error(`No Main-Class in ${jar}`);
  return match[1];
}

async function downloadInstallLibraries(
  gameDir: string,
  libraries: Library[],
  onProgress: (progress: Progress) => void
): Promise<void> {
  let done = 0;

  for (const library of libraries) {
    const artifact = library.downloads?.artifact;
    const relative = artifact?.path ?? libraryPath(library.name);
    const target = join(librariesDir(gameDir), relative);

    done += 1;
    onProgress({
      stage: "loader",
      label: "Downloading loader libraries",
      current: done,
      total: libraries.length,
      done: false
    });

    if (existsSync(target)) continue;

    const base = library.url ? library.url.replace(/\/$/, "") : "";
    const url = artifact?.url || (base ? `${base}/${relative.split("\\").join("/")}` : "");
    if (!url) continue;

    try {
      await downloadFile(url, target, artifact?.sha1, artifact?.size);
    } catch (error) {
      if (artifact?.sha1) throw error;
    }
  }
}

function extractTo(zip: AdmZip, entryName: string, target: string): boolean {
  const entry = zip.getEntry(entryName.replace(/^\//, ""));
  if (!entry) return false;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, entry.getData());
  return true;
}

function unpackBundledMaven(zip: AdmZip, gameDir: string): void {
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.startsWith("maven/")) continue;

    const target = join(librariesDir(gameDir), entry.entryName.slice("maven/".length));
    if (existsSync(target)) continue;

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.getData());
  }
}

function buildData(
  profile: InstallProfile,
  zip: AdmZip,
  gameDir: string,
  installerPath: string,
  minecraft: string
): Record<string, string> {
  const scratch = join(gameDir, "installers", "extracted");

  const data: Record<string, string> = {
    SIDE: "client",
    ROOT: gameDir,
    INSTALLER: installerPath,
    LIBRARY_DIR: librariesDir(gameDir),
    MINECRAFT_JAR: versionJarPath(gameDir, minecraft),
    MINECRAFT_VERSION: minecraft
  };

  for (const [key, value] of Object.entries(profile.data ?? {})) {
    const raw = value.client;
    if (!raw) continue;

    if (raw.startsWith("[") && raw.endsWith("]")) {
      data[key] = coordPath(gameDir, raw.slice(1, -1));
    } else if (raw.startsWith("'") && raw.endsWith("'")) {
      data[key] = raw.slice(1, -1);
    } else if (raw.startsWith("/")) {
      const target = join(scratch, raw.slice(1));
      extractTo(zip, raw, target);
      data[key] = target;
    } else {
      data[key] = raw;
    }
  }

  return data;
}

function resolveArgument(argument: string, gameDir: string, data: Record<string, string>): string {
  if (argument.startsWith("[") && argument.endsWith("]")) {
    return coordPath(gameDir, argument.slice(1, -1));
  }
  return argument.replace(/\{([A-Z0-9_]+)\}/g, (match, key: string) => data[key] ?? match);
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
      const detail = tail.trim().split("\n").slice(-3).join(" ");
      reject(new Error(`Loader installer step failed (exit ${code}). ${detail}`));
    });
  });
}

function outputsSatisfied(processor: ProcessorSpec, gameDir: string, data: Record<string, string>): boolean {
  const outputs = Object.entries(processor.outputs ?? {});
  if (outputs.length === 0) return false;

  for (const [rawPath, rawHash] of outputs) {
    const path = resolveArgument(rawPath, gameDir, data);
    const hash = resolveArgument(rawHash, gameDir, data);
    if (!existsSync(path)) return false;
    if (hash && /^[0-9a-f]{40}$/i.test(hash) && sha1File(path) !== hash) return false;
  }

  return true;
}

export async function installForgeLike(options: {
  flavor: ForgeFlavor;
  gameDir: string;
  minecraft: string;
  version: string;
  javaPath: string;
  onProgress: (progress: Progress) => void;
}): Promise<string> {
  const { flavor, gameDir, minecraft, version, javaPath, onProgress } = options;

  onProgress({ stage: "loader", label: `Fetching ${flavor} ${version}`, current: 0, total: 1, done: false });

  const installerPath = join(gameDir, "installers", `${flavor}-${version}-installer.jar`);
  await downloadFile(installerUrl(flavor, minecraft, version), installerPath);

  const zip = new AdmZip(installerPath);
  const profileEntry = zip.getEntry("install_profile.json");
  if (!profileEntry) throw new Error(`${flavor} ${version} ships no install profile`);

  const profile = JSON.parse(profileEntry.getData().toString("utf8")) as InstallProfile;

  if (profile.install && profile.versionInfo) {
    const versionId = profile.versionInfo.id ?? profile.install.target;
    mkdirSync(versionDir(gameDir, versionId), { recursive: true });
    writeFileSync(versionJsonPath(gameDir, versionId), JSON.stringify(profile.versionInfo, null, 2), "utf8");

    if (profile.install.filePath && profile.install.path) {
      extractTo(zip, profile.install.filePath, coordPath(gameDir, profile.install.path));
    }

    return versionId;
  }

  if (!profile.json) throw new Error(`${flavor} ${version} uses an unsupported installer layout`);

  const versionEntry = zip.getEntry(profile.json.replace(/^\//, ""));
  if (!versionEntry) throw new Error(`${flavor} ${version} carries no version metadata`);

  const versionJson = JSON.parse(versionEntry.getData().toString("utf8")) as VersionJson;
  if (!versionJson.id) throw new Error(`${flavor} ${version} carries no version id`);

  mkdirSync(versionDir(gameDir, versionJson.id), { recursive: true });
  writeFileSync(versionJsonPath(gameDir, versionJson.id), JSON.stringify(versionJson, null, 2), "utf8");

  unpackBundledMaven(zip, gameDir);
  await downloadInstallLibraries(gameDir, profile.libraries ?? [], onProgress);

  const data = buildData(profile, zip, gameDir, installerPath, minecraft);
  const processors = (profile.processors ?? []).filter(
    (processor) => !processor.sides || processor.sides.includes("client")
  );

  const java = consoleJava(javaPath);
  let step = 0;

  for (const processor of processors) {
    step += 1;
    onProgress({
      stage: "loader",
      label: `Building ${flavor} ${version}`,
      current: step,
      total: processors.length,
      done: false
    });

    if (outputsSatisfied(processor, gameDir, data)) continue;

    const jar = coordPath(gameDir, processor.jar);
    if (!existsSync(jar)) throw new Error(`Installer library ${processor.jar} is missing`);

    const classpath = [...processor.classpath.map((entry) => coordPath(gameDir, entry)), jar].join(delimiter);
    const args = processor.args.map((argument) => resolveArgument(argument, gameDir, data));

    await runJava(java, ["-cp", classpath, mainClassOf(jar), ...args], gameDir);
  }

  return versionJson.id;
}
