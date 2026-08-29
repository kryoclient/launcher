import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateStatus } from "../shared/types";

type Emit = (status: UpdateStatus) => void;

let wired = false;
let latest: UpdateStatus = { state: "idle", version: app.getVersion() };

export function currentUpdateStatus(): UpdateStatus {
  return latest;
}

function publish(emit: Emit, status: UpdateStatus): void {
  latest = status;
  emit(status);
}

function wire(emit: Emit, log: (line: string) => void): void {
  if (wired) return;
  wired = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    publish(emit, { state: "checking", version: app.getVersion() });
  });

  autoUpdater.on("update-available", (info) => {
    log(`update available: ${info.version}`);
    publish(emit, { state: "downloading", version: app.getVersion(), newVersion: info.version, percent: 0 });
  });

  autoUpdater.on("update-not-available", () => {
    publish(emit, { state: "current", version: app.getVersion() });
  });

  autoUpdater.on("download-progress", (progress) => {
    publish(emit, {
      state: "downloading",
      version: app.getVersion(),
      newVersion: latest.newVersion,
      percent: Math.round(progress.percent)
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    log(`update downloaded: ${info.version}`);
    publish(emit, { state: "ready", version: app.getVersion(), newVersion: info.version, percent: 100 });
  });

  autoUpdater.on("error", (error) => {
    log(`updater error: ${error.message}`);
    publish(emit, { state: "error", version: app.getVersion(), message: error.message });
  });
}

export async function checkForUpdates(emit: Emit, log: (line: string) => void): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    latest = { state: "dev", version: app.getVersion() };
    return latest;
  }

  wire(emit, log);

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publish(emit, { state: "error", version: app.getVersion(), message });
  }

  return latest;
}

export function installUpdate(): void {
  if (latest.state !== "ready") return;
  autoUpdater.quitAndInstall(false, true);
}
