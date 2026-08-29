import { contextBridge, ipcRenderer } from "electron";
import type {
  DeviceCodePrompt,
  InstalledVersion,
  JavaInfo,
  LauncherState,
  ModEntry,
  ModrinthHit,
  Profile,
  Progress,
  ServerEntry,
  ServerStatus,
  Settings,
  UpdateStatus
} from "../shared/types";
import type { VersionSummary } from "../shared/types";

const api = {
  getState: (): Promise<LauncherState> => ipcRenderer.invoke("state:get"),

  addOfflineAccount: (username: string): Promise<LauncherState> =>
    ipcRenderer.invoke("account:addOffline", username),
  linkMicrosoft: (): Promise<LauncherState> => ipcRenderer.invoke("auth:microsoft"),
  cancelAuth: (): Promise<boolean> => ipcRenderer.invoke("auth:cancel"),
  selectAccount: (id: string): Promise<LauncherState> => ipcRenderer.invoke("account:select", id),
  removeAccount: (id: string): Promise<LauncherState> => ipcRenderer.invoke("account:remove", id),
  setSkin: (accountId: string, variant: "classic" | "slim"): Promise<LauncherState> =>
    ipcRenderer.invoke("account:setSkin", accountId, variant),
  setCape: (accountId: string, capeId: string | null): Promise<LauncherState> =>
    ipcRenderer.invoke("account:setCape", accountId, capeId),

  createProfile: (patch: Partial<Profile>): Promise<LauncherState> => ipcRenderer.invoke("profiles:create", patch),
  updateProfile: (id: string, patch: Partial<Profile>): Promise<LauncherState> =>
    ipcRenderer.invoke("profiles:update", id, patch),
  deleteProfile: (id: string): Promise<LauncherState> => ipcRenderer.invoke("profiles:delete", id),
  selectProfile: (id: string): Promise<LauncherState> => ipcRenderer.invoke("profiles:select", id),

  updateSettings: (patch: Partial<Settings>): Promise<LauncherState> => ipcRenderer.invoke("settings:update", patch),

  listVersions: (): Promise<VersionSummary[]> => ipcRenderer.invoke("versions:list"),
  listInstalled: (): Promise<InstalledVersion[]> => ipcRenderer.invoke("versions:installed"),
  listJava: (): Promise<JavaInfo[]> => ipcRenderer.invoke("java:list"),
  downloadJava: (major: number): Promise<JavaInfo> => ipcRenderer.invoke("java:download", major),
  listServers: (): Promise<ServerEntry[]> => ipcRenderer.invoke("servers:list"),
  pingServers: (addresses: string[]): Promise<ServerStatus[]> => ipcRenderer.invoke("servers:ping", addresses),

  listMods: (profileId: string): Promise<ModEntry[]> => ipcRenderer.invoke("mods:list", profileId),
  toggleMod: (profileId: string, file: string): Promise<ModEntry[]> =>
    ipcRenderer.invoke("mods:toggle", profileId, file),
  deleteMod: (profileId: string, file: string): Promise<ModEntry[]> =>
    ipcRenderer.invoke("mods:delete", profileId, file),
  searchMods: (query: string, gameVersion: string): Promise<ModrinthHit[]> =>
    ipcRenderer.invoke("mods:search", query, gameVersion),
  installMod: (profileId: string, projectId: string, gameVersion: string): Promise<ModEntry[]> =>
    ipcRenderer.invoke("mods:install", profileId, projectId, gameVersion),

  install: (profileId: string): Promise<InstalledVersion[]> => ipcRenderer.invoke("game:install", profileId),
  launch: (profileId: string): Promise<boolean> => ipcRenderer.invoke("game:launch", profileId),
  kill: (): Promise<boolean> => ipcRenderer.invoke("game:kill"),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:pickFolder"),
  pickJava: (): Promise<string | null> => ipcRenderer.invoke("dialog:pickJava"),
  openGameDir: (profileId: string | null): Promise<string> => ipcRenderer.invoke("shell:openGameDir", profileId),
  openLogs: (): Promise<boolean> => ipcRenderer.invoke("shell:openLogs"),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke("shell:openExternal", url),
  copy: (text: string): Promise<boolean> => ipcRenderer.invoke("clipboard:write", text),

  updateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke("update:status"),
  checkUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke("update:check"),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke("update:install"),

  minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  maximize: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
  close: (): Promise<void> => ipcRenderer.invoke("window:close"),

  onProgress: (handler: (progress: Progress) => void): void => {
    ipcRenderer.on("game:progress", (_event, progress: Progress) => handler(progress));
  },
  onLog: (handler: (line: string) => void): void => {
    ipcRenderer.on("game:log", (_event, line: string) => handler(line));
  },
  onExit: (handler: (code: number | null) => void): void => {
    ipcRenderer.on("game:exit", (_event, code: number | null) => handler(code));
  },
  onUpdateStatus: (handler: (status: UpdateStatus) => void): void => {
    ipcRenderer.on("update:status", (_event, status: UpdateStatus) => handler(status));
  },
  onAuthPrompt: (handler: (prompt: DeviceCodePrompt) => void): void => {
    ipcRenderer.on("auth:prompt", (_event, prompt: DeviceCodePrompt) => handler(prompt));
  }
};

export type KryoApi = typeof api;

contextBridge.exposeInMainWorld("kryo", api);
