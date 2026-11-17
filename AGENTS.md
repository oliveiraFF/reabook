# AGENTS.md — AI Creative Workbench (machine-readable spec)

Audience: AI agents (Claude Code, Codex, DSH captain and members) working on or inside this project.
Human-facing sources: `PRD_v1.8.md` (what to build), `技术实现文档_v1.1.md` (how). If this file conflicts with them, the PRD wins; report the conflict to the owner, do not resolve it silently.
Language: reply to the owner (老板) in **Simplified Chinese**. Keep file names, IDs, status markers and Chinese headings exactly as written.

---

## 0. Ground rules (always apply)

1. Never invent facts, package names, config keys, file paths or IDs. If unknown, say so and mark `UNVERIFIED`.
2. Discussion vs execution: if the owner's message is a question, analysis or "看看/评估/有什么问题", only analyze. Do not edit files or run commands. Execute only after an explicit go-ahead (or a message starting with `【执行】`).
3. Before executing, state: which files change, how far, how to verify. Wait for confirmation.
4. Red lines — always ask, in any phase, even if previously approved:
   - delete or overwrite original assets (`assets/`) or feeds (`feeds/`)
   - change API keys, webhooks, credentials
   - publish anything publicly
   - pay, authorize, or log in
   - create or modify scheduled tasks
   - publish, DM or comment **as a real blogger** (cyber personas are internal only)
5. Never read or print `C:\Users\25370\.dsh\.credentials.yaml` or any key/token. The Web UI URL token is a credential: do not echo it.
6. Do not touch the owner's existing DSH profiles `desktop` and `headless`. This project uses profile `web` only.
7. Smallest sufficient change (Ponytail): no extra variants, abstractions, files or features nobody asked for.

---

## 1. System model

| Layer | Component | Role |
|---|---|---|
| Entry | DSH Web UI `http://127.0.0.1:3080` (token required); P1: Feishu; P1: dsh-cron | receive tasks and triggers |
| Orchestration | `captain` = the current DSH session running AgentTeams | phase gate, routing, cross-model review, retrospective, memory write-back |
| Modules | AgentTeams members in three layers (PRD 5.3): 幕僚室 `strategist` `finance` `advocate` (advice only, P1 except advocate); 执行 Studio `idea` `script` `edit` `asset` `design` `data` `persona-<bloggerID>`; 生活层 `coach` (Phase 2) | produce deliverables / advice |
| Data | `E:\reabook\workspace\` (Markdown files only) | single source of truth |
| Runtime | DSH 0.2.1-rc.2, AgentTeams 0.1.29, Node 24.22.3 (fnm) | execution |

Model routing (cross-model review, PRD FR-13):

| Role | Model | Config |
|---|---|---|
| execution modules | DeepSeek | `memberModel` |
| cross-review | Kimi (`moonshotai-cn / kimi-k3.1-pro`) | dedicated member `reviewer` with `provider`/`model` fixed in the team profile; recorded in `team.json` (system fact). Captain never self-reviews |
| advocate, persona style review | Kimi | member `provider` + `model` |
| captain | any (session model) | models cannot know their own identity (DSH runtime context omits it, verified T16 2026-11-16): never self-report a model name; read models from `team.json` |
| rule | reviewer vendor ≠ executor vendor per `team.json`, otherwise `[阻塞]` | — |

---

## 2. Environment facts (verified 2026-11-11/12)

| Item | Value |
|---|---|
| OS | Windows 11; shell tool inside DSH is `tool-pwsh` (bash disabled on win32) |
| Node | 24.22.3 via fnm, `FNM_DIR=C:\Users\25370\.fnm`; old Node 22 at `D:\node` kept |
| PowerShell profile | `E:\系统文档\文档\WindowsPowerShell\Microsoft.PowerShell_profile.ps1` enables Node 24 |
| pnpm | 12.18.0 (required by `dsh plugin`) |
| DSH home | `C:\Users\25370\.dsh` |
| DSH desktop app | 0.2.1-rc.2 at `E:\deepseek`; uses profile `desktop` only, managed exclusively by the app (CLI cannot read it) |
| Project profile | `C:\Users\25370\.dsh\profiles\web` |
| Patch file | `C:\Users\25370\.dsh\profiles\web\cordis.patch.yml`: providers kimi-coding (unused) + moonshotai-cn; agent-teams `memberLlmProvider: deepseek-official`, `memberModel: deepseek-v4-pro`; teams `chain1` (members idea + script; seeds ONLY the idea step-1 task — captain adds the expand task and a script task depending on it after the owner picks) and `single` (captain-planned, member idea); default model moonshotai-cn/kimi-k3.1-pro. Member `reviewer` (moonshotai-cn/kimi-k3.1-pro) in both teams. Backups `.bak-20261112-chain1`, `.bak-20261115-memberprovider`, `.bak-20261115-single`, `.bak-20261115-noseedscript`, `.bak-20261116-reviewer` |
| Installed plugins (web) | `@nanmicoder/dsh-agent-teams@0.1.29` |
| Permission presets | `read-only`, `workspace-write` (default, approval ask), `danger-full-access` |
| Model keys | entered by owner; Kimi via provider `moonshotai-cn` (Moonshot open-platform key, model Kimi K3.1 Pro) since 2026-11-15 — `kimi-coding` returns 401 for this key, do not use; DeepSeek built-in; agents never handle keys |

Commands (run in a fresh PowerShell so Node 24 is active):

```
dsh web                      # start Web UI; prints URL with token
dsh plugin --profile web list
dsh plugin --profile web add --save-exact <pkg>@<version>
dsh web --dump-config        # inspect composed config
```

Sandbox caveat: if you run inside the Claude desktop app, writes under `%APPDATA%`/`%LOCALAPPDATA%` are redirected to the app's private folder. Install tools outside AppData; let the owner start `dsh web` in their own terminal. Verified 2026-11-15: a `dsh web` started from the Claude app sandbox cannot grant its own sandbox write access to `E:\reabook\workspace` (SetNamedSecurityInfoW, Win32 5); started from the owner's terminal it works. Never approve the ACL-repair escalation (danger-full-access) on the owner's behalf.

---

## 3. Workspace layout

```
E:\reabook\workspace\
  feeds\sources\<bloggerID>\   distillation raw material (read-only) + _index.md
  feeds\thinking\              distilled blogger dossiers <bloggerID>.md (thinking feed)
  feeds\style\  feeds\types\   style and type feeds
  assets\                      original media, READ-ONLY; _index.md maintained by asset
  modules\<module>\            persona.md (harness card), memory.md, history.md (with token column), okr.md
  modules\_模板\  modules\_赛博人物模板\   templates
  projects\<taskID>\           idea.md, script.md, assets.md, edit\, design\
  reviews\流程复盘\  reviews\数据复盘\  reviews\周报\  reviews\_复盘模板.md
  config\                      triggers.md, status-and-review.md, cordis.patch.example.yml
  TODO.md  known-pitfalls.md
  _archive\                    old structure, read-only, do not use
