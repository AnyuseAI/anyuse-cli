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


独立文件构建额外需要 `.bun-version` 指定的 Bun。运行 `npm run build:binary` 和 `npm run test:binary`，分别构建、验证本机目标；`npm run build:binary -- --all` 只表示交叉构建，不代表目标系统运行验证。安装器测试用 `npm run test:install`；Windows 构建后用 `pwsh -File test/install.windows.ps1`。
