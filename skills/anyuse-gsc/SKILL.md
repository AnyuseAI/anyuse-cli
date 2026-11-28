---
name: anyuse-gsc
description: 通过 Anyuse 分析已授权站点的 Google 自然搜索表现，诊断 URL 收录和 sitemap，并按用户指定的目标管理 Search Console 资源。竞品和公开关键词调查使用通用 SEO 能力。
---

# Google Search Console

用 `anyuse capabilities search gsc` 查看当前环境开放的操作，用 `anyuse capabilities inspect <operation>` 读取输入、价格、限制。当前目录没有所需操作时，说明该环境的可用范围。CLI 使用 Anyuse 身份。用户在浏览器的 Anyuse「连接」页向 Google 授权，再给当前 API key 或 MCP 客户端选择站点和读写级别。凭证只在对应授权页面输入。

符合资格的工作区使用 GSC 按次费用为零。真实充值到账后自动解锁，也可由管理员单独开通。若返回 `gsc_recharge_required`，引导用户充值或联系管理员；`gsc_access_disabled` 和 `payment_review_required` 需要管理员处理。当前报价为零且 `requires_budget=false` 时可传 `--max-cost 0`，依然遵守站点委托和配额。同一工作区最多并行 4 个 GSC 调用。

| 用户要解决的问题 | 操作与取证 |
| --- | --- |
| 流量变化、页面或查询词贡献、小时趋势 | `gsc.performance.query`。按[数据比较规则](references/performance.md)选择窗口与聚合。 |
| URL 抓取、收录、规范页 | `gsc.url.inspect`。使用 Google 已记录的状态；实时测试和请求收录引导至 Search Console。 |
| 当前 Google 账号的资源或角色 | `gsc.site.list/get`。保留完整资源标识；域资源与路径前缀可能覆盖同一页面。 |
| 地图提交、错误或处理进度 | `gsc.sitemap.list/get`。诊断只读。 |
| 明确添加或移除资源、提交或移除地图 | 按[资源操作与回执](references/site-operations.md)选择 `gsc.site.add/remove` 或 `gsc.sitemap.submit/remove`。 |

明确目标优先，否则使用已委托的默认站点。多个候选会改变结果时，请用户选择。授权管理同一站点并不代表用户要求执行写操作。

用 `anyuse run <operation> --input @input.json --max-cost <本次上限> --no-input --wait` 执行。上限来自用户预算。分页、跨期比较、回查都占总预算，扣除已结算费用和在途预留。连接、站点或管理权限不足时，按错误提示引导用户到连接页。配额或预算耗尽时说明已覆盖范围。

从 `result.data` 取证，区分 live 与 mock。保留原报价、预算、幂等键和 execution ID。中断先 `anyuse jobs get <id>`；写状态 unknown 时只读核对原目标。不要生成新写请求。
