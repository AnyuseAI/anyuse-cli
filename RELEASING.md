# 发布 Anyuse CLI

## 安装稳定版

CLI 通过 npm 的 `latest` 标签分发稳定版，需要 Node.js 22.12 或更高版本。历次版本见 [CHANGELOG](CHANGELOG.md)。

```sh
npm install -g @anyuse/cli@latest
anyuse --version
```

GitHub 目前没有独立可执行文件 Release。

## 发布下一版到 npm

1. 在发布提交中更新 `package.json`、`package-lock.json` 和 [CHANGELOG](CHANGELOG.md)。选择 npm 上尚未使用的版本号，已发布的版本无法覆盖。
2. 在仓库根目录运行以下检查。`check` 包含类型检查、构建、命令测试，以及 tarball 的文件清单、干净安装和命令入口验证。`npm pack --dry-run` 可预览本次发布的文件。

   ```sh
   npm ci
   npm run check
   npm pack --dry-run
   ```

3. 首次用 GitHub Actions 发布前，在 GitHub 仓库配置环境 `npm`。在 npm 包设置的 Trusted publishing 中选择 GitHub Actions，填写组织 `AnyuseAI`、仓库 `anyuse-cli`、工作流文件 `publish.yml` 和环境 `npm`，允许直接执行 `npm publish`。工作流使用 OIDC，无需保存 npm 写入 token。新绑定需在两天内首次成功发布。[npm 配置说明](https://docs.npmjs.com/trusted-publishers/)
4. 将工作流放在默认分支，待发布提交的 CI 通过后，为该提交创建并推送 `v<版本>` 标签。在 Actions 中手动运行 **Publish npm package (manual)**，选择该标签，输入完全一致的版本号，正式版选 `latest`，预发布版选 `next`。仅推送标签不会发布。[发布工作流](.github/workflows/publish.yml)
5. 在本次发布标签的仓库根目录读取版本号，再到临时目录从公共 registry 安装该版本。确认命令输出的版本与发布版本一致。若 registry 仍在同步，先重新查询该版本。

   ```sh
   release_version=$(node -p 'require("./package.json").version')
   npm view "@anyuse/cli@$release_version" version dist-tags --registry=https://registry.npmjs.org/
   cd "$(mktemp -d)"
   npm install "@anyuse/cli@$release_version" --registry=https://registry.npmjs.org/
   npm exec --offline -- anyuse --version
   npm exec --offline -- anyuse --help
   ```

## 独立可执行文件

[二进制工作流](.github/workflows/binaries.yml) 使用 `.bun-version` 指定的 Bun，为 macOS、Linux 和 Windows 构建 7 个目标，运行对应测试并上传临时 Actions artifact。构建与测试命令见[参与开发](CONTRIBUTING.md)。

发布独立文件时，从同一标签对应的成功构建收集每个平台的可执行文件。在目标系统验证启动、安装和升级。如果对产物签名或公证，使用最终分发的文件重新生成并验证 SHA256。

在匹配的 GitHub Release 中分别上传可执行文件、同名 `.sha256`、`install.sh`、`install.ps1`、`LICENSE`、`BUN_LICENSE.md`、`THIRD_PARTY_NOTICES.md` 和 `SKILL.md`。安装器按资产名下载文件。向用户提供安装链接前，先验证指定版本的下载与安装；稳定版另验证 `latest/download`。
