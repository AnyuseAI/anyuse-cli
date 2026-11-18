# 参与开发

需要 Node.js 22.12+ 与 npm；`.nvmrc` 固定本地验证版本。安装依赖后运行：

```sh
npm ci
npm run check
```

`check` 包含类型检查、源码构建、本机 mock 测试，以及 npm 打包后的干净安装验证。测试不依赖 Anyuse 主仓库、生产 API Key 或付费上游。临时测试包会自动删除。

- `src/`：命令入口与 HTTP/SSE 客户端。
- `test/`：网络、幂等恢复、等待和发布输入检查。
- `scripts/`：构建、实际包安装验证、发布输入检查。
- `skills/anyuse/`：随 CLI 分发的 Agent 使用说明。

修改命令或返回行为时，更新帮助、README 和针对行为的测试。服务端定价与协议不在这里重实现。不能自动重试付费请求；保留 `execution_id`、原报价、预算和幂等键，避免重复收费。不能把待核对或未结算结果报告为已成功扣费。

提交 Pull Request 时说明行为变化、验证结果和兼容影响。不要提交 `dist/`、`node_modules/`、测试包、`.env`、`.npmrc`、真实 Key 或用户数据。发布由维护者单独操作，详见 [RELEASING.md](RELEASING.md)。

## 构建独立可执行文件

安装 `.bun-version` 指定的 Bun。在 macOS 或 glibc Linux 上，运行 `npm run build:binary` 和 `npm run test:binary` 构建并验证本机目标。在 Windows x64 上显式传入目标：

```powershell
npm run build:binary -- windows-x64
npm run test:binary -- windows-x64
./test/install.windows.ps1
```

在 musl Linux 上，按架构向构建和测试命令传入 `linux-x64-musl` 或 `linux-arm64-musl`。Unix 安装器测试使用 `npm run test:install`。跨平台构建使用 `npm run build:binary -- --all`，各目标仍需在对应系统验证。
