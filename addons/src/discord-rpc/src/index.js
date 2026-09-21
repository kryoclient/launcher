const React = window.React;
const { useEffect, useState } = React;

const LOGO_URL =
  "https://raw.githubusercontent.com/kryoclient/launcher/new/src-tauri/icons/128x128@2x.png";
const DOWNLOAD_URL = "https://github.com/kryoclient/launcher/releases/latest";
const DISCORD_BLURPLE = "#5865F2";

// Connection lives in the launcher core: Discord only accepts Rich Presence
// over its local IPC socket, which the addon sandbox cannot reach on its own.
let api = null;
let sessionStart = Date.now();
let phase = "menu"; // "menu" | "launching" | "playing"
let launchedVersion = null;
let gameStart = null;
let status = { state: "idle", user: null, error: null };
let cleanups = [];

const statusListeners = new Set();

function notifyStatus() {
  for (const listener of statusListeners) {
    try {
      listener();
    } catch {
      // A broken widget must not stop the presence itself
    }
  }
}

function setting(key, fallback) {
  const value = api.storage.get(key, fallback);
  return value === undefined || value === null ? fallback : value;
}

function isEnabled() {
  return setting("rpc_enabled", true) !== false;
}

/** Discord rejects text fields shorter than 2 or longer than 128 characters. */
function field(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length < 2) return null;
  return trimmed.slice(0, 128);
}

function currentProfile() {
  try {
    return api.game.getSelectedProfile();
  } catch {
    return null;
  }
}

function currentVersionId() {
  if (launchedVersion) return launchedVersion;
  try {
    const version = api.game.getSelectedVersion();
    return version ? version.id : null;
  } catch {
    return null;
  }
}

function buildActivity() {
  const showProfile = setting("showProfile", true) !== false;
  const showVersion = setting("showVersion", true) !== false;
  const showButton = setting("showButton", true) !== false;

  const profile = currentProfile();
  const username = profile && profile.username ? profile.username : null;
  const versionId = currentVersionId();

  let details;
  let stateParts = [];

  if (phase === "playing") {
    details = versionId ? `Играет в Minecraft ${versionId}` : "Играет в Minecraft";
  } else if (phase === "launching") {
    details = versionId ? `Запускает Minecraft ${versionId}` : "Запускает Minecraft";
  } else {
    details = field(setting("customDetails", "")) || "В главном меню";
    if (showVersion && versionId) stateParts.push(versionId);
  }

  if (showProfile && username) stateParts.push(username);

  const activity = {
    details: field(details) || "KryoClient",
    timestamps: {
      start: Math.floor((phase === "playing" && gameStart ? gameStart : sessionStart) / 1000),
    },
    assets: {
      large_image: LOGO_URL,
      large_text: "KryoClient",
    },
  };

  const state = field(stateParts.join(" • "));
  if (state) activity.state = state;

  if (showProfile && username) {
    activity.assets.small_image = `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`;
    activity.assets.small_text = username;
  }

  if (showButton) {
    activity.buttons = [{ label: "Скачать KryoClient", url: DOWNLOAD_URL }];
  }

  return activity;
}

function push() {
  if (!api || !api.discord) return;

  if (!isEnabled()) {
    api.discord.clearActivity().catch(() => {});
    return;
  }

  api.discord.setActivity(buildActivity()).catch((err) => {
    api.logger.error(`Не удалось обновить статус: ${err}`);
  });
}

function setPhase(next, versionId) {
  phase = next;
  if (next === "playing") {
    gameStart = Date.now();
  } else if (next === "menu") {
    gameStart = null;
    launchedVersion = null;
  }
  if (versionId !== undefined) launchedVersion = versionId;
  push();
}

function statusLabel() {
  if (!api || !api.discord) {
    return "Обновите лаунчер: этой версии нужен KryoClient 2.0.1 или новее";
  }
  if (!isEnabled()) {
    return "Статус в Discord выключен (нажмите, чтобы включить)";
  }
  switch (status.state) {
    case "connected":
      return status.error
        ? `Discord отклонил статус: ${status.error}`
        : `Статус виден в Discord${status.user ? ` (${status.user})` : ""}`;
    case "connecting":
      return "Подключение к Discord...";
    case "unavailable":
      return `${status.error || "Discord недоступен"}. Повтор каждые 15 секунд`;
    default:
      return "Статус в Discord включён";
  }
}

