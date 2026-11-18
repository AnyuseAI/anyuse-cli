# CLI 发布操作

**本地 origin 已指向 `AnyuseAI/anyuse-cli`。首次 npm 发布前请完成以下检查。**

已确认：GitHub 组织 `AnyuseAI`，目标仓库 `AnyuseAI/anyuse-cli`；npm 组织 `anyuse`，包名 `@anyuse/cli`。仓库元数据、安装脚本和 release 测试已同步。CLI 命令名保持 `anyuse`。

## 当前可以执行的本地检查

```sh
npm ci
npm run check
npm pack --dry-run
# 只生成本地 tarball，不发布：
npm pack
```

`check` 测试源码和生成的实际 npm 包，并在临时目录安装验证 `anyuse` 命令。包内容白名单为构建后的 JS、README、LICENSE、package.json 与 Agent Skill；源码、测试、开发依赖、工作流、环境文件和维护文档不在发布包中。安装包不运行生命周期脚本，也不需要编译器。

## 首次对外发布前

1. 确认 GitHub 和 npm 组织的实际名称与所有权；MIT 许可证已由用户确认。确认远程仓库 `AnyuseAI/anyuse-cli` 的可见性为公开，只推送这个独立目录，不导入 Anyuse 服务端仓库历史。
2. 维护者完成代码审阅与提交，在远程 CI 确认 Linux、macOS、Windows 和声明的 Node 版本检查通过。本机测试不代表远程矩阵已通过。
3. 确认正式 API、访问文档和 API Key 创建入口已可用，再移除 README 的“尚未发布”提示，更新 CHANGELOG 的正式日期。
4. 在 GitHub 仓库创建 `npm` environment。启用私密漏洞报告；维护者账户配置 2FA。明确能触发发布的维护者。
5. 核对 `package.json` / `package-lock.json` 版本一致和 npm 名称权限；版本不能覆盖。使用 `npm version <版本> --no-git-tag-version` 可只修改版本文件，随后按项目审阅流程提交并创建匹配的 `v<版本>` tag。

这里只提供后续操作说明。当前没有执行提交、推送、tag 或发布命令。

## 首个 npm 包的建立

Trusted Publisher 通常在**已有包的设置页**绑定；不要假定一个尚不存在的包已经有可配置的发布权限。当前官方流程见 [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)。

