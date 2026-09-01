import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "dist", "renderer");

mkdirSync(target, { recursive: true });
cpSync(join(root, "src", "renderer", "index.html"), join(target, "index.html"));
cpSync(join(root, "src", "renderer", "styles.css"), join(target, "styles.css"));
cpSync(join(root, "src", "renderer", "assets"), join(target, "assets"), { recursive: true });
cpSync(join(root, "build", "icon.png"), join(root, "dist", "icon.png"));

console.log("renderer assets copied");
