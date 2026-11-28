import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { APIError } from "./client.js";

// Match the API's decimal USD format; compare integer micro-USD, not floats.
export function money(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/.test(value))
    throw new Error("Amount must be a nonnegative USD decimal, at most 9 integer digits and 6 decimal places");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

const configPath = () => process.env.ANYUSE_CONFIG_FILE || join(homedir(), ".config", "anyuse", "config.json");
type Config = { max_cost_usd?: string };

async function readConfig(): Promise<Config> {
  const text = await readFile(configPath(), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}";
    throw error;
  });
  const config = JSON.parse(text) as Config;
  if (!config || Array.isArray(config) || typeof config !== "object" ||
      Object.keys(config).some(key => key !== "max_cost_usd") ||
      (config.max_cost_usd !== undefined && typeof config.max_cost_usd !== "string"))
    throw new Error(`Invalid budget config: ${configPath()}`);
  if (config.max_cost_usd !== undefined) money(config.max_cost_usd);
  return config;
}

export async function configure(action: string, key?: string, value?: string) {
  if (action === "get" && key === undefined)
    return { path: configPath(), ...await readConfig() };
  if (key !== "max-cost" || !["set", "unset"].includes(action) ||
      (action === "unset" && value !== undefined))
    throw new Error("Use config get, config set max-cost <USD>, or config unset max-cost");
  if (action === "set") {
    if (value === undefined) throw new Error("config set max-cost requires a USD amount");
    money(value);
  }
  const config: Config = action === "set" ? { max_cost_usd: value } : {};
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  return { path: configPath(), ...config };
}

export async function configuredMaxCost(override?: string) {
  return override ?? process.env.ANYUSE_MAX_COST ?? (await readConfig()).max_cost_usd;
}

export function budget(value?: string) {
  if (value === undefined)
    throw new APIError("budget_required", "Set --max-cost <USD> or a default with: anyuse config set max-cost <USD>. No execution submitted.", 400);
  return { value, micros: money(value) };
}

export type Quote = { id: string; price_usd: string; requires_budget: boolean; pricing?: { usage_hold_usd?: string } };

export async function authorizeQuote(raw: unknown, limit: ReturnType<typeof budget>, noInput: boolean) {
  const quote = raw as Quote;
  if (!quote || typeof quote.id !== "string" || !quote.id ||
      typeof quote.price_usd !== "string" || typeof quote.requires_budget !== "boolean")
    throw new Error("Invalid quote response; no execution submitted");
  const price = money(quote.price_usd);
  if (quote.requires_budget && limit.micros === 0n)
    throw new APIError("budget_required", "This operation requires a positive budget; price_usd=0 is not a free price. Set --max-cost <USD>. No execution submitted.", 400);
  if (price <= limit.micros) return { quote, maxCost: limit.value };
  const message = quote.pricing?.usage_hold_usd
    ? `The wallet hold of USD ${quote.price_usd} exceeds your per-call budget of USD ${limit.value}. Actual token usage is charged after delivery.`
    : `Quote costs USD ${quote.price_usd}, above your per-call budget of USD ${limit.value}.`;
  if (!noInput && process.stdin.isTTY && process.stderr.isTTY) {
    const readline = createInterface({ input: process.stdin, output: process.stderr });
    const approved = await new Promise<boolean>((resolve) => {
      readline.once("close", () => resolve(false));
      readline.once("SIGINT", () => { readline.close(); resolve(false); });
      readline.question(`${message} Allow USD ${quote.price_usd} for this call only? [y/N] `, answer => {
        resolve(/^(y|yes)$/i.test(answer.trim()));
        readline.close();
      });
    });
    if (approved) return { quote, maxCost: quote.price_usd };
  }
  throw new APIError("budget_exceeded", `${message} No execution submitted. Review the price and rerun with an explicitly approved --max-cost.`, 400);
}