获得用户明确发布授权后，由拥有 `@anyuse` 权限的维护者使用个人 npm 账户登录并完成 2FA，先人工发布首个版本：

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public
```

不需要把 npm 登录凭证复制到项目 `.npmrc` 或 GitHub Secrets。本仓库忽略 `.npmrc`。首次人工发布不宣称具有 CI OIDC provenance；后续通过可信发布生成来源证明。

## 后续 GitHub Actions 发布

在 npm 包的 Settings / Trusted publishing 添加 GitHub Actions：

| 项目 | 配置值 |
| --- | --- |
| Organization or user | `AnyuseAI` |
| Repository | `anyuse-cli` |
| Workflow filename | `publish.yml` |
| Environment | `npm` |

使用 GitHub-hosted runner。官方当前要求 npm >=11.5.1、Node >=22.14.0；工作流使用 Node 24 与 npm 11。新绑定的 trusted publisher 需在官方规定的有效期内首次成功发布；当前文档为 2 天，因此在准备实际发布时再绑定，过期后按官方流程重新建立。

提交经过验证的版本并创建 `v<版本>` tag 后，在 GitHub Actions 手动运行 **Publish npm package (manual)**：选择该 tag，输入精确版本，选择 `latest`（正式版）或 `next`（预发布）。脚本会拒绝分支、版本不匹配、仓库元数据不匹配，以及把预发布版本标为 latest。

普通 push、Pull Request 和创建 Release 不会触发发布。工作流只在手动启动后运行检查并发布，不保存长期 npm 写入 Token。公开 GitHub 来源通过可信发布可自动生成 provenance；详情见 [官方说明](https://docs.npmjs.com/trusted-publishers/)。

发布后，在另一干净目录核对 registry 中的版本、实际安装和命令入口；不要用生产付费调用作为安装测试。发布失败先检查 npm 是否已出现该版本，确认状态后处理，不盲目改版本重发。

## 自动化边界

当前准备 npm 包和独立可执行文件两种分发。工作流不自动提交版本、不推送 tag、不创建 GitHub Release，也不部署 Anyuse 服务器。更改版本和正式发布仍是维护者的明确操作。


## 独立可执行文件准备（不发布）

安装 `.bun-version` 指定的 Bun，继续使用 npm 的锁文件管理开发依赖：

```sh
npm ci
npm run check
bun test test/client.test.mjs test/run.test.mjs
npm run build:binary
npm run test:binary
npm run build:binary -- --all
# 也可指定目标，例如 linux-x64 或 linux-arm64-musl
```

构建脚本拒绝非固定版本 Bun。版本号由 package.json 静态导入，Bun 打包时嵌入，无需旁边有 package.json。交叉编译目标需要下载官方 Bun 目标运行时。`BUN_BIN` 可以指定开发机器上的 Bun 路径。

`.github/workflows/binaries.yml` 在 PR、main push 或手动启动时运行 Bun 测试、构建各平台文件并测试实际可执行文件。musl 在 Alpine 容器测试，Windows 还运行 PowerShell 安装器测试；只上传保留 7 天的 Actions artifact，不创建 GitHub Release，不发布 npm。Actions artifact 下载后可能需要重新 chmod；正式安装脚本会设置执行权限。

`artifacts/` 包含二进制、每个文件的 `.sha256`、安装脚本、MIT LICENSE、BUN_LICENSE.md、THIRD_PARTY_NOTICES.md 和 Agent Skill。完整上游声明固定在 Bun 1.4.4；升级 Bun 时同步更新该文件。npm 白名单仍只有原来的 6 个文件。

## 首次 GitHub Release（须另行授权）

1. 确认实际 GitHub 组织名；同步 package.json、锁文件、两份安装脚本默认 Repository、README 链接和测试中的正式仓库配置。
2. 确认 API 可用，目标版本与 tag 一致，npm 与二进制来自同一提交。
3. 等远程各平台 CI 通过。当前本机验证记录只代表实际执行的平台，不能当作全部 CI 已通过。
4. 评估并配置 macOS Developer ID 签名/公证与 Windows 代码签名。当前只有 Bun 的本地构建签名行为，没有配置发布者证书。若签名改变二进制，必须重新生成 SHA256，再验证安装器；不要分发过期校验文件。
5. 从同一提交的成功 CI 收集各目标文件和对应校验文件，以及安装脚本、两份许可证、第三方声明、SKILL.md，放入匹配 `v<版本>` 的 GitHub Release。安装脚本依赖这些精确资产名，不上传只有 Actions zip 的 Release。
6. 版本发布后再验证 `latest/download` 和指定版本安装、升级、卸载流程。预发布不会作为稳定版 latest；测试版用显式版本安装。
7. 如需 `https://anyuse.app/install.sh` 短入口，在主项目 deploy/ 存档部署方式后再配置；当前不改服务器、不声称该 URL 已上线。

当前不自动签名、不创建 Release、不上传公开资产。独立文件发布与 npm 发布可以分别进行；独立安装不依赖 npm 包存在。


## 2026-11-11 本地验证记录

- Bun 1.4.4：现有 9 项客户端测试通过。
- npm：类型检查、12 项测试与 6 文件 npm 包的干净安装通过；普通测试跳过 2 项二进制专用测试，它们在专门运行中执行。
- 7 个目标文件交叉构建及 SHA256 核对通过。
- macOS ARM64 原生、macOS x64（Rosetta）、Linux ARM64/x64 的 glibc 和 musl（本机 Docker，x64 为仿真）分别通过 11 项回归，包含脱离源码且 PATH 无 Node/Bun 的执行。
- Bash 安装器平台选择、带空格路径、升级、固定版本/latest、下载失败、校验失败保留旧文件通过。
- Windows x64 文件已生成；尚未在 Windows 运行，PowerShell 安装器测试已加入 CI，尚未执行。远程 CI、公开 URL、代码签名均未验证。

### 同日更新：预算内直接执行

以下验证针对自动报价、默认预算和终端提额确认的新实现，取代前一阶段的测试数量与包清单：

- `npm run check`：类型检查、23 项测试、7 文件 npm 包干净安装通过；2 项独立文件测试在专门运行中验证。
- Bun 1.4.4 运行 `client` 与 `run` 测试：20 项通过。
- macOS ARM64 与 x64（Rosetta）新版独立文件各通过 22 项回归。
- Node 与 macOS ARM64 独立文件各通过 6 项伪终端交互检查：同意、拒绝、回车默认拒绝、Ctrl-C、Ctrl-D、`--no-input`。一次性提额不修改默认配置。
- 7 个目标已重新构建并生成 SHA256；安装器与 Skill 随构建更新。Linux / Windows 新版运行验收留给对应 CI；此前旧版本的运行结果不能替代新版验收。
- 本轮仅使用本机 mock，不调用付费上游，不设置维护者真实默认预算，不提交、推送或发布。
