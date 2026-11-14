# Anyuse CLI

通过 Anyuse API 发现外部能力，在预算内直接执行任务和查询结果。CLI 自动获取报价，无需每次手动核对。支持同步、异步与流式执行，输出可供脚本和 Agent 处理的 JSON。

**当前为发布准备版本，npm 包、GitHub Release 和在线安装脚本均未发布。** GitHub 组织为 `AnyuseApp`，npm scope 为 `@anyuse`，目标仓库为 `AnyuseApp/cli`。下面的在线命令仅用于正式发布后。

## 仓库范围

本仓库是独立开源 CLI，目标公开仓库为 `AnyuseApp/cli`，采用 MIT 许可证。仅包含命令行客户端、Agent Skill、安装脚本、测试和发布配置。

Anyuse 平台的 Web、管理端、API、执行服务、数据库及部署配置在独立私有仓库维护，不随 CLI 分发。CLI 通过公开 HTTP API 与平台通信，不依赖平台源码、本地目录或 Git 历史。

## 安装

### 独立可执行文件（无需 Node.js、npm 或 Bun）

正式发布后，可以从 GitHub Releases 下载对应系统的 `anyuse-*` 文件和 `.sha256` 校验文件，校验后将可执行文件重命名为 `anyuse`（Windows 为 `anyuse.exe`），放入 PATH 目录。

macOS / Linux 安装入口（尚未上线）：

```sh
curl -fsSL https://github.com/AnyuseApp/cli/releases/latest/download/install.sh | bash
# 指定版本，不含 v 前缀；可用 ANYUSE_INSTALL_DIR 指定安装目录
curl -fsSL https://github.com/AnyuseApp/cli/releases/latest/download/install.sh | ANYUSE_VERSION=0.1.0 bash
```

默认安装到 `~/.local/bin/anyuse`。需要 Bash、curl，以及 sha256sum 或 shasum。脚本会校验下载文件、验证启动后再替换已有版本，不需要 sudo，不自动修改 shell 配置；按提示将安装目录加入 PATH。重复安装用于升级，指定版本用于回退。

Windows x64 在 PowerShell 中下载并执行脚本（尚未上线）：

```powershell
Invoke-WebRequest https://github.com/AnyuseApp/cli/releases/latest/download/install.ps1 -OutFile install-anyuse.ps1
& ./install-anyuse.ps1
# 可指定 -Version 0.1.0 -InstallDir 'C:\Users\you\bin'
```

如果执行策略限制脚本运行，可以按组织策略处理，或直接手动下载 `.exe`。脚本默认使用用户目录 `.local\bin`，不修改持久 PATH。SHA256 用于验证文件完整性；它不是发布者数字签名。当前构建未做 macOS Developer ID 签名/公证或 Windows 代码签名；首次公开发布前需核对目标系统的安全提示与分发要求。

| 独立文件目标 | 架构 |
| --- | --- |
| macOS | Apple Silicon / Intel |
| Linux glibc | x64 / ARM64 |
| Linux musl（如 Alpine） | x64 / ARM64 |
| Windows | x64 |

