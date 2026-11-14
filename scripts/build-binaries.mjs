import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, chmod, copyFile } from 'node:fs/promises';
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
const root = fileURLToPath(new URL('../', import.meta.url));
const bun = process.env.BUN_BIN || 'bun';
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
console.log(`Prepared ${selected.length} executable(s) in artifacts/. Nothing was published.`);
