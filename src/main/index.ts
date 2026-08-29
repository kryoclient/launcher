import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import type { ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  InstalledVersion,
  JavaInfo,
  LauncherState,
  Profile,
  Progress,
  ServerEntry,
  Settings,
  VersionSummary
} from "../shared/types";
import { AccountStore } from "./auth/accounts";
import {
  AuthError,
  authenticateWithXbox,
  fetchProfile,
  hasGameLicense,
  pollForTokens,
  requestDeviceCode
} from "./auth/microsoft";
import { findJavaInstallations, probeJava } from "./java";
import { downloadJava, managedJava } from "./javaProvision";
import { installFabric, installVersion, loadManifest, resolveVersionJson, versionJarPath } from "./install";
import { instanceDir, launchGame } from "./launch";
import { deleteMod, installMod, listMods, searchMods, toggleMod } from "./mods";
import { pingAll } from "./serverPing";
import { Store } from "./store";
import { checkForUpdates, currentUpdateStatus, installUpdate } from "./updater";

const POPULAR_SERVERS: ServerEntry[] = [
  { name: "Hypixel", address: "mc.hypixel.net", tag: "minigames · skyblock" },
  { name: "2b2t", address: "2b2t.org", tag: "anarchy" },
  { name: "MCCentral", address: "mccentral.org", tag: "survival · prison" },
  { name: "Mineplex", address: "us.mineplex.com", tag: "minigames" }
];

let window: BrowserWindow | null = null;
let store: Store;
let accounts: AccountStore;
let running: ChildProcess | null = null;
let authCancelled = false;

function send(channel: string, payload: unknown): void {
  window?.webContents.send(channel, payload);
}

