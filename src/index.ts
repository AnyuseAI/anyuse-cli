#!/usr/bin/env node
import metadata from "../package.json" with { type: "json" };
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { APIError, Client, waitForExecution } from "./client.js";
import { authorizeQuote, budget, configure, configuredMaxCost } from "./budget.js";

const help = `anyuse — give your agent access to external capabilities

  anyuse --version
  anyuse capabilities search [query]
  anyuse capabilities inspect <operation>
  anyuse auth status
  anyuse quote <operation> --input '{"keyword":"咖啡"}'
  anyuse run <operation> --input @input.json [--max-cost <USD>] [--wait]
  anyuse run search.jina.web --input '{"query":"coffee"}' --wait
  anyuse run --quote <quote-id> [--max-cost <USD>] [--idempotency-key <key>] [--wait]
  anyuse config set max-cost <USD>
  anyuse config get
  anyuse config unset max-cost
  anyuse jobs cancel <id>
  anyuse jobs events <id>
  anyuse jobs get <id>
  anyuse jobs wait <id> [--timeout 150]
  anyuse balance
  anyuse usage
  anyuse keys list
  anyuse keys create --name <name>
  anyuse keys revoke <id>

--api-url <URL> overrides the API address for this command.
Environment: ANYUSE_API_URL, ANYUSE_API_KEY, ANYUSE_MAX_COST, ANYUSE_CONFIG_FILE.
--input accepts JSON or @file.json. Budget precedence: --max-cost > env > config.
run automatically quotes and executes within budget. For a saved Jina Search quote, omit --max-cost to use its hold. Other saved quotes require a maximum.
Over budget: asks once in a terminal; --no-input or non-interactive use fails instead.
Command responses are JSON; help and version are plain text.
Jina Search bills actual tokens and automatically uses the quoted wallet hold when no limit is set.
run may incur charges; quote and discovery do not. No automatic paid retries.
`;

let submission: { quote_id: string; max_cost_usd?: string; idempotency_key: string } | undefined;

