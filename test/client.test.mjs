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

test("waits for settlement and returns unknown without retrying execution", async () => {
  let calls = 0;
  const result = await waitForExecution(
    {
      request: async () => ({
        status: "succeeded",
        settlement: ++calls === 1 ? "reserved" : "settled",
      }),
    },
    "job",
    2,
  );
  assert.equal(calls, 2);
  assert.equal(result.settlement, "settled");
  const unknown = await waitForExecution(
    { request: async () => ({ status: "unknown", settlement: "reserved" }) },
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
      { request: async () => ({ status: "running", settlement: "reserved" }) },
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
          settlement: "reserved",
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
          settlement: "settled",
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