x64 Linux/Windows 使用 Bun baseline 目标。最低系统要求随固定 Bun 版本，见 [Bun 安装要求](https://bun.sh/docs/installation)。不支持 32 位系统；Windows ARM64 暂时使用 Node/npm 方式。交叉构建成功不代表已在所有系统运行验证，验证范围见 RELEASING.md。

卸载独立版本时删除安装目录中的 `anyuse` 或 `anyuse.exe` 即可。不要同时把两种安装位置都放在 PATH 前面；用 `command -v anyuse`（Windows 用 `Get-Command anyuse`）核对实际运行的版本。

### npm 安装（保留）

需要 Node.js **22.12 或更新版本**。npm 版本无运行时 npm 依赖，不捆绑 Bun。

正式发布后：

```sh
npm install -g @anyuse/cli
anyuse --help
# 或不做全局安装
npx @anyuse/cli --help
```

从当前独立仓库构建安装：

```sh
npm ci
npm run check
npm link
# 也可安装 .bun-version 指定的 Bun 后构建本机独立文件
npm run build:binary
npm run test:binary
```

独立产物位于 `artifacts/`，此目录不进入 Git 或 npm 包。执行独立文件时不需要本地 Node/Bun；只有开发、测试和构建阶段需要工具链。

默认连接 `https://api.anyuse.app`。CLI 安装成功不表示服务已上线；远端服务仍需独立部署。

## 配置与首次调用

公共能力目录无需登录：

```sh
anyuse capabilities search 小红书
anyuse capabilities inspect rednote.search
```

其他命令通过 `ANYUSE_API_KEY` 读取你的 Anyuse Key。请从自己的终端环境或密钥管理工具注入，不把真实 Key 写进聊天、脚本仓库或命令参数。上游供应商密钥由 Anyuse 服务端管理，不交给 CLI。

```sh
# 请将占位符替换为你自己的 Key；不要将真实值提交到 Git。
export ANYUSE_API_KEY='<your-anyuse-key>'
anyuse auth status
anyuse balance
anyuse run rednote.search --input '{"keyword":"咖啡"}' --max-cost 0.10 --wait
```

也可以把输入保存在 JSON 文件，再用 `--input @input.json` 读取。接口参数以 `capabilities inspect` 返回的 schema 为准。

一条 `run` 命令自动获取报价、核对预算并提交执行。预算内不提示确认。需要经常调用时，可以主动保存默认单次预算：

```sh
# 示例上限为每次 0.10 美元，不是接口售价；按你的实际预算设置
anyuse config set max-cost 0.10
anyuse run rednote.search --input @input.json --wait
anyuse config get
# 删除保存的默认预算
anyuse config unset max-cost
```

预算优先级：`--max-cost` > 环境变量 `ANYUSE_MAX_COST` > 保存的默认预算。CLI 不自带消费额度；未配置预算会返回 `budget_required`，不提交执行。`0` 只允许确定免费接口，不能用于按实际用量计费的接口。

配置保存在用户目录的 `.config/anyuse/config.json`；Windows 同样位于用户目录下。可用 `ANYUSE_CONFIG_FILE` 指定其他文件。配置仅保存单次预算，不保存 Key，也不读项目目录中的配置。默认预算适用于该配置下所有接口和 API 地址。`config get` 显示保存值，不包含命令参数或环境变量覆盖值；`config unset` 不会删除环境变量。

报价超过预算时，交互终端显示金额并询问是否仅本次允许该金额，默认拒绝；不会修改已保存预算。标准输入或 stderr 不是终端时，或使用 `--no-input` 时，直接返回 `budget_exceeded`，不提交执行。脚本与 Agent 使用 `--no-input` 可确保即使在终端运行也不等待输入：

```sh
anyuse run rednote.search --input @input.json --max-cost 0.10 --no-input --wait
```

默认预算是**每次上限**，不是整个任务、当天或账户的总预算。多次调用需要调用方单独控制累计费用。想预先比较价格时，仍可单独使用免费报价命令：

```sh
anyuse quote rednote.search --input @input.json
# 提交已经取得的报价，或使用原参数恢复请求
anyuse run --quote QUOTE_ID --max-cost 0.10 --idempotency-key REQUEST_KEY --wait
```

`quote` 与目录查询不收费，`run` 可能产生费用。`--quote` 模式直接提交已有报价，由服务端校验预算；不再次报价，也不弹出提额确认。该模式不能与 operation 或 `--input` 混用。

## 报价与计费

价格由服务端管理端配置，CLI 不预设或计算售价。

- `pricing` 包含定价版本、计费方式、单位价格和数量。
- `requires_budget=false` 时，`price_usd` 是本次确定总价；`--max-cost` 至少覆盖该金额。
- `requires_budget=true` 时，用量执行后才能确定，`price_usd=0` **不表示免费**。提交正数最高预算，服务端先预留，成功后按实际用量结算并释放差额。
- 执行记录的 `reserved_usd` 是初始预留，`cost_usd` 是实际费用；null 表示未结算。`quoted_price_usd` 是原报价总额。
- 用量缺失、结果不确定或费用超过预算时，任务可能进入 `unknown/reserved`，由运营核对，不自动追加扣款。

## 命令

| 命令 | 作用 |
| --- | --- |
| `capabilities search [query]` | 查询当前可报价的能力 |
| `capabilities inspect <operation>` | 查看参数、输出、渠道和定价 |
| `auth status` | 查询当前 Key 对应的身份 |
| `quote <operation> --input <JSON或@文件>` | 生成报价 |
| `run <operation> --input <JSON或@文件> [--max-cost <USD>] [--wait]` | 自动报价，预算内直接执行 |
| `run --quote <id> --max-cost <USD> [--idempotency-key <key>] [--wait]` | 提交已有报价，或重放原请求 |
| `config set max-cost <USD>` | 保存默认单次预算 |
| `config get` / `config unset max-cost` | 查看配置 / 删除默认预算 |
| `jobs get <id>` | 查询执行和结算状态 |
| `jobs wait <id> [--timeout <秒>]` | 等待已有执行，不重新提交 |
| `jobs events <id> [--timeout <秒>]` | 读取一次 SSE 连接，输出 NDJSON |
| `jobs cancel <id>` | 请求取消支持取消的任务 |
| `balance` | 查询余额、预留和可用余额 |
| `usage` | 最近 50 次调用 |
| `keys list` | 列出调用 Key，要求 owner 权限 |
| `keys create --name <名称>` | 创建调用 Key，要求 owner 权限 |
| `keys revoke <id>` | 撤销调用 Key，要求 owner 权限 |
| `--help` / `--version` | 帮助 / 包版本，无需访问网络 |

`--timeout` 为 1–3600 秒，默认 150 秒，适用于等待与事件命令。`run --wait` 等待结束或超时，不等于所有上游都被取消。是否支持取消以执行记录 `can_cancel` 为准。

命令响应 JSON 写 stdout，诊断和错误 JSON 写 stderr；帮助和版本是普通文本。`jobs events` 每行一条 JSON。`run --wait` 的流文本写 stderr，最终执行记录写 stdout。`run` 的 JSON 附带 `quote_id`、`max_cost_usd` 和 `idempotency_key`；stderr 显示实际费用或尚未结算的预留金额。余额可用 `anyuse balance` 查询。

| 退出码 | 含义 |
| --- | --- |
| 0 | 命令成功；仍需查看执行状态，未等待时不代表任务完成 |
| 1 | 参数、网络或请求错误，也包括等待超时 |
| 3 | Key 缺失或身份校验失败 |
| 4 | 执行失败 |
| 5 | 执行结果或费用待核对 |

## 响应丢失与恢复

CLI 不自动重试付费请求。`run` 在提交前把报价 ID、实际使用的预算和幂等键写到 stderr；提交后失败的错误 JSON 也携带这三项恢复信息。响应丢失时保存原值，不能直接重跑 `run <operation>`，因为它会生成新报价。有执行 ID 时先查询：

```sh
anyuse jobs get EXECUTION_ID
anyuse jobs wait EXECUTION_ID --timeout 150
```

如需显式重放，用 `run --quote <原报价ID> --max-cost <原预算> --idempotency-key <原键>`，必须保持三项原值。不要为了重试生成新键或重新报价。`unknown` 保留预留，等待运营核对。SSE 断开后查询原执行，不自动重连或重新提交；流断开可能触发上游取消，只有 `canceled/released` 才能确认预留已释放。

`provider_mode=mock` 是模拟结果，不能作为真实上游调用成功的证明。

## 本地开发与 Agent Skill

```sh
export ANYUSE_API_URL=http://127.0.0.1:8080
# 单次覆盖也可使用 --api-url http://127.0.0.1:8080
npm test
```

API 地址填 origin，不附加 `/v1`。仅回环地址允许 HTTP；其他地址必须使用 HTTPS。测试只启动本机 mock HTTP 服务，不需要 Anyuse 服务端、生产凭证或付费请求。

[Agent Skill](skills/anyuse/SKILL.md) 随源码和 npm 包一起分发，独立构建产物另附 `SKILL.md`，安装脚本不自动配置 Agent。将该目录复制到所用 Agent 的技能目录，具体位置按 Agent 的文档配置。全局 npm 安装后可用 `npm root -g` 找到 `@anyuse/cli/skills/anyuse`。

贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，维护者发布步骤见 [RELEASING.md](RELEASING.md)。MIT 许可证见 [LICENSE](LICENSE)。
