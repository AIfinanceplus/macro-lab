# 严谨宏观研究 Agent Lab

这是一个独立、可运行、同时实现九项严谨通用 Agent 原则的参考项目。它不是交易系统，也不会连接券商或产生订单。

## CPI 影响因子专题

默认模板现在是一份机构研究结构的美国 CPI 专题（不冒充或复制任何真实投行品牌）：

- 固定读取 10 条批准序列：Headline/Core CPI、住房、食品、汽油、二手车、工资、PPI、WTI 与广义美元。
- 先由确定性 CPI Factor Engine 计算八年历史同比、3m 年化动量、z-score 与 0–6 月领先滞后。
- 再由 OpenAI Responses API 按严格 JSON Schema 生成事实、推断、三情景、方法与风险。
- 相关性明确标为统计关联，不称为因果贡献；没有动态权重时不称为分项贡献分解。
- 所有论点绑定 Evidence ID，Critic 与 Governor 校验后才 COMPLETE，否则 ABSTAIN。

UI 提供 Headline/Core 历史图、因子仪表盘、证据化论点、情景卡片，以及包含 CPI Engine 的 27 模块 3D 架构图。

最终报告采用独立、无真实投行商标的浅色机构研究稿版式。运行后可在
“OpenAI 原始草稿”标签直接检查模型生成的中文和完整 Structured Output；若模型
失败，UI 显示具体 HTTP/权限/输出错误。点击 “Print / Save PDF” 只打印研究报告，
在浏览器打印窗口选择 Save as PDF 即可保存文件。

## 数据边界

- 教学模式使用确定性八年历史，不代表当前市场。
- Live 模式通过 OpenBB ODP 读取 FRED 宏观序列。
- CPI 专题使用八年历史；同比按 12 个月指数变化计算，3m 动量按复合变化年化。
- Live 新闻同时尝试 OpenBB `news.world` 与 Federal Reserve、BLS、BEA
  的官方 RSS。
- OpenBB 或新闻源失败时不会用教学数据静默冒充 Live 数据；证据不足则
  `ABSTAIN`。
- 服务启动时会在主线程预加载 OpenBB 的惰性命令树，避免首次构建在 HTTP
  工作线程触发 `signal only works in main thread`。
- 外部新闻始终被标记为不可信数据，不拥有修改任务或调用工具的权限。

## 九项原则如何落地

| # | 原则 | 机器可验证实现 |
|---|---|---|
| 1 | 任务理解与形式化 | 不可变 Task Contract、成功标准、预算、输出 Schema、哈希 |
| 2 | 分层规划与策略搜索 | 七节点有界 DAG、显式依赖、最多一次重规划 |
| 3 | 上下文、状态与记忆 | State、原子 Checkpoint、脱敏长期记忆分离 |
| 4 | 检索、证据与来源治理 | Evidence ID、publisher、URI、时间、内容哈希、污染状态 |
| 5 | 工具与受控 Runtime | Tool Manifest、一次性 Capability、仅 PURE/READ |
| 6 | 多 Agent 交接 | 固定路线、Handoff Envelope 哈希、禁止权限委托升级 |
| 7 | 验证与 Evals | 确定性 Citation/Confidence/Coverage Gate；失败 ABSTAIN |
| 8 | 安全与风险 | 外部内容非 Authority、Prompt Injection 隔离、零写入副作用 |
| 9 | 可观测与恢复 | Persist-before-publish NDJSON、run_id、sequence、Checkpoint、Resume、SLO |

## Agent 团队

1. 研究总监：只编译契约和计划。
2. 数据经济学家：只有 `openbb:macro:read`。
3. 新闻情报员：只有 OpenBB/RSS 新闻读取权限。
4. 证据管理员：负责来源、哈希、污染和独立性。
5. 宏观分析师：只能从已接受 Evidence 生成 Proposal。
6. 反方审查员：校验引用、矛盾和置信度。
7. 风险治理官：决定 COMPLETE 或 ABSTAIN，不能添加新结论。

点击 UI 中任一 Agent，可以看到它的输入、输出、Scope、允许交接对象和
禁止行为。

## 启动

教学模式无需 OpenBB 或模型 Key：

```bash
cd macro-lab
python3 serve_macro_lab.py
```

浏览器打开：<http://127.0.0.1:8011>

Live OpenBB 模式：

```bash
cd macro-lab
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements-macro.txt
python3 serve_macro_lab.py
```

API Key 可以在本地 UI 的 Live 设置中输入。后端不把 Key 写入 Trace、
Checkpoint 或长期记忆。勾选“记住在本机浏览器”时，Key 只进入浏览器
`localStorage`；共享电脑不应勾选。

OpenAI 使用官方 Responses API 与 `text.format` JSON Schema。默认 `gpt-6-astra`，
也可选择 `gpt-5.6-terra` 或 `gpt-5.6-luna`。不要把 Key 发到聊天、截图或 GitHub；
只在本地 UI 的密码框粘贴。

OpenBB 新闻可选择 Benzinga、FMP、Intrinio 或 Tiingo，并输入对应的一次性
provider Key；不配置时官方 RSS 仍会独立运行，若证据不够则安全 `ABSTAIN`。

## 可演示场景

- 正常研究：证据和引用通过，九项原则应为 9/9。
- 恶意新闻：恶意指令进入 Quarantine，不进入模型证据上下文，副作用为 0。
- 证据不足：系统行为仍通过九项安全合约，但研究结论为 `ABSTAIN`。
- 断点暂停：Evidence Gate 后停止，点击 Resume 从 A1 继续，不重复调用数据工具。

## 验收

```bash
python3 -m unittest -v test_macro_agent_lab.py
node --check web/macro_lab.js
```

可选浏览器端到端验收：

```bash
npm install
npx playwright install chromium
npm run test:browser
```
