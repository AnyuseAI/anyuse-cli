# 资源、索引与写入

保留完整 siteUrl，例如 `sc-domain:example.com`、`https://example.com/shop/`。写入需要用户明确指定动作与目标；尚未入列的目标可以由所有者在连接页填写并授予管理权。对每个目标最多提交一次写请求。

| 操作 | 接受后的读取与解释 |
| --- | --- |
| site.add | site.get/list 查看 Google 角色，所有权可能仍待验证。 |
| site.remove | 从当前 Google 用户的资源集合移除，清除本地站点委托。读取原执行回执；若仍有列表访问权，用 site.list 确认当前可见资源。 |
| sitemap.submit | sitemap.get 检查最近下载、处理、错误及警告。已接受与处理成功分别报告。 |
| sitemap.remove | sitemap.list/get 回查目标提交记录。此操作不会从搜索结果中删除 URL。 |

URL 检查读取 Google 已有索引记录，列出可见的覆盖结论、抓取时间、抓取/索引许可、用户指定及 Google 所选规范页。未返回字段写未知。临时移除、用户管理、实时测试和请求编入索引由用户在 Google Search Console 操作。

回执包含精确目标、动作、执行 ID 和接受状态；回查失败时保留已知的接受结果。原先已提交的地图在响应丢失后仍存在，只能证明当前存在，本次提交仍为 unknown。
