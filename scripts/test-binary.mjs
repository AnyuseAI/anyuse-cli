import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2] || `${process.platform}-${process.arch}`;
const binary = path.join(root, 'artifacts', `anyuse-${target}${target.startsWith('windows-') ? '.exe' : ''}`);
execFileSync(process.execPath, ['--test', 'test/client.test.mjs', 'test/run.test.mjs', 'test/binary.test.mjs'], {
  cwd:root, stdio:'inherit', env:{...process.env, ANYUSE_TEST_BINARY:binary},
});
