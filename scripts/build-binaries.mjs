import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile, chmod, cp, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const targets = {
  'darwin-arm64': 'bun-darwin-arm64',
  'darwin-x64': 'bun-darwin-x64',
  'linux-x64': 'bun-linux-x64-baseline',
  'linux-arm64': 'bun-linux-arm64',
  'linux-x64-musl': 'bun-linux-x64-baseline-musl',
  'linux-arm64-musl': 'bun-linux-arm64-musl',
  'windows-x64': 'bun-windows-x64-baseline',
};

// npm's Windows global install puts an extensionless shell shim named `bun` on PATH.
// Node spawn executes that shim and fails with ENOENT. The package links the real bun.exe beside it.
export function resolveBunExecutable(matches, exists) {
  for (const match of matches) {
    if (match.toLowerCase().endsWith('.exe')) return match;
    const linked = path.win32.join(path.win32.dirname(match), 'node_modules', 'bun', 'bin', 'bun.exe');
    if (exists(linked)) return linked;
  }
  return null;
}

function bunCommand() {
  if (process.env.BUN_BIN) return process.env.BUN_BIN;
  if (process.platform !== 'win32') return 'bun';
  const matches = execFileSync('where.exe', ['bun'], {encoding:'utf8'}).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const resolved = resolveBunExecutable(matches, existsSync);
  if (!resolved) throw new Error('Bun on PATH is an npm shim that Node cannot execute. Set BUN_BIN to bun.exe.');
  return resolved;
}

function isDirectRun() {
  return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bun = bunCommand();
  const expected = (await readFile(path.join(root, '.bun-version'), 'utf8')).trim();
  const actual = execFileSync(bun, ['--version'], {encoding:'utf8'}).trim();
  if (actual !== expected) throw new Error(`Build requires Bun ${expected}, found ${actual}`);
  const requested = process.argv.slice(2);
  if (!requested.length) requested.push(`${process.platform}-${process.arch}`);
  const selected = requested.includes('--all') ? Object.keys(targets) : requested;
  for (const target of selected) if (!targets[target]) throw new Error(`Unsupported target: ${target}`);
  const output = path.join(root, 'artifacts');
  await mkdir(output, {recursive:true});
  for (const target of selected) {
    const name = `anyuse-${target}${target.startsWith('windows-') ? '.exe' : ''}`;
    const file = path.join(output, name);
    execFileSync(bun, ['build', 'src/index.ts', '--compile', `--target=${targets[target]}`, '--outfile', file], {cwd:root, stdio:'inherit'});
    await chmod(file, 0o755);
    const hash = createHash('sha256').update(await readFile(file)).digest('hex');
    await writeFile(`${file}.sha256`, `${hash}  ${name}\n`);
  }
  for (const name of ['install.sh', 'install.ps1', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'BUN_LICENSE.md']) {
    await copyFile(path.join(root, name), path.join(output, name));
  }
  await copyFile(path.join(root, 'skills/anyuse/SKILL.md'), path.join(output, 'SKILL.md'));
  await cp(path.join(root, "skills/anyuse-gsc"), path.join(output, "anyuse-gsc"), { recursive: true });
  console.log(`Prepared ${selected.length} executable(s) in artifacts/. Nothing was published.`);
}