function logFile(): string {
  const dir = join(app.getPath("userData"), "logs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "launcher.log");
}

function log(line: string): void {
  try {
    const flat = line.replace(/\s+/g, " ").trim();
    const trimmed = flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
    appendFileSync(logFile(), `[${new Date().toISOString()}] ${trimmed}\n`, "utf8");
  } catch {
    /* logging must never break the launcher */
  }
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: "#080a0c",
    title: "KRYO Client",
    icon: join(__dirname, "..", "..", "build", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.loadFile(join(__dirname, "..", "renderer", "index.html"));
  window.once("ready-to-show", () => window?.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.on("closed", () => {
    window = null;
  });
}

function state(): LauncherState {
  return {
    accounts: accounts.list(),
    activeAccountId: accounts.active()?.id ?? null,
    profiles: store.profiles(),
    activeProfileId: store.activeProfileId(),
    settings: store.settings()
  };
}

function installedVersions(): InstalledVersion[] {
  const dir = join(store.gameDir(), "versions");
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((id) => existsSync(join(dir, id, `${id}.json`)))
    .map((id) => {
      const jar = versionJarPath(store.gameDir(), id);
      const sizeMb = existsSync(jar) ? Math.round(statSync(jar).size / 104857.6) / 10 : 0;
      return { id, installedAt: statSync(join(dir, id)).mtimeMs, sizeMb };
    })
    .sort((a, b) => b.installedAt - a.installedAt);
}

function requireProfile(profileId: string): Profile {
  const profile = store.profiles().find((p) => p.id === profileId);
  if (!profile) throw new Error("Profile not found");
  return profile;
}

async function ensureVersion(profile: Profile): Promise<string> {
  if (!profile.versionId) throw new Error("Pick a Minecraft version first");
  if (profile.loader === "fabric") return installFabric(store.gameDir(), profile.versionId);
  return profile.versionId;
}

async function resolveJavaPath(profile: Profile, requiredMajor: number): Promise<string> {
  if (profile.javaPath) {
    const probed = await probeJava(profile.javaPath);
    if (probed) return probed.path;
  }

  const managed = managedJava(store.gameDir(), requiredMajor);
  if (managed) {
    const probed = await probeJava(managed);
    if (probed) return probed.path;
  }

  const installations = await findJavaInstallations();
  const exact = installations.find((j) => j.major === requiredMajor);
  if (exact) return exact.path;

  const newer = installations.find((j) => j.major > requiredMajor);
  if (newer) return newer.path;

  if (!store.settings().managedJava) {
    throw new Error(
      `Java ${requiredMajor} is required but not installed. Enable managed Java in Settings or set a path yourself.`
    );
  }

  const downloaded = await downloadJava(store.gameDir(), requiredMajor, (progress) => send("game:progress", progress));
  return downloaded.path;
}

function registerHandlers(): void {
  ipcMain.handle("state:get", () => state());

  ipcMain.handle("account:addOffline", (_event, username: string) => {
    accounts.addOffline(username);
    return state();
  });

  ipcMain.handle("account:select", (_event, id: string) => {
    accounts.setActive(id);
    return state();
  });

  ipcMain.handle("account:remove", (_event, id: string) => {
    accounts.remove(id);
    return state();
  });

  ipcMain.handle("auth:cancel", () => {
    authCancelled = true;
    return true;
  });

  ipcMain.handle("auth:microsoft", async () => {
    const clientId = store.settings().azureClientId.trim();
    if (!clientId) {
      throw new AuthError(
        "client-id",
        "Add your Azure application (client) ID in Settings first — see the README for the two-minute setup."
      );
    }

    authCancelled = false;

    const { prompt, deviceCode, interval } = await requestDeviceCode(clientId);
    send("auth:prompt", prompt);

    const tokens = await pollForTokens(clientId, deviceCode, interval, prompt.expiresIn, () => authCancelled);
    const session = await authenticateWithXbox(tokens.accessToken);

    const licensed = await hasGameLicense(session.accessToken);
    if (!licensed) {
      throw new AuthError(
        "no-license",
        "This Microsoft account does not own Minecraft Java Edition. Buy the game or use offline mode."
      );
    }

    const profile = await fetchProfile(session.accessToken);
    accounts.addMicrosoft(profile, tokens.refreshToken, session.accessToken, session.expiresAt, session.xuid);
    log(`microsoft account linked: ${profile.name}`);

    return state();
  });

  ipcMain.handle("account:setSkin", async (_event, accountId: string, variant: "classic" | "slim") => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Skin", extensions: ["png"] }]
    });

    if (result.canceled) return state();

    await accounts.applySkin(accountId, store.settings().azureClientId.trim(), result.filePaths[0], variant);
    return state();
  });

  ipcMain.handle("account:setCape", async (_event, accountId: string, capeId: string | null) => {
    await accounts.applyCape(accountId, store.settings().azureClientId.trim(), capeId);
    return state();
  });

  ipcMain.handle("profiles:create", (_event, patch: Partial<Profile>) => {
    store.createProfile(patch);
    return state();
  });
  ipcMain.handle("profiles:update", (_event, id: string, patch: Partial<Profile>) => {
    store.updateProfile(id, patch);
    return state();
  });
  ipcMain.handle("profiles:delete", (_event, id: string) => {
    store.deleteProfile(id);
    return state();
  });
  ipcMain.handle("profiles:select", (_event, id: string) => {
    store.setActiveProfile(id);
    return state();
  });

  ipcMain.handle("settings:update", (_event, patch: Partial<Settings>) => {
    store.updateSettings(patch);
    return state();
  });

  ipcMain.handle("versions:list", async (): Promise<VersionSummary[]> => {
    const manifest = await loadManifest();
    const showSnapshots = store.settings().showSnapshots;
    return manifest.versions
      .filter((v) => showSnapshots || v.type === "release")
      .slice(0, 260)
      .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
  });

  ipcMain.handle("versions:installed", () => installedVersions());

  ipcMain.handle("java:list", async (): Promise<JavaInfo[]> => {
    const found = await findJavaInstallations();
    const runtimes: JavaInfo[] = [...found];

    for (const major of [8, 17, 21]) {
      const path = managedJava(store.gameDir(), major);
      if (!path) continue;
      const probed = await probeJava(path);
      if (probed && !runtimes.some((r) => r.path === probed.path)) {
        runtimes.push({ ...probed, managed: true });
      }
    }

    return runtimes;
  });

  ipcMain.handle("java:download", async (_event, major: number) => {
    const info = await downloadJava(store.gameDir(), major, (progress) => send("game:progress", progress));
    return info;
  });

  ipcMain.handle("servers:list", () => POPULAR_SERVERS);
  ipcMain.handle("servers:ping", (_event, addresses: string[]) => pingAll(addresses));

  ipcMain.handle("mods:list", (_event, profileId: string) => listMods(store.gameDir(), profileId));
  ipcMain.handle("mods:toggle", (_event, profileId: string, file: string) =>
    toggleMod(store.gameDir(), profileId, file)
  );
  ipcMain.handle("mods:delete", (_event, profileId: string, file: string) =>
    deleteMod(store.gameDir(), profileId, file)
  );
  ipcMain.handle("mods:search", (_event, query: string, gameVersion: string) => searchMods(query, gameVersion));
  ipcMain.handle("mods:install", (_event, profileId: string, projectId: string, gameVersion: string) =>
    installMod(store.gameDir(), profileId, projectId, gameVersion)
  );

  ipcMain.handle("game:install", async (_event, profileId: string) => {
    const profile = requireProfile(profileId);
    const versionId = await ensureVersion(profile);
    const version = await installVersion(store.gameDir(), versionId, (progress: Progress) =>
      send("game:progress", progress)
    );
    await resolveJavaPath(profile, version.javaVersion?.majorVersion ?? 8);
    return installedVersions();
  });

  ipcMain.handle("game:launch", async (_event, profileId: string) => {
    if (running) throw new Error("Minecraft is already running");

    const profile = requireProfile(profileId);
    const active = accounts.active();
    if (!active) throw new Error("Add an account first");

    const clientId = store.settings().azureClientId.trim();
    const { account, accessToken } = await accounts.sessionFor(active.id, clientId);

    const versionId = await ensureVersion(profile);
    const version = await installVersion(store.gameDir(), versionId, (progress) => send("game:progress", progress));

    const javaPath = await resolveJavaPath(profile, version.javaVersion?.majorVersion ?? 8);
    const resolved = await resolveVersionJson(store.gameDir(), versionId);

    send("game:progress", { stage: "launching", label: "Starting Minecraft", current: 1, total: 1, done: false });
    log(`launching ${versionId} as ${account.username} (${account.type})`);

    running = launchGame(
      { gameDir: store.gameDir(), profile, account, accessToken, javaPath, version: resolved },
      (line) => send("game:log", line),
      (code) => {
        running = null;
        log(`minecraft exited with code ${code}`);
        send("game:exit", code);
        if (!store.settings().keepLauncherOpen) window?.show();
      }
    );

    store.markPlayed(profile.id);
    send("game:progress", { stage: "running", label: "Minecraft is running", current: 1, total: 1, done: true });

    if (!store.settings().keepLauncherOpen) window?.minimize();
    return true;
  });

  ipcMain.handle("game:kill", () => {
    running?.kill();
    running = null;
    return true;
  });

  ipcMain.handle("dialog:pickFolder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:pickJava", async () => {
    const filters =
      process.platform === "win32" ? [{ name: "Java", extensions: ["exe"] }] : [{ name: "Java", extensions: ["*"] }];
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("shell:openGameDir", (_event, profileId: string | null) => {
    const target = profileId ? instanceDir(store.gameDir(), profileId) : store.gameDir();
    void shell.openPath(target);
    return target;
  });

  ipcMain.handle("shell:openLogs", () => {
    void shell.openPath(join(app.getPath("userData"), "logs"));
    return true;
  });

  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return true;
  });

  ipcMain.handle("clipboard:write", async (_event, text: string) => {
    const { clipboard } = await import("electron");
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle("update:status", () => currentUpdateStatus());

  ipcMain.handle("update:check", () =>
    checkForUpdates((status) => send("update:status", status), log)
  );

  ipcMain.handle("update:install", () => {
    installUpdate();
    return true;
  });

  ipcMain.handle("window:minimize", () => window?.minimize());
  ipcMain.handle("window:maximize", () => {
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle("window:close", () => window?.close());
}

app.whenReady().then(() => {
  store = new Store();
  accounts = new AccountStore();
  registerHandlers();
  createWindow();
  log("launcher started");
  setTimeout(() => void checkForUpdates((status) => send("update:status", status), log), 4000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  running?.kill();
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (error) => {
  log(`uncaught: ${error.stack ?? error.message}`);
});
