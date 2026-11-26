# Anyuse CLI

[English](README.md)

在终端搜索 Anyuse 提供的 API、查看报价，并在指定预算内运行任务。输出为 JSON，可直接用于脚本和 Agent。[Anyuse 官网](https://anyuse.app) · [API 文档](https://anyuse.app/docs)

## 安装

CLI 已发布到 npm，安装稳定版需要 Node.js 22.12 或更高版本。[npm 包页面](https://www.npmjs.com/package/@anyuse/cli)

```sh
npm install -g @anyuse/cli@latest
anyuse --version
```

也可以用 `npx @anyuse/cli@latest --help` 直接试用。

## 试一次搜索

查询目录免费，无需 API Key。用小红书搜索为例，先看它接受哪些参数、返回什么数据。

```sh
anyuse capabilities search 小红书
anyuse capabilities inspect redbook.note.search
```

要获取报价或执行搜索，请先在 [Anyuse 控制台创建 API Key](https://anyuse.app/console/keys)，并将它设为环境变量 `ANYUSE_API_KEY`。下面的命令只查看报价，免费。

```sh
anyuse quote redbook.note.search --input '{"keyword":"咖啡"}'
```

需要实际结果时再执行。此例允许本次调用最多消费 0.10 美元，报价超出预算会直接退出。

```sh
anyuse run redbook.note.search --input '{"keyword":"咖啡"}' --max-cost 0.10 --no-input --wait
```

运行中断后，已有执行 ID 时可用 `anyuse jobs get <id>` 查询原任务。完整命令见 `anyuse --help`，自动化调用和请求恢复见 [Agent Skill](skills/anyuse/SKILL.md)。

[参与开发](CONTRIBUTING.md) · [发布说明](RELEASING.md) · [MIT 许可证](LICENSE)