async function input(value?: string) {
  if (value === undefined) throw new Error("--input is required");
  const text = value.startsWith("@") ? await readFile(value.slice(1), "utf8") : value;
  if (Buffer.byteLength(text) > 30_000) throw new Error("Input is too large");
  return JSON.parse(text);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      input: { type: "string" },
      quote: { type: "string" },
      "max-cost": { type: "string" },
      "idempotency-key": { type: "string" },
      wait: { type: "boolean" },
      "no-input": { type: "boolean" },
      timeout: { type: "string", default: "150" },
      name: { type: "string" },
      "api-url": { type: "string" },
    },
  });
  if (values.version) {
    process.stdout.write(metadata.version + "\n");
    return;
  }
  if (values.help || positionals.length === 0) {
    process.stdout.write(help);
    return;
  }
  const [command, action, argument] = positionals;
  if (command === "config") {
    if (positionals.length > 4) throw new Error("Too many config arguments");
    const result = await configure(action, argument, positionals[3]);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  const client = new Client(values["api-url"]);
  let result: any;
  if (command === "capabilities" && action === "search")
    result = await client.request(
      `/v1/capabilities?q=${encodeURIComponent(positionals.slice(2).join(" "))}`,
      { public: true },
    );
  else if (command === "capabilities" && action === "inspect" && argument)
    result = await client.request(
      `/v1/capabilities/${encodeURIComponent(argument)}`,
      { public: true },
    );
  else if (command === "auth" && action === "status")
    result = await client.request("/v1/me");
  else if (command === "quote" && action) {
    result = await client.request("/v1/quotes", {
      method: "POST",
      body: { operation: action, input: await input(values.input) },
    });
  } else if (command === "run") {
    if (positionals.length > 2 || (!action && !values.quote) ||
        (action && values.quote) || (values.quote && values.input !== undefined))
      throw new Error("Use run <operation> --input <JSON|@file> or run --quote <id>; do not combine them");
    const waitSeconds = values.wait ? timeout(values.timeout!) : 0;
    const configured = await configuredMaxCost(values["max-cost"]);
    const allowQuotedHold = !action || action === "search.jina.web";
    const limit = !allowQuotedHold || configured !== undefined ? budget(configured) : undefined;
    const key = values["idempotency-key"] ?? randomUUID();
    if (!key.trim() || Buffer.byteLength(key) > 128)
      throw new Error("--idempotency-key must be 1–128 bytes");
    let quoteID = values.quote;
    let maxCost = limit?.value;
    if (action) {
      const response = await client.request("/v1/quotes", {
        method: "POST",
        body: { operation: action, input: await input(values.input) },
      });
      const quoted = response as { pricing?: { usage_hold_usd?: string }; price_usd?: string; requires_budget?: boolean };
      const hold = quoted?.requires_budget === false && quoted.pricing?.usage_hold_usd === quoted.price_usd
        ? quoted.price_usd : undefined;
      const authorized = await authorizeQuote(response, limit ?? budget(hold), !!values["no-input"]);
      quoteID = authorized.quote.id;
      maxCost = authorized.maxCost;
    }
    submission = { quote_id: quoteID!, max_cost_usd: maxCost, idempotency_key: key };
    process.stderr.write(
      `Quote-ID: ${quoteID}\nMax-Cost-USD: ${maxCost ?? "omitted (quoted usage hold)"}\nIdempotency-Key: ${key}\nKeep these values if the response is lost; do not run the operation again.\n`,
    );
    result = await client.request("/v1/executions", {
      method: "POST",
      body: { quote_id: quoteID, max_cost_usd: maxCost },
      idempotencyKey: key,
    });
    if (values.wait) {
      const deadline = Date.now() + waitSeconds * 1000;
      if (
        result.execution_mode === "stream" &&
        ["dispatching", "running", "cancel_requested"].includes(result.status)
      ) {
        try {
          await client.events(
            result.id,
            (event) => {
              if (event.type === "delta")
                process.stderr.write(event.text || "");
            },
            AbortSignal.timeout(waitSeconds * 1000),
          );
        } catch (error) {
          process.stderr.write(
            `\n${error instanceof Error ? error.message : String(error)}; querying execution ${result.id}.\n`,
          );
        }
      }
      result = await waitForExecution(
        client,
        result.id,
        Math.max(0, (deadline - Date.now()) / 1000),
      );
    }
    result = { ...result, ...submission };
    if (result.cost_usd != null)
      process.stderr.write(`Charged: USD ${result.cost_usd}\n`);
  } else if (command === "jobs" && action === "events" && argument) {
    await client.events(
      argument,
      (event) => process.stdout.write(JSON.stringify(event) + "\n"),
      AbortSignal.timeout(timeout(values.timeout!) * 1000),
    );
    return;
  } else if (command === "jobs" && action === "cancel" && argument) {
    result = await client.request(
      `/v1/executions/${encodeURIComponent(argument)}/cancel`,
      { method: "POST" },
    );
  } else if (
    command === "jobs" &&
    argument &&
    ["get", "wait"].includes(action)
  ) {
    result =
      action === "get"
        ? await client.request(
            `/v1/executions/${encodeURIComponent(argument)}`,
          )
        : await waitForExecution(client, argument, timeout(values.timeout!));
  } else if (command === "balance")
    result = await client.request("/v1/wallet");
  else if (command === "usage") result = await client.request("/v1/executions");
  else if (command === "keys" && action === "list")
    result = await client.request("/v1/keys");
  else if (command === "keys" && action === "create" && values.name)
    result = await client.request("/v1/keys", {
      method: "POST",
      body: { name: values.name },
    });
  else if (command === "keys" && action === "revoke" && argument) {
    await client.request(`/v1/keys/${encodeURIComponent(argument)}`, {
      method: "DELETE",
    });
    result = { revoked: argument };
  } else throw new Error("Unknown command. Run anyuse --help");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result?.status === "failed") process.exitCode = 4;
  if (result?.status === "unknown") process.exitCode = 5;
}
function timeout(value: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 3600)
    throw new Error("--timeout must be 1–3600 seconds");
  return n;
}

main().catch((error) => {
  const message =
    error instanceof APIError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Unknown error";
  process.stderr.write(
    JSON.stringify({
      ...submission,
      execution_id: error instanceof APIError ? error.executionID : undefined,
      error: {
        code: error instanceof APIError ? error.code : "client_error",
        message,
        status: error instanceof APIError ? error.status : undefined,
        retry_after: error instanceof APIError ? error.retryAfter : undefined,
      },
    }) + "\n",
  );
  process.exitCode = error instanceof APIError && error.status === 401 ? 3 : 1;
});
