import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, copyFile, chmod, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
const exec = promisify(execFile);
const source = process.env.ANYUSE_TEST_BINARY;
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
test('standalone executable runs isolated without Node, Bun, package.json or credentials', {skip:!source}, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anyuse-binary-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const binary = path.join(dir, process.platform === 'win32' ? 'anyuse.exe' : 'anyuse');
  await copyFile(source, binary); await chmod(binary, 0o755);
  const env = {...process.env, PATH:dir, ANYUSE_API_KEY:'', ANYUSE_API_URL:'not-a-url'};
  if (process.platform === 'win32') { for (const key of Object.keys(env)) if (key.toLowerCase() === 'path' && key !== 'PATH') delete env[key]; }
  for (const arg of ['--version', '-v', '--help']) {
    const result = await exec(binary, [arg], {cwd:dir, env});
    assert.equal(result.stderr, '');
    assert(arg === '--help' ? result.stdout.includes('anyuse run') : result.stdout.trim() === pkg.version);
  }
  await assert.rejects(exec(binary, ['balance'], {cwd:dir, env:{...env, ANYUSE_API_URL:'https://api.anyuse.app'}}), e => e.code === 3);
});
test('standalone HTTP, input file, split SSE, redirects and exit codes', {skip:!source}, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'anyuse-api-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({url:req.url, method:req.method, auth:req.headers.authorization, body});
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/quotes') { res.end(JSON.stringify({id:'quote', input:JSON.parse(body).input})); }
    else if (req.url.includes('/events')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write('event: delta\ndata: {"type":"delta","text":"你');
      setTimeout(() => res.end('好"}\n\nevent: done\ndata: {"type":"done"}\n\n'), 10);
    } else if (req.url === '/v1/wallet') {res.writeHead(302,{Location:'/leak'});res.end();}
    else if (req.url === '/v1/me') {res.writeHead(401);res.end('{"error":{"message":"Denied"}}');}
    else if (req.url.endsWith('/failed')) res.end('{"status":"failed"}');
    else if (req.url.endsWith('/unknown')) res.end('{"status":"unknown"}');
    else res.end('{"items":[]}');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => {server.closeAllConnections();server.close();});
  const options = {cwd:dir, env:{...process.env, ANYUSE_API_URL:`http://127.0.0.1:${server.address().port}`, ANYUSE_API_KEY:'test-key'}};
  await exec(source,['capabilities','search','咖啡'],options);
  assert.match(requests[0].url, /q=%E5%92%96%E5%95%A1/);
  await writeFile(path.join(dir,'input.json'), JSON.stringify({text:'你好'}));
  const quote = await exec(source,['quote','test.operation','--input','@input.json'],options);
  assert.deepEqual(JSON.parse(quote.stdout).input,{text:'你好'});
  assert.equal(requests[1].auth,'Bearer test-key');
  const events = await exec(source,['jobs','events','job'],options);
  assert.deepEqual(events.stdout.trim().split('\n').map(JSON.parse).map(e=>e.type),['delta','done']);
  assert.equal(JSON.parse(events.stdout.split('\n')[0]).text,'你好');
  await assert.rejects(exec(source,['balance'],options),e=>e.code===1);
  assert(!requests.some(r=>r.url==='/leak'));
  await assert.rejects(exec(source,['auth','status'],options),e=>e.code===3);
  for (const [status,code] of [['failed',4],['unknown',5]]) await assert.rejects(exec(source,['jobs','get',status],options),e=>e.code===code);
});