```

---

## 4. IDs (never renumber, never reuse)

| Object | Format | Example | Assigned by |
|---|---|---|---|
| task | `P` + 3 digits | `P001` | captain |
| asset | `A-` + 4 digits | `A-0012` | asset |
| type feed | `TY-` + 2 digits | `TY-03` | owner / captain |
| style feed | `S-` + 2 digits | `S-02` | owner / captain |
| dossier rules | `T-<bloggerID>-NN` (judgment), `P-<bloggerID>-NN` (trade-off), `E-<bloggerID>-NN` (expression) | `T-luo-04` | distillation |
| raw source | `S-NN` inside a blogger folder | `S-07` | asset |
| module memory | `M-NN`, unique per module | `M-03` | captain |

Every deliverable must cite the feed / memory / asset / source IDs it relied on. Citing an ID that does not exist is a defect.

---

## 5. Write ownership

| Path | Writer | Everyone else |
|---|---|---|
| `projects/<taskID>/idea.md` | idea | read |
| `projects/<taskID>/script.md` | script | read |
| `projects/<taskID>/assets.md`, `assets/_index.md` | asset | read |
| `projects/<taskID>/edit/` | edit (copies media, never edits originals) | read |
| `projects/<taskID>/design/` | design | read |
| `modules/*/memory.md`, `modules/*/history.md` | **captain only** | read own |
| `reviews/`, `TODO.md`, `known-pitfalls.md` | captain | read |
| `feeds/`, original files in `assets/` | owner (captain may draft a dossier; owner must approve) | read |
| advocate, persona-* | write nothing; reply via team message | — |

---

## 6. Module contracts

Each module, before work: read its `persona.md`, `memory.md`, last 5 lines of `history.md`, relevant feeds. Never self-approve; captain reviews.

| Module | Input | Output | Must not |
|---|---|---|---|
| idea | task brief, feeds, asset index | step 1 `idea.md`: goal, 3 directions (concept, why with ≥2 judgment-rule IDs, hook, risk), recommendation, cited IDs, open questions. Step 2 (only after the brief states 「老板已选定方向 X」): append 「## 方向 X 展开」 to the same file | write scripts; decide for the owner; expand any direction before the owner picks one |
| script | `idea.md` (owner-chosen direction) | `script.md`: full voiceover, storyboard table `镜号/时长/画面/口播/素材需求/转场`, total length within ±10% | change direction |
| asset | `assets/`, `script.md` | `_index.md` rows `素材编号/文件名/类型/时长尺寸/标签/导入日期/来源`; task list per shot | modify/move/delete originals; download from web |
| edit | `script.md`, asset list | `edit/timeline.md`, `clips/` (copies), `subtitles.srt` or `.txt`, `bgm.md` | fabricate timecodes; export final video; publish |
| design | `idea.md`, style feeds | `design/layers/*.png` (when an image tool exists), `design/design.md` | exceed style-feed palette/fonts/components; pretend images exist |
| reviewer | deliverable + feeds + memories + pitfalls + cited URLs | verdict 通过/打回 with table `问题/位置/依据/严重度/修改要求`; verified-true list; no self-reported model | write files; rewrite deliverables; do the owner's final review |
| advocate | deliverable under review | ≥3 flaws, each tagged `【可行性】` or `【商业】`, severity, evidence, verification method; header `被审查模型：X / 我的模型：Y` | write files; propose rewritten plans |
| persona-<id> | its dossier, sources, deliverable | consult / style review / ideas; header `赛博<名>（AI 模拟）`; every claim cites T-/P-/E-/S- or is marked `【推断】` | claim to be the real person; invent experiences/data; answer about private life |

---

## 7. Status markers (prefix every captain/module message)

`[空闲]` idle · `[思考中]` reading/planning · `[工作中]` producing · `[等待审核]` / `[等待确认]` waiting for owner · `[阻塞]` blocked (must state the blocker and who must act) · `[完成]` delivered and memory written back.

`[阻塞]` triggers: unmet dependency; 3rd rejection of the same module; model API unreachable; reviewer and executor same vendor; budget exceeded.

---

## 8. Flows as state machines

### 8.1 Task chain (first chain: idea → script)

```
RECEIVED
  → captain classifies phase
     discussion → ANALYZE_ONLY (no files, no commands) → END
     execution  → PROPOSE (module combo, files, verification) → [等待确认]
  → owner confirms → AgentTeams plan staged → owner clicks Approve & Run
  → idea RUN (step 1: 3 directions + recommendation) → [等待确认] owner picks direction X
  → captain creates task 「方向 X 展开」 (idea) and a script task depending ONLY on it (never on step 1)
  → idea appends 「## 方向 X 展开」 → script RUN → writes script.md
  → each rejection: captain creates a new revision task for the rejected member; never reuse failed/completed tasks
  → captain creates a review task for member `reviewer` (Kimi, fixed in config) depending on the deliverable task; reviewer replies by team message
       fail → REJECT to module (count++) ; count == 3 → [阻塞]
       pass → REVIEW_CARD [等待审核]: 通过 | 打回 | 改方向
            打回   → REJECT to module
            改方向 → captain names "重做 X，保留 Y，理由" → rerun X
            通过   → RETRO
  → RETRO: write reviews/流程复盘/<date>-<taskID>.md; update memory.md + history.md of each involved module → [完成]
```

No silence = approval. Unanswered review cards: remind every 24 h, never auto-approve.

### 8.2 Blogger distillation → cyber persona

```
owner provides ≥15 public sources → feeds/sources/<id>/ ; asset builds _index.md (S-NN)
→ execution model drafts feeds/thinking/<id>.md: judgment (T-), trade-off (P-), expression (E-), knowledge boundary; every rule cites S-NN
→ review model checks each citation; delete rules without real sources or with over-inference
→ owner review card: 通过 | 打回 (→ redraft)
→ copy modules/_赛博人物模板 → modules/persona-<id>/ ; add member to cordis.patch.yml
→ tests T17, T18, T19 → if unconvincing: revise dossier, bump version
```

Dossier rules: quote at most 15 characters of original text per item; everything else paraphrased. Fewer than 5 judgment rules → persona may consult but must not do style reviews.

### 8.3 Triggers

| ID | When | Wakes | Stops at |
|---|---|---|---|
| C1 | Mon 09:00 `0 9 * * 1` | idea (5 topics) | review card |
| C2 | daily 21:00 `0 21 * * *` | captain (status summary + missed triggers) | push only |
| C3 | Sun 20:00 `0 20 * * 0` | captain (merge memory >50, clean TODO) | push only |
| C4 | Fri 18:00 `0 18 * * 5` | captain writes weekly report `reviews/周报/<YYYY>-W<NN>.md` from history.md + okr.md only | push summary only |
| H1 | hourly 09–23 `0 9-23 * * *` | captain heartbeat: read member status only; flag >60 min no progress, errors, blocked | push `[阻塞]` only if a problem; never restart or reassign |
| R1 | review card unanswered 24 h | captain reminder | never auto-approve |
| E1 | owner message | captain | — |
| E2 | upstream module done | downstream module | — |
| E3 | owner says 「素材到了」 | asset | — |

All triggers stop at the review node. A scheduled task rejected twice in a row is paused and reported.

---

## 9. Memory protocol (PRD FR-10)

- `memory.md` sections: 老板偏好 / 被打回过的原因 / 有效做法 / 清理记录. Each item `M-NN` + source task.
- Max 50 items. Over the limit: merge similar, drop obsolete, log in 清理记录, then write.
- `history.md`: append one row per task: date, taskID, task, trigger ID, result, rejection count, memory IDs written, token. Never edit past rows.
- `okr.md` (PRD FR-15): owner sets, captain drafts; monthly cycle; at the last retro of the month captain fills KR progress from history.md.
- Only captain writes memory. When a rejection was found by the review model, note `由 <model> 发现`.
- Write-back timing: retro, memory, history and known-pitfalls are written ONLY after the owner clicks 通过 on the review card — never while waiting for final review. After each write, re-read the file to confirm the new content exists; if it does not, report `[阻塞]` instead of claiming success.

---

## 10. Review card schema

```
[等待审核] 任务 <taskID> · <scene> · 成品前
交付物：projects/<taskID>/...
依据投喂：<IDs>　引用记忆：<IDs>
自检：<passed>/<total>　交叉验收：执行模型 <X> / 验收模型 <Y>　反调官：<n> 个风险
预计消耗：<tokens>
选项：通过 | 打回 | 改方向（附一句话）
```

Red-line card: `[等待确认] 红线操作：<op>　影响：<what changes, reversible?>　选项：允许一次 | 拒绝`.

---

## 11. Build state (2026-11-12)

| Item | State |
|---|---|
| PRD v1.8 (2026-11-16: FR-13 via `reviewer` member, idea two-step, write-back timing), tech doc v1.1 (2026-11-16, synced to PRD v1.8; figure 6-1 redrawn as images/flow1_第一条链路_v1.1.png), harness cards for all modules, templates, trigger/status specs, config example | done |
| Node 24, pnpm, DSH, AgentTeams (profile `web`) | installed |
| Model keys | Kimi via `moonshotai-cn` (Kimi K3.1 Pro) works 2026-11-15; `kimi-coding` invalid for this key; DeepSeek built-in (`deepseek-v4-pro`, `deepseek-flash`) |
| `cordis.patch.yml` chain1 config | written 2026-11-12 (appended; backup `cordis.patch.yml.bak-20261112-chain1`); `memberModel: deepseek-v4-pro`; loads in `--dump-config` |
| Feeds content | approved 2026-11-12: `feeds/style/S-01_通用短视频.md` (S-01-1…13), `feeds/thinking/base.md` (T-base-01…06, P-base-01…04, E-base-01…04); generic, not a real blogger |
| Ponytail, dsh-cron, dsh-feishu | not installed; add one at a time after chain1 passes (C1–C4, H1 all need dsh-cron) |
| Route decision 2026-11-13 | Tobs plugin evaluated and NOT adopted; stay on AgentTeams + file memory (PRD §20) |
| Tests | T3, T7, T8 passed 2026-11-15 (records in `workspace/reviews/流程复盘/`). Single-module calls use `--profile single`. T8 rerun (P004) passed 2026-11-16: chain1 no-seed-script fix confirmed. Open: DeepSeek account hit `Insufficient Balance (QUOTA)` — owner must top up before further runs; write-back timing + read-after-write rule added to captain card 2026-11-16 (unverified in a run); token column always 「未获取」 (needs D4). T16 passed 2026-11-16 via team: member `reviewer` (moonshotai-cn/kimi-k3.1-pro per team.json) caught both planted errors, captain read models from status, no file writes (earlier same-vendor run had self-misreported). Note: a rejected review task shows status `failed` (verdict needs_revision). T13 (P005, 2026-11-16) FAILED on criterion: idea followed M-06 in content but did not list M-06 (persona only requires citing 偏好 memories); M-01-class issue recurred in first draft, fixed after 1 reviewer rejection. Fix applied to modules/idea/persona.md 2026-11-16 (cite every applied M-NN; self-check against 被打回过的原因); rerun with P006 INVALID (same team, idea member did not re-read the new persona; captain brief primed P005 rejection). T13 PASSED 2026-11-16 with P007 (fresh session + team): first draft cited M-06 and idea read the new persona; caveat: captain brief also named M-06 (from files). Open: M-01-class (unconfirmed specs written as certain hooks) recurred in first drafts of P005/P006/P007, caught only by reviewer |
| Dev items | D1 ID-check script, D2 media-info (ffprobe), D3 speech-to-text, D4 cost stats, D5 start script — none built |
| Deferred: knowledge base (decided 2026-11-16) | Owner: get the chain running first, then build. Plan: add `workspace/knowledge/` in the LLM Wiki pattern (Karpathy, 2026-04): `index.md` + topic pages (e.g. product categories), every fact with an accessible source; captain drafts at retro after 通过, owner approves (same as feeds); C3 weekly lint for contradictions/stale items; goes into PRD v1.9 as an FR-10 extension. No new plugin, no vector retrieval. Start when ANY of: ≥2 tasks in the same product category; any module memory near 50 items; first blogger distillation begins. Reason: idea repeatedly flags 【投喂不足】 for category knowledge and P007 was rejected for unsourced industry claims |

Next steps in order: owner enters keys → read model IDs → write chain1 config (after owner OK) → set session working dir to `E:\reabook\workspace` with `workspace-write` → minimal feeds → tests T3, T7, chain, T16, T13.

Next steps now (2026-11-16): owner final-reviews P005/P006/P007 in DSH → captain writes back (M-01 made specific: product-name adjectives such as 迷你/折叠/旅行 count as unconfirmed; check title, concept, hook and recommendation line by line; update known-pitfalls #1; read after write) → run one more same-category idea task to see whether M-01 still recurs (if yes: add a required 「未确认属性」 table to idea persona §4) → then the deferred knowledge base above.

---

## 12. UNVERIFIED (check before relying on them)

- Model-visible tool names (needed for `toolPolicies.allow`); plugin IDs are known: `tool-fs`, `tool-fs-search`, `tool-pwsh`, `tool-web`, `tool-ask-user`, `tool-schedule`.
- (Resolved 2026-11-16) Profile member rows accept `name`, `role`, `provider`, `model`, `reasoning_effort`, `executionPrompt`, `fallback`, `tool_policy` (AgentTeams 0.1.29 schema).
- (Resolved 2026-11-15) `memberModel` is the bare model id; when a model is offered by several providers (deepseek-v4-pro: deepseek-official + deepseek-account) set `memberLlmProvider` or team creation fails.
- Config row IDs for `@aiwayds/dsh-cron` and `@aiwayds/dsh-feishu`.
- Whether long `protocol` text is truncated.
- (Resolved 2026-11-12) Kimi is a built-in DSH provider: Settings → Models → Add model provider → Third-party model provider → provider id `moonshotai`. Keys are write-only and stored in `$DSH_HOME/.credentials.yaml`; the owner enters them, agents never do.

Mechanisms other than the permission sandbox and AgentTeams task dependencies are prompt-level conventions, not code guarantees. After any config change, rerun the passed tests.

---

## 13. Tests to run (IDs from PRD §14)

| ID | Input | Pass when |
|---|---|---|
| T3 | 「帮我看看这个」 | captain stops with clarifying questions, no execution |
| T7 | 「只调创意，做市场营销方案」 | only idea wakes |
| T8 | video from idea to script | both files exist; script follows chosen direction |
| T13 | repeat a task after a rejection | second deliverable cites the new `M-NN` |
| T16 | idea.md with one unsourced number and one fake feed ID | review lists both; same-vendor setup → `[阻塞]` |
| T17 | ask persona one covered + one uncovered question | IDs cited; uncovered marked `【推断】`; header says AI 模拟 |
| T18 | deliberately off-style script | ≥3 mismatches by 判断/取舍/表达 with IDs |
| T19 | blind test 5 real (paraphrased) + 5 persona texts | owner misclassifies ≥30% |
