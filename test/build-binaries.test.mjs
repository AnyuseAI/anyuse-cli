import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBunExecutable } from '../scripts/build-binaries.mjs';

const npmDir = 'C:\\Users\\runner\\AppData\\Roaming\\npm';
const linked = `${npmDir}\\node_modules\\bun\\bin\\bun.exe`;

test('resolves the npm Windows shim to the linked bun.exe', () => {
  const matches = [`${npmDir}\\bun`, `${npmDir}\\bun.cmd`, 'C:\\Users\\runner\\.bun\\bin\\bun.exe'];
  assert.equal(resolveBunExecutable(matches, file => file === linked), linked);
});

test('uses bun.exe when it is the first PATH match', () => {
  const exe = 'C:\\Users\\runner\\.bun\\bin\\bun.exe';
  assert.equal(resolveBunExecutable([exe, `${npmDir}\\bun.cmd`], () => false), exe);
});

test('resolves bun.cmd from the same npm prefix', () => {
  assert.equal(resolveBunExecutable([`${npmDir}\\bun.cmd`], file => file === linked), linked);
});

test('returns null when PATH has no executable', () => {
  assert.equal(resolveBunExecutable([`${npmDir}\\bun`], () => false), null);
});
