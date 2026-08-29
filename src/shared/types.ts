export interface Profile {
  id: string;
  name: string;
  versionId: string;
  loader: "vanilla" | "fabric";
  memoryMb: number;
  javaPath: string | null;
  jvmArgs: string;
  fullscreen: boolean;
  width: number;
  height: number;
  lastPlayed: number | null;
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

export interface DeviceCodePrompt {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  message: string;
}

export interface UpdateStatus {
  state: "idle" | "dev" | "checking" | "current" | "downloading" | "ready" | "error";
  version: string;
  newVersion?: string;
  percent?: number;
  message?: string;
}
