const DEVICE_CODE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_ENTITLEMENTS_URL = "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

const SCOPE = "XboxLive.signin offline_access";

export interface DeviceCodePrompt {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  message: string;
}

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

export class AuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AuthError";
  }
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as T & { XErr?: number }) : ({} as T);

  if (!response.ok) {
    const xerr = (parsed as { XErr?: number }).XErr;
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
      throw new AuthError(
        "child-account",
        "This is a child account. Add it to a family group before signing in."
      );
    }
    throw new AuthError("http", `${url} failed with status ${response.status}`);
  }

  return parsed;
}

async function postForm<T>(url: string, form: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString()
  });

  const parsed = (await response.json()) as T & { error?: string; error_description?: string };

  if (!response.ok && parsed.error) {
    throw new AuthError(parsed.error, parsed.error_description ?? parsed.error);
  }

  return parsed;
}

export async function requestDeviceCode(clientId: string): Promise<{ prompt: DeviceCodePrompt; deviceCode: string; interval: number }> {
  const response = await postForm<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
    message: string;
  }>(DEVICE_CODE_URL, { client_id: clientId, scope: SCOPE });

  return {
    prompt: {
      userCode: response.user_code,
      verificationUri: response.verification_uri,
      expiresIn: response.expires_in,
      message: response.message
    },
    deviceCode: response.device_code,
    interval: response.interval
  };
}

export async function pollForTokens(
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresIn: number,
  isCancelled: () => boolean
): Promise<MicrosoftTokens> {
  const deadline = Date.now() + expiresIn * 1000;
  let wait = Math.max(intervalSeconds, 1) * 1000;

  while (Date.now() < deadline) {
    if (isCancelled()) throw new AuthError("cancelled", "Sign-in cancelled");

    await new Promise((resolve) => setTimeout(resolve, wait));

    try {
      const response = await postForm<{ access_token: string; refresh_token: string; expires_in: number }>(TOKEN_URL, {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: deviceCode
      });

      return {
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: Date.now() + response.expires_in * 1000
      };
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;

      if (error.code === "authorization_pending") continue;
      if (error.code === "slow_down") {
        wait += 5000;
        continue;
      }
      if (error.code === "authorization_declined") {
        throw new AuthError("declined", "Sign-in was declined in the browser");
      }
      if (error.code === "expired_token") {
        throw new AuthError("expired", "The sign-in code expired. Start again.");
      }
      throw error;
    }
  }

  throw new AuthError("expired", "The sign-in code expired. Start again.");
}

export async function refreshMicrosoftTokens(clientId: string, refreshToken: string): Promise<MicrosoftTokens> {
  const response = await postForm<{ access_token: string; refresh_token: string; expires_in: number }>(TOKEN_URL, {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
    scope: SCOPE
  });

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? refreshToken,
    expiresAt: Date.now() + response.expires_in * 1000
  };
}

export async function authenticateWithXbox(microsoftAccessToken: string): Promise<MinecraftSession> {
  const xbl = await postJson<{ Token: string; DisplayClaims: { xui: { uhs: string }[] } }>(XBL_URL, {
    Properties: {
      AuthMethod: "RPS",
      SiteName: "user.auth.xboxlive.com",
      RpsTicket: `d=${microsoftAccessToken}`
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
