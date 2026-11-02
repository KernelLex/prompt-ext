// Zips dist/ into prompt-enhancer-<version>.zip using the system `zip` tool.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(path.join(root, "dist/manifest.json"), "utf8"));
const out = path.join(root, `prompt-enhancer-${version}.zip`);
execFileSync("zip", ["-r", "-q", "-X", out, "."], { cwd: path.join(root, "dist") });
console.log(`Packaged → ${path.relative(root, out)}`);
