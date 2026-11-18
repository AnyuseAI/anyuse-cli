import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Client, waitForExecution } from "../dist/client.js";
const cliCommand = process.env.ANYUSE_TEST_BINARY || process.execPath;
const cliPrefix = process.env.ANYUSE_TEST_BINARY ? [] : [fileURLToPath(new URL("../dist/index.js", import.meta.url))];

test("rejects non-local plaintext URLs and embedded credentials", () => {
  assert.throws(() => new Client("http://example.com"));
  assert.throws(() => new Client("https://secret@example.com"));
});

test("does not resend a paid request or follow redirects with credentials", async (t) => {
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    res.writeHead(302, { Location: "/other" });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const client = new Client(
    `http://127.0.0.1:${server.address().port}`,
    "test-key",
  );
  await assert.rejects(
    client.request("/v1/executions", {
      method: "POST",
      body: {},
      idempotencyKey: "same",
    }),
  );
  assert.equal(calls, 1);
});

test("waits for a terminal status and returns unknown without retrying execution", async () => {
  let calls = 0;
  const result = await waitForExecution(
    {
      request: async () => ({
        status: ++calls === 1 ? "running" : "succeeded",
      }),
    },
    "job",
    2,
  );
  assert.equal(calls, 2);
  assert.equal(result.status, "succeeded");
  const unknown = await waitForExecution(
    { request: async () => ({ status: "unknown" }) },
    "job",
    2,
  );
  assert.equal(unknown.status, "unknown");
});

