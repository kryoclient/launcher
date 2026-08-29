import { BrowserWindow, session } from "electron";
import { AuthError, type AuthChallenge } from "./microsoft";

const PARTITION = "persist:kryo-msa";

function codeFrom(rawUrl: string, redirectUri: string): { code?: string; error?: string } | null {
  if (!rawUrl.startsWith(redirectUri)) return null;

  const url = new URL(rawUrl);
  const error = url.searchParams.get("error");
  if (error) {
    return { error: url.searchParams.get("error_description") ?? error };
  }

  const code = url.searchParams.get("code");
  return code ? { code } : null;
}

export function forgetMicrosoftSession(): Promise<void> {
  return session.fromPartition(PARTITION).clearStorageData({ storages: ["cookies", "localstorage"] });
}

export function requestAuthorizationCode(parent: BrowserWindow | null, challenge: AuthChallenge): Promise<string> {
  return new Promise((resolve, reject) => {
    const window = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent ?? undefined,
      modal: Boolean(parent),
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#0b0f12",
      title: "Sign in with Microsoft",
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    let settled = false;

    const finish = (handler: () => void): void => {
      if (settled) return;
      settled = true;
      handler();
      if (!window.isDestroyed()) window.destroy();
    };

    const inspect = (rawUrl: string): void => {
      let result: { code?: string; error?: string } | null = null;
      try {
        result = codeFrom(rawUrl, challenge.redirectUri);
      } catch {
        result = null;
      }

      if (!result) return;
      if (result.error) {
        finish(() => reject(new AuthError("declined", result.error ?? "Sign-in was declined")));
        return;
      }
      if (result.code) finish(() => resolve(result.code as string));
    };

    window.webContents.on("will-redirect", (_event, url) => inspect(url));
    window.webContents.on("will-navigate", (_event, url) => inspect(url));
    window.webContents.on("did-navigate", (_event, url) => inspect(url));
    window.webContents.on("did-redirect-navigation", (_event, url) => inspect(url));

    window.webContents.on("did-fail-load", (_event, errorCode, description, validatedUrl) => {
      if (validatedUrl.startsWith(challenge.redirectUri)) {
        inspect(validatedUrl);
        return;
      }
      if (errorCode === -3) return;
      finish(() => reject(new AuthError("network", `Could not load the sign-in page: ${description}`)));
    });

    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
      if (settled) return;
      settled = true;
      reject(new AuthError("cancelled", "Sign-in window was closed"));
    });

    void window.loadURL(challenge.url);
  });
}
