// Release safety checks on the production build (plan §19 "Security checks"):
// exact permissions, no test hooks or local endpoints, no credential-like strings.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const failures = [];

const manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
const expect = (cond, msg) => cond || failures.push(msg);
const same = (a = [], b = []) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

expect(same(manifest.permissions, ["activeTab", "scripting", "storage"]), `permissions changed: ${JSON.stringify(manifest.permissions)}`);
expect(!manifest.host_permissions, `unexpected host_permissions: ${JSON.stringify(manifest.host_permissions)}`);
expect(same(manifest.optional_host_permissions, ["https://api.groq.com/*"]), `optional_host_permissions changed: ${JSON.stringify(manifest.optional_host_permissions)}`);
expect(!manifest.content_scripts, "static content_scripts must not exist (on-demand injection only)");
expect(!manifest.externally_connectable, "externally_connectable must not exist");

const SECRET_PATTERNS = [/gsk_[A-Za-z0-9]{20,}/, /AIza[0-9A-Za-z_-]{30,}/, /sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/];
const FORBIDDEN = ["127.0.0.1", "__peTest", "TEST BUILD", "sourceMappingURL"];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}
for await (const file of walk(dist)) {
  if (!/\.(js|json|html|css)$/.test(file)) continue;
  const text = await readFile(file, "utf8");
  const rel = path.relative(root, file);
  for (const re of SECRET_PATTERNS) expect(!re.test(text), `${rel}: contains a credential-like string (${re})`);
  for (const s of FORBIDDEN) expect(!text.includes(s), `${rel}: contains test-only marker "${s}"`);
  if (rel.endsWith(".js")) expect(!/\binnerHTML\s*=/.test(text) && !/\beval\(/.test(text), `${rel}: innerHTML assignment or eval`);
}

if (failures.length) {
  console.error("dist check FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("dist check passed: permissions exact, no test hooks, no local endpoints, no credential-like strings.");
