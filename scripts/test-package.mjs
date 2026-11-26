import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const temp = await mkdtemp(join(tmpdir(), "anyuse-cli-package-"));
assert(process.env.npm_execpath, "Run this check with npm run test:package");
const env = { ...process.env };
delete env.ANYUSE_API_KEY;
delete env.ANYUSE_API_URL;
async function npm(args, cwd = root) {
  return exec(process.execPath, [process.env.npm_execpath, ...args], { cwd, env });
}
try {
  const { stdout } = await npm(["pack", "--ignore-scripts", "--json", "--pack-destination", temp]);
  const [packed] = JSON.parse(stdout);
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.deepEqual(packed.files.map(f => f.path).sort(), [
    "LICENSE", "README.md", "README.zh-CN.md", "package.json", "dist/client.js", "dist/index.js", "dist/budget.js", "skills/anyuse/SKILL.md",
  ].sort());
  assert(!manifest.private, "Package must be publishable");
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.publishConfig.registry, "https://registry.npmjs.org/");
  const consumer = join(temp, "consumer");
  await mkdir(consumer);
  await npm(["install", "--offline", "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", join(temp, packed.filename)], consumer);
  const installed = join(consumer, "node_modules", "@anyuse", "cli");
  assert((await readFile(join(installed, "dist", "index.js"), "utf8")).startsWith("#!/usr/bin/env node\n"));
  const version = await npm(["exec", "--offline", "--", "anyuse", "--version"], consumer);
  assert.equal(version.stdout.trim(), manifest.version);
  const help = await npm(["exec", "--offline", "--", "anyuse", "--help"], consumer);
  assert.match(help.stdout, /anyuse run --quote/);
  await assert.rejects(exec(process.execPath, [join(installed, "dist", "index.js"), "auth", "status"], {cwd:consumer,env}), error => {
    assert.equal(error.code, 3);
    assert.equal(JSON.parse(error.stderr).error.code, "missing_key");
    return true;
  });
  console.log(`Package verified: ${packed.name}@${packed.version}; ${packed.files.length} files; clean install and command entry passed.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
