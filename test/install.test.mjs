import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const script = fileURLToPath(new URL('../install.sh',import.meta.url));
// 只替换下载和平台探测命令，实际运行安装、校验、替换和清理逻辑。
test('shell installer selects assets, checks SHA256, preserves old installs on failure', {skip:process.platform==='win32'}, async t => {
  const dir = await mkdtemp(path.join(tmpdir(),'anyuse-install-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const bin = path.join(dir,'tools'), out = path.join(dir,'install with spaces');
  await mkdir(bin); await mkdir(out);
  const fixture = '#!/bin/sh\nprintf "0.1.0\\n"\n';
  const hash = createHash('sha256').update(fixture).digest('hex');
  await writeFile(path.join(dir,'binary'),fixture);
  await writeFile(path.join(bin,'uname'),'#!/bin/sh\nif [ "$1" = -s ]; then echo "$TEST_OS"; else echo "$TEST_ARCH"; fi\n',{mode:0o755});
  await writeFile(path.join(bin,'ldd'),'#!/bin/sh\necho "$TEST_LIBC"\n',{mode:0o755});
  await writeFile(path.join(bin,'curl'),`#!/bin/bash
set -eu
url=''; out=''
while [[ $# -gt 0 ]]; do
  case "$1" in https://*) url="$1";; -o) shift; out="$1";; esac
  shift
done
printf '%s\\n' "$url" >> "$TEST_LOG"
[[ "\${TEST_FAIL:-}" != download ]] || exit 22
if [[ "$url" == *.sha256 ]]; then
  asset="\${url##*/}"; asset="\${asset%.sha256}"
  printf '%s  %s\\n' "$TEST_HASH" "$asset" > "$out"
else cp "$TEST_BINARY" "$out"; fi
`,{mode:0o755});
  const env = {...process.env, PATH:`${bin}:/usr/bin:/bin`, ANYUSE_INSTALL_DIR:out, ANYUSE_VERSION:'0.1.0', ANYUSE_REPOSITORY:'example/cli', TEST_BINARY:path.join(dir,'binary'), TEST_HASH:hash, TEST_LOG:path.join(dir,'urls')};
  for (const [os,arch,libc,target] of [['Darwin','arm64','glibc','darwin-arm64'],['Darwin','x86_64','glibc','darwin-x64'],['Linux','x86_64','glibc','linux-x64'],['Linux','aarch64','musl','linux-arm64-musl']]) {
    const options={env:{...env,TEST_OS:os,TEST_ARCH:arch,TEST_LIBC:libc}};
    await exec('/bin/bash',[script],options);
    assert.equal(await readFile(path.join(out,'anyuse'),'utf8'),fixture);
    assert.match(await readFile(env.TEST_LOG,'utf8'),new RegExp(`/download/v0.1.0/anyuse-${target}`));
    await writeFile(path.join(out,'anyuse'),'old version');
    for (const overrides of [{TEST_HASH:'0'.repeat(64)}, {TEST_FAIL:'download'}, {ANYUSE_VERSION:'../../bad'}, {TEST_ARCH:'mips'}]) {
      await assert.rejects(exec('/bin/bash',[script],{env:{...options.env,...overrides}}));
      assert.equal(await readFile(path.join(out,'anyuse'),'utf8'),'old version');
    }
  }
  await exec('/bin/bash',[script],{env:{...env,ANYUSE_VERSION:'latest',TEST_OS:'Darwin',TEST_ARCH:'arm64'}});
  assert.match(await readFile(env.TEST_LOG,'utf8'),/releases\/latest\/download\/anyuse-darwin-arm64/);
});
