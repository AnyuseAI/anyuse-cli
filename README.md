# Anyuse CLI

Search the Anyuse API catalog from your terminal, get a price quote, and run an operation with a per-call spending limit. The CLI returns JSON for scripts and agents.

[中文文档](README.zh-CN.md) · [API docs](https://anyuse.app/docs) · [npm package](https://www.npmjs.com/package/@anyuse/cli)

## Install

With Node.js 22.12 or later, install the CLI and check the version:

```sh
npm install -g @anyuse/cli@latest
anyuse --version
```

To see the available commands without a global install, run `npx @anyuse/cli@latest --help`.

## Find an operation

Catalog searches are free and work without an API key. For example, find the Xiaohongshu (RedNote) search operation and inspect its input schema and pricing.

```sh
anyuse capabilities search redbook
anyuse capabilities inspect redbook.note.search
```

## Get a quote

Create an API key in the [Anyuse console](https://anyuse.app/console/keys) and set the `ANYUSE_API_KEY` environment variable in your shell. A quote is free. This example asks what it would cost to search for posts about coffee.

```sh
anyuse quote redbook.note.search --input '{"keyword":"coffee"}'
```

## Run with a spending limit

When you want the search results, run the operation with a budget in USD. The command below gets a fresh quote and submits the search if it fits within $0.10. With `--no-input`, an over-budget quote makes the command exit before submission. Use `--wait` to wait for the result.

```sh
anyuse run redbook.note.search --input '{"keyword":"coffee"}' --max-cost 0.10 --no-input --wait
```

If the wait is interrupted and you have an execution ID, check the existing job with `anyuse jobs get <execution-id>`. For request recovery and automation examples, see the [agent skill](skills/anyuse/SKILL.md) (in Chinese).

[Contributing](CONTRIBUTING.md) · [Release guide](RELEASING.md) · [MIT license](LICENSE)

For Search Console workflows, register the entire [anyuse-gsc skill directory](skills/anyuse-gsc/SKILL.md) with your agent. The npm package contains it under `skills/anyuse-gsc/`. Check the live capability catalog for availability.

### Jina Search billing

Jina Search (`search.jina.web`) bills actual tokens reported by the provider. At the current tariff, 10,000 tokens cost $0.000525 and 20,000 cost $0.001050. The quote’s `pricing.usage_hold_usd` is a temporary wallet reservation covering the provider’s 2,000,000-token maximum ($0.105 at this tariff). Check the live quote and the user's spending authorization. Submit without `max_cost_usd` or pass the quoted hold. A smaller limit, insufficient available balance or insufficient API-key allowance prevents dispatch. Successful settlement releases unused funds.
With `anyuse run search.jina.web`, the CLI uses the quoted hold automatically when no spending limit is configured. An existing lower limit still applies. An already approved Jina quote also supports `anyuse run --quote <id>` without a configured limit. Replay with the original idempotency key and preserve whether the amount was omitted.
