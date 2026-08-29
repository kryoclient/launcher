import { createHash, randomBytes } from "node:crypto";

const LIVE_AUTHORIZE = "https://login.live.com/oauth20_authorize.srf";
const LIVE_TOKEN = "https://login.live.com/oauth20_token.srf";
const LIVE_REDIRECT = "https://login.live.com/oauth20_desktop.srf";
const LIVE_SCOPE = "service::user.auth.xboxlive.com::MBI_SSL";

const AZURE_AUTHORIZE = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const AZURE_TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const AZURE_REDIRECT = "https://login.microsoftonline.com/common/oauth2/nativeclient";
const AZURE_SCOPE = "XboxLive.signin offline_access";

const XBL_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_ENTITLEMENTS_URL = "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

export const DEFAULT_CLIENT_ID = "00000000402b5328";

export type AuthFlavor = "live" | "azure";

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface MinecraftSession {
  accessToken: string;
  expiresAt: number;
  xuid: string;
}

export interface MinecraftProfile {
  id: string;
  name: string;
  skins: { id: string; state: string; url: string; variant: string }[];
  capes: { id: string; state: string; url: string; alias?: string }[];
}

export interface AuthChallenge {
  url: string;
  redirectUri: string;
  verifier: string;
  flavor: AuthFlavor;
}

export class AuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AuthError";
  }
}

export function resolveClientId(configured: string): string {
  return configured.trim() || DEFAULT_CLIENT_ID;
}

export function flavorFor(clientId: string): AuthFlavor {
  return resolveClientId(clientId) === DEFAULT_CLIENT_ID ? "live" : "azure";
}

export function redirectUriFor(flavor: AuthFlavor): string {
  return flavor === "live" ? LIVE_REDIRECT : AZURE_REDIRECT;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildChallenge(configuredClientId: string): AuthChallenge {
  const clientId = resolveClientId(configuredClientId);
  const flavor = flavorFor(clientId);
  const redirectUri = redirectUriFor(flavor);
  const verifier = base64Url(randomBytes(48));

  if (flavor === "live") {
    const query = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: LIVE_SCOPE,
      redirect_uri: redirectUri,
      prompt: "select_account"
    });
    return { url: `${LIVE_AUTHORIZE}?${query.toString()}`, redirectUri, verifier, flavor };
  }

  const query = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: AZURE_SCOPE,
    redirect_uri: redirectUri,
    response_mode: "query",
    prompt: "select_account",
    code_challenge: base64Url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256"
  });

  return { url: `${AZURE_AUTHORIZE}?${query.toString()}`, redirectUri, verifier, flavor };
}

async function postForm<T>(url: string, form: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString()
  });

  const text = await response.text();
  const parsed = (text ? JSON.parse(text) : {}) as T & { error?: string; error_description?: string };

  if (!response.ok) {
    throw new AuthError(parsed.error ?? "http", parsed.error_description ?? `${url} returned ${response.status}`);
  }

  return parsed;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const parsed = (text ? JSON.parse(text) : {}) as T & { XErr?: number };

  if (!response.ok) {
    const xerr = parsed.XErr;
    if (xerr === 2148916233) {
      throw new AuthError(
        "no-xbox-account",
        "This Microsoft account has no Xbox profile. Create one at xbox.com and sign in again."
      );
    }
    if (xerr === 2148916235) {
      throw new AuthError("region-blocked", "Xbox Live is not available in this account's region.");
    }
    if (xerr === 2148916238) {
      throw new AuthError("child-account", "This is a child account. Add it to a family group before signing in.");
    }
    throw new AuthError("http", `${url} returned ${response.status}`);
  }

  return parsed;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCode(
  configuredClientId: string,
  code: string,
  challenge: AuthChallenge
): Promise<MicrosoftTokens> {
  const clientId = resolveClientId(configuredClientId);

  const form: Record<string, string> =
    challenge.flavor === "live"
      ? {
          client_id: clientId,
          grant_type: "authorization_code",
          code,
          redirect_uri: challenge.redirectUri,
          scope: LIVE_SCOPE
        }
      : {
          client_id: clientId,
          grant_type: "authorization_code",
          code,
          redirect_uri: challenge.redirectUri,
          scope: AZURE_SCOPE,
          code_verifier: challenge.verifier
        };

  const response = await postForm<TokenResponse>(
    challenge.flavor === "live" ? LIVE_TOKEN : AZURE_TOKEN,
    form
  );

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? "",
    expiresAt: Date.now() + response.expires_in * 1000
  };
}