test("invalid wait timeout is rejected before submitting a paid execution", async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  await assert.rejects(
    promisify(execFile)(
      cliCommand,
      [
        ...cliPrefix,
        "run",
        "--quote",
        "test-quote",
        "--max-cost",
        "0.01",
        "--wait",
        "--timeout",
        "0",
      ],
      {
        env: {
          ...process.env,
          ANYUSE_API_KEY: "test-key",
          ANYUSE_API_URL: `http://127.0.0.1:${server.address().port}`,
        },
      },
    ),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /--timeout must be/);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("unconfirmed dispatch preserves the task ID without automatic retry", async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        execution_id: "unconfirmed-task",
        error: {
          code: "dispatch_unconfirmed",
          message: "Keep the original request",
        },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  await assert.rejects(
    promisify(execFile)(
      cliCommand,
      [
        ...cliPrefix,
        "run",
        "--quote",
        "test-quote",
        "--max-cost",
        "0.01",
        "--idempotency-key",
        "original-request",
        "--wait",
      ],
      {
        env: {
          ...process.env,
          ANYUSE_API_KEY: "test-key",
          ANYUSE_API_URL: `http://127.0.0.1:${server.address().port}`,
        },
      },
    ),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /Idempotency-Key: original-request/);
      const response = JSON.parse(error.stderr.trim().split("\n").at(-1));
      assert.equal(response.execution_id, "unconfirmed-task");
      assert.equal(response.error.code, "dispatch_unconfirmed");
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("SSE preserves split frames and never reconnects an interrupted stream", async (t) => {
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (req.url.endsWith("broken/events")) {
      res.end('event: delta\ndata: {"type":"delta","text":"partial"}\n\n');
      return;
    }
    res.write('event: delta\ndata: {"type":"delta","text":"hel');
    setTimeout(
      () =>
        res.end(
          'lo"}\n\nevent: done\ndata: {"type":"done","status":"succeeded"}\n\n',
        ),
      10,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const client = new Client(
    `http://127.0.0.1:${server.address().port}`,
    "test-key",
  );
  const events = [];
  await client.events("complete", (event) => events.push(event));
  assert.deepEqual(
    events.map((e) => e.type),
    ["delta", "done"],
  );
  assert.equal(events[0].text, "hello");
  await assert.rejects(
    client.events("broken", () => {}),
    (error) =>
      error.code === "stream_interrupted" && error.executionID === "broken",
  );
  assert.equal(calls, 2);
});

test("stream timeout retains the accepted execution ID", async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('event: delta\ndata: {"type":"delta","text":"partial"}\n\n');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const client = new Client(
    `http://127.0.0.1:${server.address().port}`,
    "test-key",
  );
  await assert.rejects(
    client.events("accepted-job", () => {}, AbortSignal.timeout(50)),
    (error) =>
      error.executionID === "accepted-job" &&
      error.code === "stream_interrupted",
  );
});

test("wait timeout and query failure retain the accepted execution ID", async () => {
  await assert.rejects(
    waitForExecution(
      { request: async () => ({ status: "running" }) },
      "accepted-job",
      0,
    ),
    (error) =>
      error.code === "wait_timeout" && error.executionID === "accepted-job",
  );
  await assert.rejects(
    waitForExecution(
      {
        request: async () => {
          throw new Error("connection lost");
        },
      },
      "accepted-job",
      1,
    ),
    (error) =>
      error.code === "execution_query_failed" &&
      error.executionID === "accepted-job",
  );
});

test("CLI stream failure fetches the original execution without resubmitting", async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      res.writeHead(202);
      res.end(
        JSON.stringify({
          id: "accepted-job",
          execution_mode: "stream",
          status: "running",
        }),
      );
    } else if (req.url.endsWith("/events")) {
      res.writeHead(503);
      res.end("{}");
    } else {
      res.end(
        JSON.stringify({
          id: "accepted-job",
          execution_mode: "stream",
          status: "succeeded",
        }),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { stdout, stderr } = await promisify(execFile)(
    cliCommand,
    [
      ...cliPrefix,
      "run",
      "--quote",
      "quote",
      "--max-cost",
      "0",
      "--wait",
      "--timeout",
      "1",
    ],
    {
      env: {
        ...process.env,
        ANYUSE_API_KEY: "test-key",
        ANYUSE_API_URL: `http://127.0.0.1:${server.address().port}`,
      },
    },
  );
  assert.equal(JSON.parse(stdout).id, "accepted-job");
  assert.equal(JSON.parse(stdout).status, "succeeded");
  assert.match(stderr, /querying execution accepted-job/);
  assert.deepEqual(requests, [
    "POST /v1/executions",
    "GET /v1/executions/accepted-job/events",
    "GET /v1/executions/accepted-job",
  ]);
});

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {client: new Client(url, 'test-key'), url};
}

test('wait deadline aborts a slow query before a late running or successful response', async t => {
  for (const status of ['running', 'succeeded']) {
    await t.test(status, async t => {
      let calls = 0;
      let timer;
      const {client} = await serve(t, (req, res) => {
        calls++;
        timer = setTimeout(() => res.end(JSON.stringify({status})), 1000);
      });
      t.after(() => clearTimeout(timer));
      const started = Date.now();
      await assert.rejects(waitForExecution(client, 'original-job', 0.1), error => {
        assert.equal(error.code, 'wait_timeout');
        assert.equal(error.executionID, 'original-job');
        return true;
      });
      assert(Date.now() - started < 800, 'wait must stop before the late server response');
      assert.equal(calls, 1);
    });
  }
});

test('non-JSON HTTP failure retains its status without printing the response body', async t => {
  const {client} = await serve(t, (req, res) => {
    res.writeHead(503, {'Content-Type': 'text/html'});
    res.end('<html>private-proxy-details</html>');
  });
  await assert.rejects(client.request('/v1/wallet'), error => {
    assert.equal(error.status, 503);
    assert.match(error.message, /HTTP 503/);
    assert.doesNotMatch(error.message, /private-proxy-details/);
    return true;
  });
});

test('wait deadline also aborts a stalled JSON body', async t => {
  const {client} = await serve(t, (req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write('{"status":');
  });
  await assert.rejects(waitForExecution(client, 'body-job', 0.1), error =>
    error.code === 'wait_timeout' && error.executionID === 'body-job');
});

test('wait stops at its polling deadline without issuing another query', async t => {
  let calls = 0;
  const {client} = await serve(t, (req, res) => {
    calls++;
    res.end('{"status":"running"}');
  });
  await assert.rejects(waitForExecution(client, 'poll-job', 0.1), error =>
    error.code === 'wait_timeout' && error.executionID === 'poll-job');
  assert.equal(calls, 1);
});

test('exhausted SSE budget still allows one status query with the ordinary request limit', async t => {
  let calls = 0;
  let timer;
  const {client} = await serve(t, (req, res) => {
    calls++;
    timer = setTimeout(() => res.end('{"status":"succeeded"}'), 1100);
  });
  t.after(() => clearTimeout(timer));
  const result = await waitForExecution(client, 'stream-job', 0);
  assert.equal(result.status, 'succeeded');
  assert.equal(calls, 1);
});

test('CLI keeps busy recovery fields and Retry-After without repeating a paid POST', async t => {
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const requests = [];
  const {url} = await serve(t, (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.writeHead(503, {'Content-Type': 'application/json', 'Retry-After': '1'});
    res.end(JSON.stringify({execution_id: 'busy-job', error: {code: 'executor_busy', message: 'Retry with the same Idempotency-Key.'}}));
  });
  await assert.rejects(promisify(execFile)(cliCommand, [...cliPrefix, 'run', '--quote', 'original-quote', '--max-cost', '0.01', '--idempotency-key', 'original-key', '--no-input'], {
    env: {...process.env, ANYUSE_API_KEY: 'test-key', ANYUSE_API_URL: url},
  }), error => {
    assert.equal(error.code, 1);
    const data = JSON.parse(error.stderr.trim().split('\n').at(-1));
    assert.equal(data.quote_id, 'original-quote');
    assert.equal(data.max_cost_usd, '0.01');
    assert.equal(data.idempotency_key, 'original-key');
    assert.equal(data.execution_id, 'busy-job');
    assert.deepEqual(data.error, {code: 'executor_busy', message: 'Retry with the same Idempotency-Key.', status: 503, retry_after: '1'});
    return true;
  });
  assert.deepEqual(requests, ['POST /v1/executions']);
});

test('CLI preserves non-JSON HTTP failures and maps 401 to its authentication exit code', async t => {
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  for (const status of [401, 503]) {
    const {url} = await serve(t, (req, res) => {
      res.writeHead(status, {'Content-Type': 'text/html'});
      res.end('<html>private-proxy-details</html>');
    });
    await assert.rejects(promisify(execFile)(cliCommand, [...cliPrefix, 'balance'], {
      env: {...process.env, ANYUSE_API_KEY: 'test-key', ANYUSE_API_URL: url},
    }), error => {
      assert.equal(error.code, status === 401 ? 3 : 1);
      const data = JSON.parse(error.stderr);
      assert.equal(data.error.status, status);
      assert.match(data.error.message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.stderr, /private-proxy-details/);
      assert.equal(data.error.retry_after, undefined);
      return true;
    });
  }
});

test('CLI exhausted SSE wait queries the original execution once and reports its released outcome', async t => {
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const requests = [];
  const {url} = await serve(t, (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'POST') {
      res.writeHead(202, {'Content-Type': 'application/json'});
      res.end('{"id":"stream-job","execution_mode":"stream","status":"running"}');
    } else if (req.url.endsWith('/events')) {
      res.writeHead(200, {'Content-Type': 'text/event-stream'});
      res.write('data: {"type":"delta","text":"partial"}\n\n');
    } else {
      res.end('{"id":"stream-job","status":"unknown","cost_usd":"0.000000"}');
    }
  });
  await assert.rejects(promisify(execFile)(cliCommand, [...cliPrefix, 'run', '--quote', 'original-quote', '--max-cost', '0.01', '--idempotency-key', 'original-key', '--wait', '--timeout', '1'], {
    env: {...process.env, ANYUSE_API_KEY: 'test-key', ANYUSE_API_URL: url},
  }), error => {
    assert.equal(error.code, 5);
    const result = JSON.parse(error.stdout);
    assert.equal(result.id, 'stream-job');
    assert.equal(result.cost_usd, '0.000000');
    assert.equal(result.cost_usd, '0.000000');
    assert.equal(result.idempotency_key, 'original-key');
    return true;
  });
  assert.deepEqual(requests, ['POST /v1/executions', 'GET /v1/executions/stream-job/events', 'GET /v1/executions/stream-job']);
});
