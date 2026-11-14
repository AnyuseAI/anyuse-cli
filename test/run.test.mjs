import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
const command = process.env.ANYUSE_TEST_BINARY || process.execPath;
const prefix = process.env.ANYUSE_TEST_BINARY ? [] : [fileURLToPath(new URL("../dist/index.js", import.meta.url))];
const fixedQuote = { id: "automatic-quote", price_usd: "0.020001", requires_budget: false };
const run = ["run", "rednote.search", "--input", '{"keyword":"咖啡"}'];

async function fixture(t, respond = req => req.url === "/v1/quotes"
  ? [201, fixedQuote]
  : [200, { id: "job", status: "succeeded", settlement: "settled", cost_usd: "0.020001" }]) {
  const dir = await mkdtemp(join(tmpdir(), "anyuse-run-"));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const request = { url: req.url, method: req.method, headers: req.headers, body: text ? JSON.parse(text) : undefined };
    requests.push(request);
    const response = respond(request);
    if (response === null) { res.destroy(); return; }
    res.writeHead(response[0], { "Content-Type": "application/json" });
    res.end(JSON.stringify(response[1]));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); });
  const env = { ...process.env, ANYUSE_API_KEY: "test-key", ANYUSE_API_URL: `http://127.0.0.1:${server.address().port}`, ANYUSE_CONFIG_FILE: join(dir, "config.json") };
  delete env.ANYUSE_MAX_COST;
  return { dir, requests, env, cli: (args, overrides = {}) => exec(command, [...prefix, ...args], { cwd: dir, env: { ...env, ...overrides }, timeout: 10000 }) };
}
function failed(code) {
  return error => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, "");
    const result = JSON.parse(error.stderr.trim().split("\n").at(-1));
    assert.equal(result.error.code, code);
    return true;
  };
}

test("one run quotes and executes without confirmation, retaining receipt and recovery fields", async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, "input.json"), '{"keyword":"咖啡"}');
  const { stdout, stderr } = await f.cli(["run", "rednote.search", "--input", "@input.json", "--max-cost", "0.03", "--idempotency-key", "original", "--wait", "--no-input"]);
  assert.deepEqual(f.requests.map(r => r.url), ["/v1/quotes", "/v1/executions", "/v1/executions/job"]);
  assert.deepEqual(f.requests[0].body, { operation: "rednote.search", input: { keyword: "咖啡" } });
  assert.deepEqual(f.requests[1].body, { quote_id: "automatic-quote", max_cost_usd: "0.03" });
  assert.equal(f.requests[1].headers["idempotency-key"], "original");
  const result = JSON.parse(stdout);
  assert.equal(result.id, "job");
  assert.equal(result.quote_id, "automatic-quote");
  assert.equal(result.idempotency_key, "original");
  assert.equal(result.max_cost_usd, "0.03");
  assert.equal(result.cost_usd, "0.020001");
  assert.match(stderr, /Charged: USD 0.020001/);
  assert.doesNotMatch(stderr, /Allow USD/);
});

test("default budget is opt-in, persistent, removable and works without API credentials", async t => {
  const f = await fixture(t);
  await assert.rejects(f.cli(run), failed("budget_required"));
  assert.equal(f.requests.length, 0);
  const offline = { ANYUSE_API_KEY: "", ANYUSE_API_URL: "invalid-url" };
  await f.cli(["config", "set", "max-cost", "0.03"], offline);
  assert.equal(JSON.parse((await f.cli(["config", "get"], offline)).stdout).max_cost_usd, "0.03");
  await f.cli(run);
  assert.equal(f.requests.at(-1).body.max_cost_usd, "0.03");
  await f.cli(["config", "unset", "max-cost"], offline);
  await assert.rejects(f.cli(run), failed("budget_required"));
  assert.deepEqual(JSON.parse(await readFile(f.env.ANYUSE_CONFIG_FILE, "utf8")), {});
});

test("explicit budget overrides environment, which overrides saved default; zero is an explicit limit", async t => {
  const f = await fixture(t);
  await f.cli(["config", "set", "max-cost", "0.01"]);
  await f.cli(run, { ANYUSE_MAX_COST: "0.03" });
  assert.equal(f.requests.at(-1).body.max_cost_usd, "0.03");
  await f.cli([...run, "--max-cost", "0.04"], { ANYUSE_MAX_COST: "0.03" });
  assert.equal(f.requests.at(-1).body.max_cost_usd, "0.04");
  const count = f.requests.filter(r => r.url === "/v1/executions").length;
  await assert.rejects(f.cli([...run, "--max-cost", "0"], { ANYUSE_MAX_COST: "0.03" }), failed("budget_exceeded"));
  assert.equal(f.requests.filter(r => r.url === "/v1/executions").length, count);
});

