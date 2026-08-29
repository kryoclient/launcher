import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Account, Profile } from "../shared/types";
import { nativesDir, usableLibraries, versionJarPath } from "./install";
import { libraryPath, rulesAllow, type LibraryRule, type VersionJson } from "./mojang";

const LAUNCHER_NAME = "KryoClient";
const LAUNCHER_VERSION = "1.0";

type ArgumentEntry = string | { rules: LibraryRule[]; value: string | string[] };

function classpath(gameDir: string, version: VersionJson): string {
  const entries: string[] = [];

  for (const lib of usableLibraries(version)) {
    if (lib.natives) continue;
    const relative = lib.downloads?.artifact?.path ?? libraryPath(lib.name);
    const full = join(gameDir, "libraries", relative);
    if (!entries.includes(full)) entries.push(full);
  }

  entries.push(versionJarPath(gameDir, version.inheritsFrom ?? version.id));
  return entries.join(delimiter);
}

function flatten(entries: ArgumentEntry[] | undefined, features: Record<string, boolean>): string[] {
  if (!entries) return [];
  const output: string[] = [];

  for (const entry of entries) {
    if (typeof entry === "string") {
      output.push(entry);
      continue;
    }
    if (!rulesAllow(entry.rules, features)) continue;
    if (Array.isArray(entry.value)) output.push(...entry.value);
    else output.push(entry.value);
  }

  return output;
}

function substitute(args: string[], values: Record<string, string>): string[] {
  return args.map((arg) =>
    arg.replace(/\$\{([^}]+)\}/g, (match, key: string) => (key in values ? values[key] : match))
  );
}

export interface LaunchOptions {
  gameDir: string;
  profile: Profile;
  account: Account;
  accessToken: string;
  javaPath: string;
  version: VersionJson;
}

export function instanceDir(gameDir: string, profileId: string): string {
  return join(gameDir, "instances", profileId);
}

export function buildCommand(options: LaunchOptions): { java: string; args: string[]; cwd: string } {
  const { gameDir, profile, account, accessToken, version, javaPath } = options;

  const cwd = instanceDir(gameDir, profile.id);
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(cwd, "mods"), { recursive: true });

  const natives = nativesDir(gameDir, version.inheritsFrom ?? version.id);
  const isMicrosoft = account.type === "microsoft";

  const values: Record<string, string> = {
    auth_player_name: account.username,
    auth_uuid: account.uuid.replace(/-/g, ""),
    auth_access_token: accessToken,
    auth_session: isMicrosoft ? `token:${accessToken}:${account.uuid.replace(/-/g, "")}` : "0",
    auth_xuid: account.xuid || "0",
    clientid: "0",
    user_type: isMicrosoft ? "msa" : "legacy",
    user_properties: "{}",
    version_name: version.id,
    version_type: version.type ?? "release",
    game_directory: cwd,
    assets_root: join(gameDir, "assets"),
    game_assets: join(gameDir, "assets", "virtual", "legacy"),
    assets_index_name: version.assetIndex.id,
    natives_directory: natives,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath: classpath(gameDir, version),
    library_directory: join(gameDir, "libraries"),
    classpath_separator: delimiter,
    resolution_width: String(profile.width),
    resolution_height: String(profile.height)
  };

  const features = {
    is_demo_user: false,
    has_custom_resolution: !profile.fullscreen,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  };

  const jvmArgs = version.arguments?.jvm
    ? substitute(flatten(version.arguments.jvm as ArgumentEntry[], features), values)
    : [`-Djava.library.path=${natives}`, "-cp", values.classpath];

  const gameArgs = version.arguments?.game
    ? substitute(flatten(version.arguments.game as ArgumentEntry[], features), values)
    : substitute((version.minecraftArguments ?? "").split(" ").filter(Boolean), values);

  if (profile.fullscreen && !gameArgs.includes("--fullscreen")) {
    gameArgs.push("--fullscreen");
  }

  const memory = Math.max(1024, profile.memoryMb);
  const custom = profile.jvmArgs.split(" ").map((a) => a.trim()).filter(Boolean);

  const args = [
    `-Xms${Math.min(1024, memory)}M`,
    `-Xmx${memory}M`,
    `-Dminecraft.launcher.brand=${LAUNCHER_NAME}`,
    `-Dminecraft.launcher.version=${LAUNCHER_VERSION}`,
    "-Dlog4j2.formatMsgNoLookups=true",
    ...custom,
    ...jvmArgs,
    version.mainClass,
    ...gameArgs
  ];

  if (process.platform === "darwin") args.unshift("-XstartOnFirstThread");

  return { java: javaPath, args, cwd };
}

export function launchGame(
  options: LaunchOptions,
  onLog: (line: string) => void,
  onExit: (code: number | null) => void
): ChildProcess {
  const { java, args, cwd } = buildCommand(options);

  if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });

  const child = spawn(java, args, { cwd, detached: false });

  child.stdout.on("data", (chunk: Buffer) => onLog(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => onLog(chunk.toString()));
  child.on("close", (code) => onExit(code));
  child.on("error", (error) => onLog(`launcher: ${error.message}\n`));

  return child;
}
