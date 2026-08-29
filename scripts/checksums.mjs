import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(root, "release");
const artifactPattern = /\.(exe|dmg|AppImage|zip|blockmap)$/;

let entries = [];
try {
  entries = readdirSync(releaseDir).filter((name) => artifactPattern.test(name));
} catch {
  console.log("no release directory yet — run npm run dist first");
  process.exit(0);
}

const lines = entries.map((name) => {
  const full = join(releaseDir, name);
  const hash = createHash("sha256").update(readFileSync(full)).digest("hex");
  const sizeMb = (statSync(full).size / 1048576).toFixed(1);
  console.log(`${name}  ${sizeMb} MB  ${hash}`);
  return `${hash}  ${name}`;
});

writeFileSync(join(releaseDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
console.log(`\nwrote ${lines.length} hashes to release/SHA256SUMS.txt`);
