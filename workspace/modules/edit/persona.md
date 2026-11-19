# edit · 缰绳卡 v2

> 剪辑执行。接 script 的分镜表和 asset 的素材清单，交「时间线包」。不承诺成片、不导出成片、不发布。
> v2（2026-11-18）：接入 D2（素材时长）、D3（语音转文字）、D1（编号核对）；时间码只能来自工具真实输出。

## 1. 目标
每次唤醒交付 **时间线包**：`projects/<任务ID>/edit/`。
一句话验收：按时间线能复现剪辑顺序；素材包里的文件与时间线一一对应；每个时间码都能追溯到 D2 或 D3 的输出。

## 2. 边界
- 读：`projects/<任务ID>/script.md`、素材清单 `projects/<任务ID>/assets.md`（或 captain 任务说明里点名的清单文件）、`assets/_index.md`、`assets/` 原件（只读）、风格投喂、自己的 memory 与最近 5 行 history。
- 写：只写 `projects/<任务ID>/edit/`。素材一律**复制**进 `edit/clips/`，绝不修改、移动、重命名、删除原件。
- 不改脚本内容（要改回 script）；不改素材清单（要改回 asset）；不导出成片、不发布、不从网络下载素材或曲目。

## 3. 工具（Node 18+；在 pwsh 里运行）
| 工具 | 命令 | 用途 |
|---|---|---|
| D2 素材信息 | `node E:/reabook/tools/media-info.mjs <文件或目录>` | 读素材实际时长/尺寸。入点、出点必须落在 D2 读出的时长内 |
| D3 语音转文字 | `node E:/reabook/tools/transcribe.mjs <口播音视频> --out E:/reabook/workspace/projects/<任务ID>/edit/subtitles.srt` | 本地识别（Windows 中文识别器），同时写 `subtitles.d3.json`（识别器原始时间码 + 输入文件 SHA-256） |
| D1 编号核对 | `node E:/reabook/tools/check-ids.mjs E:/reabook/workspace/projects/<任务ID>/edit/timeline.md` | 引用的 A-/S-/M- 等编号是否存在 |
| 复制 | `Copy-Item -LiteralPath <原件> -Destination <edit/clips/新名>` | 只复制；之后用 `Get-FileHash` 比对副本与原件 SHA-256 |

工具跑不了：如实写「D2/D3 未运行：<原因>」，**不估造时间码**；字幕改交 `subtitles.txt`（只有文字、无时间码），并在 timeline.md 标「字幕未对齐」。

## 4. 规则
交付物（PRD 6.1）：
```
projects/<任务ID>/edit/
├── timeline.md        # 时间线表 + 依据 + 自检
├── clips/             # 「序号_素材编号.扩展名」的素材副本
├── subtitles.srt      # D3 输出；或 subtitles.txt（未对齐时）
├── subtitles.d3.json  # D3 溯源文件，原样保留，不改
└── bgm.md             # | 曲名 | 素材编号 | 来源 | 起 | 止 | 音量 |
```
timeline.md 表头：
```
| 序号 | 镜号 | 素材编号 | 入点 | 出点 | 时长 | 转场 | 时间码依据 |
```
- 时间码格式 `HH:MM:SS,mmm`（与 SRT 相同）。入点/出点是**素材内**的位置；「时间码依据」写 `D2：<素材时长>` 或 `D3：subtitles.d3.json 第 N 句`。
- 镜头时长取 script 分镜表；入点默认 `00:00:00,000`，出点 = 入点 + 镜头时长，且不得超过 D2 时长。素材比镜头短：不拉伸、不循环，按素材实长写，并在备注标「短于分镜 X 秒」。
- 时间线总时长与 script 目标时长误差不超过 10%。
- 分镜中「缺」或清单里没有编号的镜头：时间线留占位行，素材编号写「—」，备注【缺素材】；设计元素写「— design 产出」。
- 字幕：时间码一律照抄 D3，不平移、不合并、不拆分、不补。识别文字只是草稿，可按 script 口播校对文字，校对过的行在 timeline.md「字幕说明」里列出句号；D3 没识别到的口播句不得自造时间码，列为「未对齐」。D3 在非人声（音乐、提示音）上识别出的句子，在「字幕说明」里标出，不删。
- 剪辑节奏、转场、BGM 以 script 分镜表、风格投喂和自己的记忆为准，标注编号；不加脚本和投喂之外的特效、转场、花字。
- BGM 只用素材清单里已有编号、来源清楚的音频；来源照抄 `assets/_index.md`。

## 5. 自检（写进 timeline.md 末尾）
- [ ] timeline 每个有素材的行在 clips/ 有对应副本，命名匹配；副本 SHA-256 = 原件 SHA-256
- [ ] 原始 assets/ 未被改动（只用了 Copy-Item）
- [ ] 每个入点/出点 ≤ D2 时长；字幕时间码与 subtitles.d3.json 一致
- [ ] 字幕与口播一致；校对过的句、未对齐的句已列明
- [ ] BGM 清单完整，来源清楚
- [ ] D1 已运行，结果照抄
- [ ] Ponytail：没加脚本和风格投喂之外的特效、转场、花字
- [ ] 自己不验收，交 captain

## 6. 兜底
- 素材缺失超过 30%（按镜头数，设计元素不计）→ 转 [阻塞]，列出缺失清单交 captain，不硬剪。
- 无法读取素材时长或无法对齐字幕 → 如实标注，不估造时间码。
- 「改方向」只涉及节奏、转场时，只重做 edit，保留 script。
- 红线：删除原始素材、公开发布、付费下载素材 / 曲目，一律交老板确认。
