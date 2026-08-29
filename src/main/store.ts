import { app } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Profile, Settings } from "../shared/types";

const CONFIG_NAME = "kryo-config.json";

interface ConfigFile {
  profiles: Profile[];
  activeProfileId: string | null;
  settings: Settings;
}

function defaultGameDir(): string {
  return join(app.getPath("appData"), ".kryo");
}

function defaultSettings(): Settings {
  return {
    gameDir: defaultGameDir(),
    keepLauncherOpen: false,
    showSnapshots: false,
    telemetry: false,
    azureClientId: "",
    managedJava: true
  };
}

function defaultProfile(): Profile {
  return {
    id: randomUUID(),
    name: "Default",
    versionId: "",
    loader: "vanilla",
    memoryMb: 4096,
    javaPath: null,
    jvmArgs: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions",
    fullscreen: false,
    width: 1280,
    height: 720,
    lastPlayed: null
  };
}

function defaultConfig(): ConfigFile {
  const profile = defaultProfile();
  return { profiles: [profile], activeProfileId: profile.id, settings: defaultSettings() };
}

export function offlineUuid(username: string): string {
  const hash = createHash("md5").update(`OfflinePlayer:${username}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class Store {
  private config: ConfigFile;
  private readonly file: string;

  constructor() {
    const dir = app.getPath("userData");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.file = join(dir, CONFIG_NAME);
    this.config = this.load();
  }

  private load(): ConfigFile {
    if (!existsSync(this.file)) {
      const fresh = defaultConfig();
      writeFileSync(this.file, JSON.stringify(fresh, null, 2), "utf8");
      return fresh;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<ConfigFile>;
      const base = defaultConfig();
      const template = defaultProfile();

      const profiles = (parsed.profiles?.length ? parsed.profiles : base.profiles).map((profile) => ({
        ...template,
        ...profile,
        id: profile.id ?? randomUUID()
      }));

      const config: ConfigFile = {
        profiles,
        activeProfileId: parsed.activeProfileId ?? profiles[0]?.id ?? null,
        settings: { ...base.settings, ...parsed.settings }
      };

      if (!config.profiles.some((p) => p.id === config.activeProfileId)) {
        config.activeProfileId = config.profiles[0]?.id ?? null;
      }

      return config;
    } catch {
      return defaultConfig();
    }
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.config, null, 2), "utf8");
  }

  profiles(): Profile[] {
    return this.config.profiles;
  }

  activeProfileId(): string | null {
    return this.config.activeProfileId;
  }

  settings(): Settings {
    return this.config.settings;
  }

  activeProfile(): Profile | null {
    return this.config.profiles.find((p) => p.id === this.config.activeProfileId) ?? null;
  }

  setActiveProfile(id: string): void {
    if (!this.config.profiles.some((p) => p.id === id)) return;
    this.config.activeProfileId = id;
    this.persist();
  }

  createProfile(input: Partial<Profile>): Profile {
    const profile: Profile = { ...defaultProfile(), ...input, id: randomUUID() };
    this.config.profiles.push(profile);
    this.config.activeProfileId = profile.id;
    this.persist();
    return profile;
  }

  updateProfile(id: string, patch: Partial<Profile>): Profile | null {
    const profile = this.config.profiles.find((p) => p.id === id);
    if (!profile) return null;
    Object.assign(profile, patch, { id: profile.id });
    this.persist();
    return profile;
  }

  deleteProfile(id: string): void {
    if (this.config.profiles.length <= 1) return;
    this.config.profiles = this.config.profiles.filter((p) => p.id !== id);
    if (this.config.activeProfileId === id) this.config.activeProfileId = this.config.profiles[0].id;
    this.persist();
  }

  markPlayed(id: string): void {
    const profile = this.config.profiles.find((p) => p.id === id);
    if (!profile) return;
    profile.lastPlayed = Date.now();
    this.persist();
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.config.settings = { ...this.config.settings, ...patch };
    this.persist();
    return this.config.settings;
  }

  gameDir(): string {
    return this.config.settings.gameDir;
  }
}
