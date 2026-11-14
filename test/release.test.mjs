import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const env = { ...process.env, RELEASE_VERSION:pkg.version, RELEASE_TAG:"latest", GITHUB_REF:`refs/tags/v${pkg.version}`, GITHUB_REPOSITORY:"AnyuseApp/cli" };
const script = fileURLToPath(new URL("scripts/check-release.mjs", root));
test("release checks tag, package version and repository without publishing", async () => {
  const result = await exec(process.execPath, [script], {env});
  assert.match(result.stdout, /No package was published/);
  for (const overrides of [
    {RELEASE_VERSION:"999.0.0"}, {GITHUB_REF:"refs/heads/main"}, {GITHUB_REPOSITORY:"someone/cli"}, {RELEASE_TAG:"unrecognized"},
  ]) await assert.rejects(exec(process.execPath,[script],{env:{...env,...overrides}}));
});
test("help and version work without credentials or a usable API URL", async () => {
  for (const arg of ["--version", "-v", "--help"]) {
    const result = await exec(process.execPath,[fileURLToPath(new URL("dist/index.js",root)),arg],{env:{...process.env,ANYUSE_API_KEY:"",ANYUSE_API_URL:"not-a-url"}});
    assert.equal(result.stderr, "");
    assert(arg === "--help" ? result.stdout.includes("anyuse run") : result.stdout.trim() === pkg.version);
  }
});
