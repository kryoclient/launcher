import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { JavaInfo } from "../shared/types";

const run = promisify(execFile);

const isWindows = process.platform === "win32";
const exeName = isWindows ? "java.exe" : "java";

function candidateRoots(): string[] {
  if (isWindows) {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = process.env["LOCALAPPDATA"] ?? "";
    return [
      join(programFiles, "Java"),
      join(programFiles, "Eclipse Adoptium"),
      join(programFiles, "Microsoft", "jdk"),
      join(programFiles, "Amazon Corretto"),
      join(programFiles, "Zulu"),
      join(programFilesX86, "Java"),
      localAppData ? join(localAppData, "Programs", "Eclipse Adoptium") : "",
      localAppData ? join(localAppData, "Packages") : ""
    ].filter(Boolean);
  }

  if (process.platform === "darwin") {
    return ["/Library/Java/JavaVirtualMachines", join(process.env.HOME ?? "", "Library/Java/JavaVirtualMachines")];
  }

  return ["/usr/lib/jvm", "/usr/java", join(process.env.HOME ?? "", ".sdkman/candidates/java")];
}

function binaryIn(dir: string): string[] {
  const found: string[] = [];
  const direct = join(dir, "bin", exeName);
  if (existsSync(direct)) found.push(direct);
  const macStyle = join(dir, "Contents", "Home", "bin", exeName);
  if (existsSync(macStyle)) found.push(macStyle);
  return found;
}

function scanRoots(): string[] {
  const results: string[] = [];

  for (const root of candidateRoots()) {
    if (!existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      results.push(...binaryIn(join(root, entry)));
    }
  }

  return results;
}

export async function probeJava(path: string): Promise<JavaInfo | null> {
  try {
    const { stderr, stdout } = await run(path, ["-version"], { timeout: 8000 });
    const output = `${stderr}${stdout}`;
    const match = output.match(/version "([^"]+)"/);
    if (!match) return null;
    const version = match[1];
    const parts = version.split(".");
    const major = version.startsWith("1.") ? Number(parts[1]) : Number(parts[0].replace(/[^0-9].*$/, ""));
    if (!Number.isFinite(major)) return null;
    return { path, version, major };
  } catch {
    return null;
  }
}

export async function findJavaInstallations(): Promise<JavaInfo[]> {
  const paths = new Set<string>();

  if (process.env.JAVA_HOME) {
    for (const p of binaryIn(process.env.JAVA_HOME)) paths.add(p);
  }
  paths.add(exeName);
  for (const p of scanRoots()) paths.add(p);

  const probes = await Promise.all([...paths].map((p) => probeJava(p)));
  const found = probes.filter((p): p is JavaInfo => p !== null);

  const unique = new Map<string, JavaInfo>();
  for (const info of found) {
    const key = `${info.version}:${info.major}`;
    if (!unique.has(key)) unique.set(key, info);
  }

  return [...unique.values()].sort((a, b) => b.major - a.major);
}

export async function resolveJava(preferred: string | null, requiredMajor: number): Promise<JavaInfo> {
  if (preferred) {
    const probed = await probeJava(preferred);
    if (probed) return probed;
  }

  const installations = await findJavaInstallations();
  if (installations.length === 0) {
    throw new Error(
      `No Java runtime found. Minecraft needs Java ${requiredMajor}. Install a JDK and set its path in Settings.`
    );
  }

  const exact = installations.find((j) => j.major === requiredMajor);
  if (exact) return exact;

  const newer = installations.find((j) => j.major > requiredMajor);
  if (newer) return newer;

  throw new Error(
    `Java ${requiredMajor} is required, but only Java ${installations[0].major} was found. Install Java ${requiredMajor} or newer.`
  );
}
