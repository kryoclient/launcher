export type LoaderId = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge" | "optifine";

export interface LoaderInfo {
  id: LoaderId;
  name: string;
  tag: string;
  pickable: boolean;
}

export interface LoaderVersion {
  id: string;
  label: string;
  stable: boolean;
  recommended: boolean;
}

export interface Profile {
  id: string;
  name: string;
  versionId: string;
  loader: LoaderId;
  loaderVersion: string;
  memoryMb: number;
  javaPath: string | null;
  jvmArgs: string;
  fullscreen: boolean;
  width: number;
  height: number;
  lastPlayed: number | null;
}

export type StorageMode = "cache" | "game" | "java" | "all";

export interface StorageUsage {
  gameDir: string;
  versions: number;
  libraries: number;
  assets: number;
  runtime: number;
  instances: number;
  cache: number;
  launcher: number;
  total: number;
}

export interface AccountCape {
  id: string;
  name: string;
  url: string;
  active: boolean;
}

export interface Account {
  id: string;
  type: "offline" | "microsoft";
  username: string;
  uuid: string;
  skinUrl: string | null;
  capes: AccountCape[];
  activeCapeId: string | null;
  licensed: boolean;
  xuid: string;
}

export interface Settings {
  gameDir: string;
  keepLauncherOpen: boolean;
  showSnapshots: boolean;
  telemetry: boolean;
  azureClientId: string;
  managedJava: boolean;
}

export interface LauncherState {
  accounts: Account[];
  activeAccountId: string | null;
  profiles: Profile[];
  activeProfileId: string | null;
  settings: Settings;
}

export interface VersionSummary {
  id: string;
  type: string;
  releaseTime: string;
}

export interface InstalledVersion {
  id: string;
  installedAt: number;
  sizeMb: number;
}

export interface ModEntry {
  fileName: string;
  name: string;
  enabled: boolean;
  sizeKb: number;
}

export interface ModrinthHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  categories: string[];
  iconUrl: string | null;
}

export interface ServerEntry {
  name: string;
  address: string;
  tag: string;
}

export interface ServerStatus {
  address: string;
  online: boolean;
  players: number;
  maxPlayers: number;
  ping: number;
  motd: string;
  version: string;
}

export type TaskStage =
  | "idle"
  | "manifest"
  | "client"
  | "libraries"
  | "assets"
  | "natives"
  | "loader"
  | "java"
  | "launching"
  | "running";

export interface Progress {
  stage: TaskStage;
  label: string;
  current: number;
  total: number;
  done: boolean;
  error?: string;
}

export interface JavaInfo {
  path: string;
  version: string;
  major: number;
  managed?: boolean;
}

export interface ReleaseAsset {
  name: string;
  sizeMb: number;
  url: string;
}

export interface ReleaseEntry {
  tag: string;
  version: string;
  name: string;
  channel: "stable" | "beta";
  publishedAt: string;
  notes: string;
  url: string;
  assets: ReleaseAsset[];
  bundled: boolean;
}

export interface AuthPhase {
  phase: "browser" | "exchange";
  message: string;
}

export interface UpdateStatus {
  state: "idle" | "dev" | "checking" | "current" | "downloading" | "ready" | "error";
  version: string;
  newVersion?: string;
  percent?: number;
  message?: string;
}