export async function refreshMicrosoftTokens(
  configuredClientId: string,
  refreshToken: string
): Promise<MicrosoftTokens> {
  const clientId = resolveClientId(configuredClientId);
  const flavor = flavorFor(clientId);

  const response = await postForm<TokenResponse>(flavor === "live" ? LIVE_TOKEN : AZURE_TOKEN, {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    redirect_uri: redirectUriFor(flavor),
    scope: flavor === "live" ? LIVE_SCOPE : AZURE_SCOPE
  });

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? refreshToken,
    expiresAt: Date.now() + response.expires_in * 1000
  };
}

export async function authenticateWithXbox(
  microsoftAccessToken: string,
  flavor: AuthFlavor
): Promise<MinecraftSession> {
  const xbl = await postJson<{ Token: string; DisplayClaims: { xui: { uhs: string }[] } }>(XBL_URL, {
    Properties: {
      AuthMethod: "RPS",
      SiteName: "user.auth.xboxlive.com",
      RpsTicket: flavor === "live" ? microsoftAccessToken : `d=${microsoftAccessToken}`
    },
    RelyingParty: "http://auth.xboxlive.com",
    TokenType: "JWT"
  });

  const userHash = xbl.DisplayClaims.xui[0]?.uhs;
  if (!userHash) throw new AuthError("xbl", "Xbox Live did not return a user hash");

  const xsts = await postJson<{ Token: string; DisplayClaims: { xui: { uhs: string; xid?: string }[] } }>(XSTS_URL, {
    Properties: { SandboxId: "RETAIL", UserTokens: [xbl.Token] },
    RelyingParty: "rp://api.minecraftservices.com/",
    TokenType: "JWT"
  });

  const minecraft = await postJson<{ access_token: string; expires_in: number }>(MC_LOGIN_URL, {
    identityToken: `XBL3.0 x=${userHash};${xsts.Token}`
  });

  return {
    accessToken: minecraft.access_token,
    expiresAt: Date.now() + minecraft.expires_in * 1000,
    xuid: xsts.DisplayClaims.xui[0]?.xid ?? ""
  };
}

export async function hasGameLicense(minecraftAccessToken: string): Promise<boolean> {
  const response = await fetch(MC_ENTITLEMENTS_URL, {
    headers: { Authorization: `Bearer ${minecraftAccessToken}` }
  });

  if (!response.ok) return false;

  const data = (await response.json()) as { items?: { name: string }[] };
  return (data.items ?? []).some((item) => item.name === "product_minecraft" || item.name === "game_minecraft");
}

export async function fetchProfile(minecraftAccessToken: string): Promise<MinecraftProfile> {
  const response = await fetch(MC_PROFILE_URL, {
    headers: { Authorization: `Bearer ${minecraftAccessToken}` }
  });

  if (response.status === 404) {
    throw new AuthError(
      "no-profile",
      "This account owns no Minecraft Java profile. Buy the game or create a profile name first."
    );
  }

  if (!response.ok) {
    throw new AuthError("profile", `Could not read the Minecraft profile (status ${response.status})`);
  }

  return (await response.json()) as MinecraftProfile;
}

export async function uploadSkin(
  minecraftAccessToken: string,
  fileName: string,
  file: Buffer,
  variant: "classic" | "slim"
): Promise<void> {
  const form = new FormData();
  form.append("variant", variant);
  form.append("file", new Blob([new Uint8Array(file)], { type: "image/png" }), fileName);

  const response = await fetch("https://api.minecraftservices.com/minecraft/profile/skins", {
    method: "POST",
    headers: { Authorization: `Bearer ${minecraftAccessToken}` },
    body: form
  });

  if (!response.ok) {
    throw new AuthError("skin", `Minecraft refused the skin (status ${response.status})`);
  }
}

export async function setActiveCape(minecraftAccessToken: string, capeId: string | null): Promise<void> {
  const url = "https://api.minecraftservices.com/minecraft/profile/capes/active";

  const response = capeId
    ? await fetch(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${minecraftAccessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ capeId })
      })
    : await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${minecraftAccessToken}` } });

  if (!response.ok) throw new AuthError("cape", `Could not change the cape (status ${response.status})`);
}
