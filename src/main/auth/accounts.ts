import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Account, AccountCape } from "../../shared/types";
import { offlineUuid } from "../store";
import {
  AuthError,
  authenticateWithXbox,
  fetchProfile,
  flavorFor,
  hasGameLicense,
  refreshMicrosoftTokens,
  setActiveCape,
  uploadSkin,
  type AuthFlavor,
  type MinecraftProfile
} from "./microsoft";

const FILE_NAME = "kryo-accounts.json";
const SESSION_MARGIN_MS = 120_000;

interface StoredAccount {
  id: string;
  type: "offline" | "microsoft";
  username: string;
  uuid: string;
  secret?: string;
  accessToken?: string;
  accessExpiresAt?: number;
  xuid?: string;
  flavor?: AuthFlavor;
  skinUrl?: string | null;
  capes?: AccountCape[];
  activeCapeId?: string | null;
  addedAt: number;
}

interface AccountsFile {
  accounts: StoredAccount[];
  activeId: string | null;
}

function encrypt(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString("base64")}`;
  }
  return `raw:${Buffer.from(value, "utf8").toString("base64")}`;
}

function decrypt(value: string | undefined): string | null {
  if (!value) return null;
  try {
    if (value.startsWith("enc:")) {
      return safeStorage.decryptString(Buffer.from(value.slice(4), "base64"));
    }
    if (value.startsWith("raw:")) {
      return Buffer.from(value.slice(4), "base64").toString("utf8");
    }
  } catch {
    return null;
  }
  return null;
}

function dashedUuid(id: string): string {
  if (id.includes("-")) return id;
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function profileToCapes(profile: MinecraftProfile): AccountCape[] {
  return profile.capes.map((cape) => ({
    id: cape.id,
    name: cape.alias ?? "Cape",
    url: cape.url,
    active: cape.state === "ACTIVE"
  }));
}

export class AccountStore {
  private data: AccountsFile;
  private readonly file: string;

  constructor() {
    const dir = app.getPath("userData");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.file = join(dir, FILE_NAME);
    this.data = this.load();
    this.importLegacyAccount(dir);
  }

  private importLegacyAccount(dir: string): void {
    if (this.data.accounts.length > 0) return;

    const legacyFile = join(dir, "kryo-config.json");
    if (!existsSync(legacyFile)) return;

    try {
      const legacy = JSON.parse(readFileSync(legacyFile, "utf8")) as {
        account?: { username?: string; uuid?: string };
      };
      const username = legacy.account?.username;
      if (username) this.addOffline(username);
    } catch {
      /* a broken legacy config is not worth failing over */
    }
  }

  private load(): AccountsFile {
    if (!existsSync(this.file)) return { accounts: [], activeId: null };

    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as AccountsFile;
      return {
        accounts: parsed.accounts ?? [],
        activeId: parsed.activeId ?? parsed.accounts?.[0]?.id ?? null
      };
    } catch {
      return { accounts: [], activeId: null };
    }
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), "utf8");
  }

  private toPublic(account: StoredAccount): Account {
    return {
      id: account.id,
      type: account.type,
      username: account.username,
      uuid: account.uuid,
      skinUrl: account.skinUrl ?? null,
      capes: account.capes ?? [],
      activeCapeId: account.activeCapeId ?? null,
      licensed: account.type === "microsoft",
      xuid: account.xuid ?? ""
    };
  }

  list(): Account[] {
    return this.data.accounts.map((account) => this.toPublic(account));
  }

  active(): Account | null {
    const found = this.data.accounts.find((a) => a.id === this.data.activeId);
    return found ? this.toPublic(found) : null;
  }

  activeRaw(): StoredAccount | null {
    return this.data.accounts.find((a) => a.id === this.data.activeId) ?? null;
  }

  setActive(id: string): Account | null {
    if (!this.data.accounts.some((a) => a.id === id)) return null;
    this.data.activeId = id;
    this.persist();
    return this.active();
  }

  remove(id: string): void {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id);
    if (this.data.activeId === id) this.data.activeId = this.data.accounts[0]?.id ?? null;
    this.persist();
  }

  addOffline(username: string): Account {
    const clean = username.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(clean)) {
      throw new Error("Username must be 3-16 characters: letters, digits or underscore");
    }

    const uuid = offlineUuid(clean);
    const existing = this.data.accounts.find((a) => a.type === "offline" && a.uuid === uuid);

    if (existing) {
      this.data.activeId = existing.id;
      this.persist();
      return this.toPublic(existing);
    }

    const account: StoredAccount = {
      id: `offline:${uuid}`,
      type: "offline",
      username: clean,
      uuid,
      addedAt: Date.now()
    };

    this.data.accounts.push(account);
    this.data.activeId = account.id;
    this.persist();
    return this.toPublic(account);
  }

  addMicrosoft(
    profile: MinecraftProfile,
    refreshToken: string,
    accessToken: string,
    accessExpiresAt: number,
    xuid: string,
    flavor: AuthFlavor
  ): Account {
    const uuid = dashedUuid(profile.id);
    const id = `msa:${profile.id}`;
    const capes = profileToCapes(profile);

    const account: StoredAccount = {
      id,
      type: "microsoft",
      username: profile.name,
      uuid,
      secret: encrypt(refreshToken),
      accessToken: encrypt(accessToken),
      accessExpiresAt,
      xuid,
      flavor,
      skinUrl: profile.skins.find((s) => s.state === "ACTIVE")?.url ?? null,
      capes,
      activeCapeId: capes.find((c) => c.active)?.id ?? null,
      addedAt: Date.now()
    };

    this.data.accounts = this.data.accounts.filter((a) => a.id !== id);
    this.data.accounts.push(account);
    this.data.activeId = id;
    this.persist();
    return this.toPublic(account);
  }

  async sessionFor(id: string, clientId: string): Promise<{ account: Account; accessToken: string }> {
    const account = this.data.accounts.find((a) => a.id === id);
    if (!account) throw new Error("Account not found");

    if (account.type === "offline") {
      return { account: this.toPublic(account), accessToken: "0" };
    }

    const cached = decrypt(account.accessToken);
    if (cached && account.accessExpiresAt && account.accessExpiresAt - SESSION_MARGIN_MS > Date.now()) {
      return { account: this.toPublic(account), accessToken: cached };
    }

    const refreshToken = decrypt(account.secret);
    if (!refreshToken) {
      throw new AuthError("reauth", `${account.username} needs to sign in again`);
    }
    const tokens = await refreshMicrosoftTokens(clientId, refreshToken);
    const session = await authenticateWithXbox(tokens.accessToken, account.flavor ?? flavorFor(clientId));
    const profile = await fetchProfile(session.accessToken);
    const capes = profileToCapes(profile);

    account.secret = encrypt(tokens.refreshToken);
    account.accessToken = encrypt(session.accessToken);
    account.accessExpiresAt = session.expiresAt;
    account.xuid = session.xuid || account.xuid;
    account.username = profile.name;
    account.uuid = dashedUuid(profile.id);
    account.skinUrl = profile.skins.find((s) => s.state === "ACTIVE")?.url ?? null;
    account.capes = capes;
    account.activeCapeId = capes.find((c) => c.active)?.id ?? null;
    this.persist();

    return { account: this.toPublic(account), accessToken: session.accessToken };
  }

  async verifyLicense(accessToken: string): Promise<boolean> {
    return hasGameLicense(accessToken);
  }

  async applySkin(id: string, clientId: string, filePath: string, variant: "classic" | "slim"): Promise<Account> {
    const stored = this.data.accounts.find((a) => a.id === id);
    if (!stored) throw new Error("Account not found");
    if (stored.type !== "microsoft") throw new Error("Changing a skin needs a licensed Microsoft account");

    const { accessToken } = await this.sessionFor(id, clientId);
    await uploadSkin(accessToken, basename(filePath), readFileSync(filePath), variant);

    const profile = await fetchProfile(accessToken);
    stored.skinUrl = profile.skins.find((s) => s.state === "ACTIVE")?.url ?? stored.skinUrl;
    this.persist();

    return this.toPublic(stored);
  }

  async applyCape(id: string, clientId: string, capeId: string | null): Promise<Account> {
    const stored = this.data.accounts.find((a) => a.id === id);
    if (!stored) throw new Error("Account not found");
    if (stored.type !== "microsoft") throw new Error("Capes need a licensed Microsoft account");

    const { accessToken } = await this.sessionFor(id, clientId);
    await setActiveCape(accessToken, capeId);

    stored.activeCapeId = capeId;
    stored.capes = (stored.capes ?? []).map((cape) => ({ ...cape, active: cape.id === capeId }));
    this.persist();

    return this.toPublic(stored);
  }
}