test("non-interactive over-budget run stops before execution and compares micro-USD exactly", async t => {
  const f = await fixture(t);
  for (const extra of [[], ["--no-input"]]) {
    await assert.rejects(f.cli([...run, "--max-cost", "0.020000", ...extra]), failed("budget_exceeded"));
  }
  assert(f.requests.every(r => r.url === "/v1/quotes"));
  await f.cli([...run, "--max-cost", "0.020001"]);
  assert.equal(f.requests.at(-1).url, "/v1/executions");
});

test("metered quote reserves a positive budget and never interprets zero price as free", async t => {
  const f = await fixture(t, req => req.url === "/v1/quotes"
    ? [201, { ...fixedQuote, requires_budget: true, price_usd: "0.000000" }]
    : [202, { id: "metered", status: "running", settlement: "reserved", cost_usd: null, reserved_usd: "0.15" }]);
  await assert.rejects(f.cli([...run, "--max-cost", "0"]), failed("budget_required"));
  assert.equal(f.requests.length, 1);
  const result = await f.cli([...run, "--max-cost", "0.15"]);
  assert.equal(f.requests.at(-1).body.max_cost_usd, "0.15");
  assert.equal(JSON.parse(result.stdout).cost_usd, null);
  assert.match(result.stderr, /Reserved: USD 0.15; final cost pending/);
  assert.doesNotMatch(result.stderr, /Charged:/);
});

test("free fixed-price operation accepts an explicit zero budget", async t => {
  const f = await fixture(t, req => [200, req.url === "/v1/quotes" ? { ...fixedQuote, price_usd: "0.000000" } : { id: "free", cost_usd: "0.000000" }]);
  await f.cli([...run, "--max-cost", "0"]);
  assert.equal(f.requests.at(-1).body.max_cost_usd, "0");
});

test("invalid budgets and ambiguous run arguments fail before network access", async t => {
  const f = await fixture(t);
  for (const amount of ["-1", "NaN", "1e3", "", "0.0000001", "1000000000", "01", " 1"]) {
    await assert.rejects(f.cli([...run, "--max-cost", amount]), failed("client_error"));
    await assert.rejects(f.cli(["config", "set", "max-cost", amount]), failed("client_error"));
  }
  for (const args of [
    [...run, "--quote", "other"], ["run", "--quote", "other", "--input", "{}"],
    [...run, "extra"], [...run, "--wait", "--timeout", "0"],
    [...run, "--idempotency-key", ""], ["run", "rednote.search"],
    ["run", "rednote.search", "--input", "not-json"],
  ]) await assert.rejects(f.cli([...args, "--max-cost", "0.03"]), failed("client_error"));
  assert.equal(f.requests.length, 0);
});

test("invalid saved config fails visibly; explicit budget can bypass it", async t => {
  const f = await fixture(t);
  await writeFile(f.env.ANYUSE_CONFIG_FILE, '{"max_cost_usd":false}');
  await assert.rejects(f.cli(run), failed("client_error"));
  assert.equal(f.requests.length, 0);
  await f.cli([...run, "--max-cost", "0.03"]);
  assert.equal(f.requests.at(-1).url, "/v1/executions");
});

test("quote API failures and malformed pricing responses never submit executions", async t => {
  for (const response of [[503, { error: { code: "pricing_unavailable", message: "Unavailable" } }], [200, { id: "missing-price" }], [200, { ...fixedQuote, price_usd: "-1" }]]) {
    const f = await fixture(t, () => response);
    await assert.rejects(f.cli([...run, "--max-cost", "0.03"]));
    assert.deepEqual(f.requests.map(r => r.url), ["/v1/quotes"]);
  }
});

test("lost or unconfirmed automatic dispatch preserves original quote, budget and key without retry", async t => {
  for (const response of [null, [503, { execution_id: "pending-job", error: { code: "dispatch_unconfirmed", message: "Keep original request" } }]]) {
    const f = await fixture(t, req => req.url === "/v1/quotes" ? [201, fixedQuote] : response);
    await assert.rejects(f.cli([...run, "--max-cost", "0.03", "--idempotency-key", "original"]), error => {
      assert.equal(error.code, 1);
      const data = JSON.parse(error.stderr.trim().split("\n").at(-1));
      assert.equal(data.quote_id, "automatic-quote");
      assert.equal(data.max_cost_usd, "0.03");
      assert.equal(data.idempotency_key, "original");
      if (response) assert.equal(data.execution_id, "pending-job");
      assert.match(error.stderr, /Quote-ID: automatic-quote/);
      return true;
    });
    assert.deepEqual(f.requests.map(r => r.url), ["/v1/quotes", "/v1/executions"]);
  }
});

test("manual quote remains free and replay submits only the original quote and budget", async t => {
  const f = await fixture(t);
  const quote = JSON.parse((await f.cli(["quote", "rednote.search", "--input", "{}"])).stdout);
  await f.cli(["run", "--quote", quote.id, "--max-cost", "0.03", "--idempotency-key", "original"]);
  assert.deepEqual(f.requests.map(r => r.url), ["/v1/quotes", "/v1/executions"]);
  assert.equal(f.requests[1].headers["idempotency-key"], "original");
});
