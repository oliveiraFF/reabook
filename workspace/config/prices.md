# 模型单价表（D6 成本看板用）

> 由老板从各平台后台的定价页抄入，D6 `tools/cost-report.mjs` 读这张表算钱。agent 不填价格、不改价格。
> 单位：**元 / 百万 token**。留空 = 该项未定价，看板会标「未定价」，不会按 0 算。
> 「缓存写入」留空时按「输入（未命中缓存）」的单价算。
> 平台的分时段优惠、赠送额度、阶梯价不在这里计算；真实扣费以平台账单为准。
> 价格变了：不要改旧行，新增一行写新的生效日期（YYYY-MM-DD）；看板按每一步的发生时间取当时有效的那一行。生效日期留空 = 一直有效。
> 下面 5 行是 2026-11 会话日志里实际出现过的 provider / model（captain 会话用的是 deepseek-account）。
> 日志里出现、但表里没有的模型，看板会列在「未定价模型」里，照着它显示的 provider / model 加一行即可。

月预算：元

| provider | model | 输入（未命中缓存） | 缓存命中 | 缓存写入 | 输出 | 生效日期 | 价格来源 |
|---|---|---|---|---|---|---|---|
| deepseek-official | deepseek-v4-pro |  |  |  |  |  |  |
| deepseek-official | deepseek-flash |  |  |  |  |  |  |
| deepseek-account | deepseek-v4-pro |  |  |  |  |  |  |
| deepseek-account | deepseek-flash |  |  |  |  |  |  |
| moonshotai-cn | kimi-k3.1-pro |  |  |  |  |  |  |