function dotColor() {
  if (!api || !api.discord || !isEnabled()) return "bg-muted-foreground/40";
  if (status.state === "connected") {
    return status.error
      ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
      : "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]";
  }
  if (status.state === "unavailable") return "bg-amber-400";
  return "bg-muted-foreground/60 animate-pulse";
}

function DiscordRpcWidget() {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    statusListeners.add(listener);
    return () => {
      statusListeners.delete(listener);
    };
  }, []);

  const supported = Boolean(api && api.discord);
  const enabled = supported && isEnabled();
  const live = enabled && status.state === "connected" && !status.error;

  const toggle = () => {
    if (!supported) {
      api.ui.showToast(
        "Статус в Discord требует KryoClient 2.0.1 или новее",
        "error",
      );
      return;
    }
    const next = !isEnabled();
    api.storage.set("rpc_enabled", next);
    push();
    notifyStatus();
    api.ui.showToast(
      next ? "Статус в Discord включён" : "Статус в Discord выключен",
      next ? "success" : "info",
    );
  };

  const KryoClient = window.KryoClient;
  const Button = KryoClient?.ui?.Button || KryoClient?.Button || "button";

  return React.createElement(
    Button,
    {
      variant: "outline",
      size: "sm",
      type: "button",
      onClick: toggle,
      title: statusLabel(),
      className:
        "border-border/40 bg-card/40 flex h-9 cursor-pointer items-center gap-2 px-3 text-xs backdrop-blur-sm transition-all font-semibold whitespace-nowrap " +
        (enabled
          ? "hover:border-[#5865F2]/50 hover:bg-[#5865F2]/10 text-foreground"
          : "hover:border-border/60 hover:bg-accent/40 text-muted-foreground opacity-60"),
    },
    React.createElement(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 15,
        height: 15,
        fill: "currentColor",
        className: live ? "shrink-0" : "text-muted-foreground shrink-0",
        style: live ? { color: DISCORD_BLURPLE } : undefined,
      },
      React.createElement("path", {
        d: "M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z",
      }),
    ),
    "Discord",
    React.createElement("span", {
      className: "h-1.5 w-1.5 rounded-full " + dotColor(),
    }),
  );
}

export default {
  manifest: {
    id: "discord-rpc",
    name: "Discord Rich Presence",
    version: "2.0.0",
    description:
      "Показывает в профиле Discord, что вы играете через KryoClient: версию Minecraft, никнейм и время игры.",
    author: "KryoClient Team",
    category: "integration",
    minLauncherVersion: "2.0.1",
    permissions: [
      "game:profiles",
      "ui:slots",
      "storage:local",
      "integration:discord",
    ],
    tags: ["discord", "rpc", "status", "social"],
  },

  activate(context) {
    api = context;
    sessionStart = Date.now();
    phase = "menu";
    launchedVersion = null;
    gameStart = null;

    api.ui.registerSlot("header.actions", "rpc-btn", DiscordRpcWidget, 10);

    if (!api.discord) {
      api.logger.error(
        "Статус в Discord требует KryoClient 2.0.1 или новее — обновите лаунчер",
      );
      return;
    }

    cleanups.push(
      api.discord.onStatusChange((next) => {
        status = next;
        notifyStatus();
      }),
    );

    api.discord
      .getStatus()
      .then((next) => {
        status = next;
        notifyStatus();
      })
      .catch(() => {});

    cleanups.push(
      api.events.on("game:launching", (payload) => {
        setPhase("launching", payload && payload.versionId);
      }),
      api.events.on("game:started", () => setPhase("playing")),
      api.events.on("game:exited", () => setPhase("menu")),
      // Profile or version switched in the launcher UI
      api.events.on("state:updated", () => push()),
      api.events.on("addon:discord-rpc:configChange", () => {
        push();
        notifyStatus();
      }),
    );

    push();
  },

  deactivate(context) {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        // Keep tearing the rest down
      }
    }
    cleanups = [];
    statusListeners.clear();

    if (context.discord) {
      context.discord.clearActivity().catch(() => {});
    }
    context.ui.unregisterSlot("rpc-btn");
    api = null;
  },
};
