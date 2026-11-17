// D4 token 统计：从 DSH 会话日志汇总一个 AgentTeams 团队里各成员、各任务的 token 用量，
// 供 history.md 的「token」列使用。只读，不改任何文件。
//
// 需要 Node 24+（用 zlib.zstdDecompressSync 解压会话日志）。
// 用法：
//   node tools/token-usage.mjs                列出工作区里所有团队（含归档）
//   node tools/token-usage.mjs <团队名>        统计该团队
//   --workspace <路径>   工作区目录，默认是本脚本上一级的 workspace
//   --dsh-home <路径>    DSH 数据目录，默认 %USERPROFILE%\.dsh（或环境变量 DSH_HOME）
//
// 口径：
// - 每个成员的用量 = 该成员会话里每一步模型回复记录的 usage 之和；
// - 每个任务的用量 = 负责成员的会话中，落在任务创建时间到最后更新时间之间的 usage 之和；
// - captain 的用量 = captain 会话中，落在团队创建时间到最后一个任务更新时间之间的 usage 之和
//   （captain 会话可能还做了团队以外的事，这个时间窗只是近似）。
// - 「合计」= totalTokens，含缓存读写；「输入 / 输出」单列，便于估算费用。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

if (typeof zlib.zstdDecompressSync !== 'function') {
  console.error(`需要 Node 24+（当前 ${process.version}）。先在新开的 PowerShell 里运行，或用 tools/start-dsh.ps1 同样的方式启用 Node 24。`);
  process.exit(2);
}

const args = process.argv.slice(2);
let ws = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace');
let dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
let team = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace') ws = path.resolve(args[++i] ?? '');
  else if (args[i] === '--dsh-home') dshHome = path.resolve(args[++i] ?? '');
  else team = args[i];
}

const teamsRoot = path.join(ws, '.agent-teams');
const teamDirs = () => [
  ...(fs.existsSync(teamsRoot) ? fs.readdirSync(teamsRoot) : []).filter(n => n !== 'archive' && fs.existsSync(path.join(teamsRoot, n, 'team.json'))).map(n => ({ name: n, dir: path.join(teamsRoot, n), archived: false })),
  ...(fs.existsSync(path.join(teamsRoot, 'archive')) ? fs.readdirSync(path.join(teamsRoot, 'archive')) : []).filter(n => fs.existsSync(path.join(teamsRoot, 'archive', n, 'team.json'))).map(n => ({ name: n, dir: path.join(teamsRoot, 'archive', n), archived: true })),
];

const fmtTime = ms => new Date(ms).toLocaleString('zh-CN', { hour12: false });

if (!team) {
  const all = teamDirs();
  if (!all.length) { console.log(`${teamsRoot} 下没有团队`); process.exit(0); }
  console.log('团队列表（用法：node tools/token-usage.mjs <团队名>）：');
  for (const t of all) {
    const j = JSON.parse(fs.readFileSync(path.join(t.dir, 'team.json'), 'utf8'));
    console.log(`  ${t.name}${t.archived ? '（已归档）' : ''}  创建于 ${fmtTime(j.createdAt)}  任务 ${j.tasks?.length ?? 0} 个`);
  }
  process.exit(0);
}

const found = teamDirs().find(t => t.name === team);
if (!found) { console.error(`找不到团队 ${team}（在 ${teamsRoot} 和 archive 下都没有）`); process.exit(2); }
const tj = JSON.parse(fs.readFileSync(path.join(found.dir, 'team.json'), 'utf8'));

// 找会话日志：sessions/<任意工作目录键>/<id 或 session-id>/session.v4.jsonl.zstd
const sessionsRoot = path.join(dshHome, 'sessions');
function findSession(id) {
  if (!id || !fs.existsSync(sessionsRoot)) return null;
  const names = [id, id.startsWith('session-') ? id.slice(8) : `session-${id}`];
  for (const key of fs.readdirSync(sessionsRoot)) {
    for (const n of names) {
      const f = path.join(sessionsRoot, key, n, 'session.v4.jsonl.zstd');
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}

// 读出一个会话里每一步的 usage：[{ time, model, input, output, cacheRead, cacheWrite, total }]
const cache = new Map();
function usageOf(id) {
  if (cache.has(id)) return cache.get(id);
  const f = findSession(id);
  let rows = null;
  if (f) {
    rows = [];
    const text = zlib.zstdDecompressSync(fs.readFileSync(f)).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.includes('"assistant/message"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const u = o.type === 'assistant/message' && o.data?.usage;
      if (!u) continue;
      rows.push({
        time: o.time,
        input: u.inputTokens || 0, output: u.outputTokens || 0,
        cacheRead: u.cacheReadTokens || 0, cacheWrite: u.cacheWriteTokens || 0,
        total: u.totalTokens || 0,
      });
    }
  }
  cache.set(id, rows);
  return rows;
}

const sum = (rows, from = -Infinity, to = Infinity) => rows.filter(r => r.time >= from && r.time <= to)
  .reduce((a, r) => ({ steps: a.steps + 1, input: a.input + r.input, output: a.output + r.output, total: a.total + r.total }), { steps: 0, input: 0, output: 0, total: 0 });
const n = x => x.toLocaleString('en-US');

const members = (tj.members || []).map(m => ({ name: m.name, id: m.id, model: `${m.provider ?? '?'}/${m.model ?? '?'}` }));
const lastUpdate = Math.max(tj.createdAt, ...(tj.tasks || []).map(t => t.updatedAt || 0));

console.log(`token 统计（D4）  团队：${found.name}${found.archived ? '（已归档）' : ''}`);
console.log(`时间：${fmtTime(tj.createdAt)} — ${fmtTime(lastUpdate)}\n`);

console.log('| 角色 | 模型（team.json） | 步数 | 输入 | 输出 | 合计（含缓存） |');
console.log('|---|---|---|---|---|---|');
const cap = usageOf(tj.captainSessionId);
if (cap) { const s = sum(cap, tj.createdAt, lastUpdate); console.log(`| captain（时间窗近似） | 会话所选模型 | ${s.steps} | ${n(s.input)} | ${n(s.output)} | ${n(s.total)} |`); }
else console.log(`| captain | — | 未找到会话日志 ${tj.captainSessionId ?? ''} | | | |`);
for (const m of members) {
  const rows = usageOf(m.id);
  if (!rows) { console.log(`| ${m.name} | ${m.model} | 未启动或未找到会话日志 | | | |`); continue; }
  const s = sum(rows);
  console.log(`| ${m.name} | ${m.model} | ${s.steps} | ${n(s.input)} | ${n(s.output)} | ${n(s.total)} |`);
}

console.log('\n| 任务 | 负责成员 | 状态 | 步数 | 合计（含缓存） |');
console.log('|---|---|---|---|---|');
for (const t of tj.tasks || []) {
  const m = members.find(x => x.name === t.assignee);
  const rows = m && usageOf(m.id);
  const s = rows ? sum(rows, t.createdAt, t.updatedAt) : null;
  console.log(`| ${t.id} ${String(t.subject).slice(0, 40)} | ${t.assignee} | ${t.status} | ${s ? s.steps : '—'} | ${s ? n(s.total) : '未获取'} |`);
}
console.log('\n写入 history.md 时，「token」列填该模块在本任务的合计；同一成员处理多个任务时按任务行相加。');
