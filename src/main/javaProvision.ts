import AdmZip from "adm-zip";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { JavaInfo, Progress } from "../shared/types";
import { probeJava } from "./java";

const ADOPTIUM = "https://api.adoptium.net/v3/binary/latest";

function adoptiumOs(): string {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  return "linux";
}

function adoptiumArch(): string {
  if (process.arch === "arm64") return "aarch64";
  if (process.arch === "ia32") return "x86";
  return "x64";
}

export function runtimeRoot(gameDir: string): string {
  return join(gameDir, "runtime");
}

function findJavaBinary(root: string): string | null {
  const stack = [root];
  const executable = process.platform === "win32" ? "javaw.exe" : "java";
  const fallback = process.platform === "win32" ? "java.exe" : "java";

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;

    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }

      if (isDir) {
        stack.push(full);
        continue;
      }

      if (entry === executable || entry === fallback) {
        if (current.endsWith("bin") || current.endsWith(`bin${process.platform === "win32" ? "\\" : "/"}`)) {
          return full;
        }
      }
    }
  }

  return null;
}

export function managedJava(gameDir: string, major: number): string | null {
  const dir = join(runtimeRoot(gameDir), String(major));
  if (!existsSync(dir)) return null;
  return findJavaBinary(dir);
}

async function extractArchive(archive: string, target: string): Promise<void> {
  mkdirSync(target, { recursive: true });

  if (archive.endsWith(".zip")) {
    new AdmZip(archive).extractAllTo(target, true);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archive, "-C", target]);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`))));
  });
}

export async function downloadJava(
  gameDir: string,
  major: number,
  onProgress: (progress: Progress) => void
): Promise<JavaInfo> {
  const existing = managedJava(gameDir, major);
  if (existing) {
    const probed = await probeJava(existing);
    if (probed) return { ...probed, managed: true };
  }

  const url = `${ADOPTIUM}/${major}/ga/${adoptiumOs()}/${adoptiumArch()}/jre/hotspot/normal/eclipse`;

  onProgress({ stage: "java", label: `Downloading Java ${major}`, current: 0, total: 100, done: false });

  const response = await fetch(url, { headers: { "User-Agent": "KryoClient/1.0" }, redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download Java ${major} (status ${response.status})`);
  }

  const isZip = adoptiumOs() === "windows";
  const target = join(runtimeRoot(gameDir), String(major));
  const archive = join(runtimeRoot(gameDir), `jre-${major}${isZip ? ".zip" : ".tar.gz"}`);

  mkdirSync(runtimeRoot(gameDir), { recursive: true });

  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;

  const source = Readable.fromWeb(response.body as never);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (total > 0) {
      onProgress({
        stage: "java",
        label: `Downloading Java ${major}`,
        current: Math.round((received / total) * 100),
        total: 100,
        done: false
      });
    }
  });

  await pipeline(source, createWriteStream(archive));

  onProgress({ stage: "java", label: `Unpacking Java ${major}`, current: 100, total: 100, done: false });

  rmSync(target, { recursive: true, force: true });
  await extractArchive(archive, target);
  rmSync(archive, { force: true });

  const binary = findJavaBinary(target);
  if (!binary) throw new Error(`Java ${major} unpacked, but no runtime binary was found`);

  const probed = await probeJava(binary);
  if (!probed) throw new Error(`Java ${major} was downloaded but did not run`);

  return { ...probed, managed: true };
}
