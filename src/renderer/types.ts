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

export interface Progress {
  stage: string;
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

export interface KryoApi {
  getState(): Promise<LauncherState>;
  addOfflineAccount(username: string): Promise<LauncherState>;
  linkMicrosoft(): Promise<LauncherState>;
  cancelAuth(): Promise<boolean>;
  selectAccount(id: string): Promise<LauncherState>;
  removeAccount(id: string): Promise<LauncherState>;
  setSkin(accountId: string, variant: "classic" | "slim"): Promise<LauncherState>;
  setCape(accountId: string, capeId: string | null): Promise<LauncherState>;
  createProfile(patch: Partial<Profile>): Promise<LauncherState>;
  updateProfile(id: string, patch: Partial<Profile>): Promise<LauncherState>;
  deleteProfile(id: string): Promise<LauncherState>;
  selectProfile(id: string): Promise<LauncherState>;
  updateSettings(patch: Partial<Settings>): Promise<LauncherState>;
  listVersions(): Promise<VersionSummary[]>;
  listInstalled(): Promise<InstalledVersion[]>;
  listJava(): Promise<JavaInfo[]>;
  downloadJava(major: number): Promise<JavaInfo>;
  listServers(): Promise<ServerEntry[]>;
  pingServers(addresses: string[]): Promise<ServerStatus[]>;
  listMods(profileId: string): Promise<ModEntry[]>;
  toggleMod(profileId: string, file: string): Promise<ModEntry[]>;
  deleteMod(profileId: string, file: string): Promise<ModEntry[]>;
  searchMods(query: string, gameVersion: string): Promise<ModrinthHit[]>;
  installMod(profileId: string, projectId: string, gameVersion: string): Promise<ModEntry[]>;
  install(profileId: string): Promise<InstalledVersion[]>;
  launch(profileId: string): Promise<boolean>;
  kill(): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  pickJava(): Promise<string | null>;
  openGameDir(profileId: string | null): Promise<string>;
  openLogs(): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  copy(text: string): Promise<boolean>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
  onProgress(handler: (progress: Progress) => void): void;
  onLog(handler: (line: string) => void): void;
  onExit(handler: (code: number | null) => void): void;
  updateStatus(): Promise<UpdateStatus>;
  checkUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<boolean>;
  onUpdateStatus(handler: (status: UpdateStatus) => void): void;
  onAuthPrompt(handler: (prompt: DeviceCodePrompt) => void): void;
}

declare global {
  interface Window {
    kryo: KryoApi;
  }
}

export interface UpdateStatus {
  state: "idle" | "dev" | "checking" | "current" | "downloading" | "ready" | "error";
  version: string;
  newVersion?: string;
  percent?: number;
  message?: string;
}
