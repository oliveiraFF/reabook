// D6 成本看板：把工作区下所有 DSH 会话（captain、成员、单独聊天）的 token 用量按模型单价折算成钱，
// 生成一个本地 HTML 看板。只读会话日志和价格表，只写看板文件。
//
// 需要 Node 24+（用 zlib.zstdDecompressSync 解压会话日志）。
// 用法：
//   node tools/cost-report.mjs                 生成本月看板到 workspace/reviews/成本/看板.html
//   --month YYYY-MM      看哪个月（默认本月）
//   --out <路径>         看板输出位置
//   --prices <路径>      价格表，默认 workspace/config/prices.md
//   --workspace <路径>   工作区目录，默认是本脚本上一级的 workspace
//   --dsh-home <路径>    DSH 数据目录，默认 %USERPROFILE%\.dsh（或环境变量 DSH_HOME）
//
// 口径：
// - 每一步模型回复记录的 usage：输入（未命中缓存）、缓存命中、缓存写入、输出分开计价；单价来自 workspace/config/prices.md。
// - 模型取该步回复里记录的 provider / model（不靠模型自报）。
// - 归属：成员会话按 team.json 归到团队、成员和任务；captain 会话按团队时间窗归属；其余会话记为「其他会话」。
// - 是估算：平台的优惠、赠送额度、失败重试是否计费等都不在内，真实扣费以平台账单为准。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

if (typeof zlib.zstdDecompressSync !== 'function') {
  console.error(`需要 Node 24+（当前 ${process.version}）。用 tools/start-dsh.ps1 同样的方式启用 Node 24 后再运行。`);
  process.exit(2);
}

const args = process.argv.slice(2);
let ws = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace');
let dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
let month = localDay(Date.now()).slice(0, 7);
let out = null;
let pricesFile = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace') ws = path.resolve(args[++i] ?? '');
  else if (args[i] === '--dsh-home') dshHome = path.resolve(args[++i] ?? '');
  else if (args[i] === '--month') month = args[++i] ?? month;
  else if (args[i] === '--out') out = path.resolve(args[++i] ?? '');
  else if (args[i] === '--prices') pricesFile = path.resolve(args[++i] ?? '');
}
if (!/^\d{4}-\d{2}$/.test(month)) { console.error(`--month 要写成 YYYY-MM，收到 ${month}`); process.exit(2); }
out ??= path.join(ws, 'reviews', '成本', '看板.html');

function localDay(ms) { return new Date(ms).toLocaleDateString('sv-SE'); } // YYYY-MM-DD，本机时区

// ---------- 价格表 ----------
pricesFile ??= path.join(ws, 'config', 'prices.md');
const prices = [];
let budget = null;
if (fs.existsSync(pricesFile)) {
  for (const line of fs.readFileSync(pricesFile, 'utf8').split(/\r?\n/)) {
    const b = line.match(/^月预算[:：]\s*([\d.]+)/);
    if (b) budget = Number(b[1]);
    if (!line.startsWith('|')) continue;
    const c = line.split('|').slice(1, -1).map(s => s.trim());
    if (c.length < 7 || c[0] === 'provider' || /^-+$/.test(c[0])) continue;
    const num = s => (s === '' || isNaN(Number(s)) ? null : Number(s));
    prices.push({ provider: c[0], model: c[1], input: num(c[2]), cacheRead: num(c[3]), cacheWrite: num(c[4]), output: num(c[5]), from: c[6] || '' });
  }
}
function priceFor(provider, model, day) {
  return prices.filter(p => p.provider === provider && p.model === model && (!p.from || p.from <= day))
    .sort((a, b) => (a.from < b.from ? 1 : -1))[0] ?? null;
}
function costOf(s) {
  const p = priceFor(s.provider, s.model, s.day);
  if (!p) return null;
  const cw = p.cacheWrite ?? p.input;
  const need = [[s.input, p.input], [s.cacheRead, p.cacheRead], [s.cacheWrite, cw], [s.output, p.output]];
  if (need.some(([t, pr]) => t > 0 && pr == null)) return null;
  return need.reduce((a, [t, pr]) => a + (t ? t * pr : 0), 0) / 1e6;
}

// ---------- 团队 ----------
const teamsRoot = path.join(ws, '.agent-teams');
const teams = [];
for (const [dir, archived] of [[teamsRoot, false], [path.join(teamsRoot, 'archive'), true]]) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name, 'team.json');
    if (name === 'archive' || !fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    teams.push({
      name, archived, createdAt: j.createdAt,
      lastUpdate: Math.max(j.createdAt, ...(j.tasks || []).map(t => t.updatedAt || 0)),
      captain: bare(j.captainSessionId), members: (j.members || []).map(m => ({ name: m.name, id: bare(m.id) })),
      tasks: j.tasks || [],
    });
  }
}
function bare(id) { return id ? String(id).replace(/^session-/, '') : null; }
function projectOf(team) {
  if (!team) return '未归属';
  const m = team.name.match(/(?:^|[^a-z])([pt])(\d{2,3})(?:[^0-9]|$)/i);
  return m ? m[1].toUpperCase() + m[2] : team.name;
}

// ---------- 会话 ----------
const sessionsRoot = path.join(dshHome, 'sessions');
const wsNorm = ws.toLowerCase().replace(/[\\/]+$/, '');
const steps = [];
let sessionCount = 0;
if (fs.existsSync(sessionsRoot)) {
  for (const key of fs.readdirSync(sessionsRoot)) {
    const keyDir = path.join(sessionsRoot, key);
    if (!fs.statSync(keyDir).isDirectory()) continue;
    for (const sd of fs.readdirSync(keyDir)) {
      const f = path.join(keyDir, sd, 'session.v4.jsonl.zstd');
      if (!fs.existsSync(f)) continue;
      let text;
      try { text = zlib.zstdDecompressSync(fs.readFileSync(f)).toString('utf8'); } catch { continue; }
      const nl = text.indexOf('\n');
      let head; try { head = JSON.parse(nl < 0 ? text : text.slice(0, nl)); } catch { continue; }
      const cwd = String(head.cwd || '').toLowerCase().replace(/[\\/]+$/, '');
      if (cwd !== wsNorm && !cwd.startsWith(wsNorm + '\\') && !cwd.startsWith(wsNorm + '/')) continue;
      sessionCount++;
      const sid = bare(head.id || sd);
      let cfg = {};
      for (const line of text.split('\n')) {
        if (line.includes('"request/header"')) {
          try { const o = JSON.parse(line); if (o.data?.header?.config) cfg = o.data.header.config; } catch {}
          continue;
        }
        if (!line.includes('"usage"')) continue;
        let o; try { o = JSON.parse(line); } catch { continue; }
        if (o.type !== 'assistant/message' && o.type !== 'assistant/attempt') continue;
        const u = o.data?.usage ?? [...(o.data?.stream || [])].reverse().find(c => c.chunk?.type === 'usage')?.chunk.usage;
        if (!u || !u.totalTokens) continue;
        const resp = [...(o.data?.stream || [])].reverse().find(c => c.chunk?.type === 'finish')?.chunk?.replayState?.response;
        steps.push({
          sid, time: o.time, day: localDay(o.time),
          provider: resp?.provider || cfg.provider || '?', model: resp?.model || cfg.model || '?',
          input: u.inputTokens || 0, output: u.outputTokens || 0,
          cacheRead: u.cacheReadTokens || 0, cacheWrite: u.cacheWriteTokens || 0, total: u.totalTokens || 0,
          failed: o.type === 'assistant/attempt',
        });
      }
    }
  }
}

// ---------- 归属 ----------
const memberOf = new Map();
for (const t of teams) for (const m of t.members) if (m.id) memberOf.set(m.id, { team: t, name: m.name });
const captainTeams = new Map();
for (const t of teams) if (t.captain) captainTeams.set(t.captain, [...(captainTeams.get(t.captain) || []), t]);

for (const s of steps) {
  const mem = memberOf.get(s.sid);
  if (mem) {
    s.module = mem.name; s.team = mem.team;
    s.task = mem.team.tasks.find(t => t.assignee === mem.name && s.time >= t.createdAt && s.time <= (t.updatedAt || Infinity))?.id ?? null;
  } else if (captainTeams.has(s.sid)) {
    s.module = 'captain';
    s.team = captainTeams.get(s.sid).filter(t => s.time >= t.createdAt && s.time <= t.lastUpdate).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  } else {
    s.module = '其他会话'; s.team = null;
  }
  s.project = projectOf(s.team);
  s.cost = costOf(s);
}

// ---------- 汇总 ----------
const inMonth = steps.filter(s => s.day.startsWith(month));
const blank = () => ({ steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, unpricedTokens: 0 });
function add(a, s) {
  a.steps++; a.input += s.input; a.output += s.output; a.cacheRead += s.cacheRead; a.cacheWrite += s.cacheWrite; a.total += s.total;
  if (s.cost == null) a.unpricedTokens += s.total; else a.cost += s.cost;
  return a;
}
const group = (rows, keyFn) => {
  const m = new Map();
  for (const s of rows) { const k = keyFn(s); m.set(k, add(m.get(k) || blank(), s)); }
  return [...m.entries()];
};
const all = steps.reduce(add, blank());
const mon = inMonth.reduce(add, blank());
const byDay = group(inMonth, s => s.day).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const byProject = group(inMonth, s => s.project).sort((a, b) => b[1].total - a[1].total);
const byModule = group(inMonth, s => s.module).sort((a, b) => b[1].total - a[1].total);
const byModel = group(inMonth, s => `${s.provider} / ${s.model}`).sort((a, b) => b[1].total - a[1].total);
const unpriced = group(steps.filter(s => s.cost == null), s => `${s.provider} / ${s.model}`);
const hitRate = a => { const d = a.input + a.cacheRead + a.cacheWrite; return d ? a.cacheRead / d : 0; };
const failedTokens = inMonth.filter(s => s.failed).reduce((a, s) => a + s.total, 0);

// ---------- 输出 ----------
const n = x => Math.round(x).toLocaleString('en-US');
const yuan = x => `${x < 0 ? '-' : ''}¥${Math.abs(x).toFixed(2)}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const costCell = a => (a.unpricedTokens ? `${yuan(a.cost)}<span class="warn">＋${n(a.unpricedTokens)} token 未定价</span>` : yuan(a.cost));

function table(title, rows, label) {
  if (!rows.length) return `<section><h2>${title}</h2><p class="muted">本月没有记录。</p></section>`;
  const max = Math.max(...rows.map(([, a]) => a.total)) || 1;
  return `<section><h2>${title}</h2><div class="scroll"><table>
<thead><tr><th>${label}</th><th>估算费用</th><th>合计 token</th><th class="bar-col"></th><th>输入</th><th>缓存命中</th><th>缓存写入</th><th>输出</th><th>缓存命中率</th><th>步数</th></tr></thead><tbody>
${rows.map(([k, a]) => `<tr><td>${esc(k)}</td><td>${costCell(a)}</td><td>${n(a.total)}</td><td class="bar-col"><span class="bar" style="width:${(a.total / max * 100).toFixed(1)}%"></span></td><td>${n(a.input)}</td><td>${n(a.cacheRead)}</td><td>${n(a.cacheWrite)}</td><td>${n(a.output)}</td><td>${(hitRate(a) * 100).toFixed(0)}%</td><td>${a.steps}</td></tr>`).join('\n')}
</tbody></table></div></section>`;
}

const left = budget != null ? budget - mon.cost : null;
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>成本看板</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--fg:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--bar:#4f6fd8;--warn:#b4541a;--bad:#b3261e;--good:#2e7d4f}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--fg:#ececea;--muted:#a3a39c;--line:#33332f;--bar:#7f9bf0;--warn:#e39a5c;--bad:#f2867e;--good:#72c495}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,"Microsoft YaHei",sans-serif;padding:24px 16px}
main{max-width:1100px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}
.muted{color:var(--muted)}.warn{color:var(--warn);display:block;font-size:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.card b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.card span{color:var(--muted);font-size:12px}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}th{color:var(--muted);font-weight:500;font-size:12px}tr:last-child td{border-bottom:0}
.bar-col{width:18%;min-width:90px}.bar{display:block;height:8px;border-radius:4px;background:var(--bar)}
.bad{color:var(--bad)}.good{color:var(--good)}ul{padding-left:20px}
</style></head><body><main>
<h1>成本看板 · ${month}</h1>
<div class="muted">D6 估算 · 生成于 ${new Date().toLocaleString('zh-CN', { hour12: false })} · 工作区会话 ${sessionCount} 个 · 真实扣费以平台账单为准</div>
<div class="cards">
<div class="card"><span>本月估算费用</span><b>${yuan(mon.cost)}</b>${mon.unpricedTokens ? `<span class="warn">另有 ${n(mon.unpricedTokens)} token 未定价</span>` : ''}</div>
<div class="card"><span>月预算</span><b>${budget != null ? yuan(budget) : '未设'}</b><span>在 config/prices.md 填写</span></div>
<div class="card"><span>预算剩余</span><b class="${left == null ? '' : left < 0 ? 'bad' : 'good'}">${left == null ? '—' : yuan(left)}</b>${left != null && left < 0 ? '<span class="warn">已超预算</span>' : ''}</div>
<div class="card"><span>本月 token（含缓存）</span><b>${n(mon.total)}</b><span>缓存命中率 ${(hitRate(mon) * 100).toFixed(0)}%</span></div>
<div class="card"><span>累计估算费用（全部月份）</span><b>${yuan(all.cost)}</b><span>${n(all.total)} token</span></div>
</div>
${unpriced.length ? `<section><h2>未定价模型</h2><p class="muted">日志里出现了这些模型，但 config/prices.md 里没有完整单价，它们的费用没算进去：</p><ul>${unpriced.map(([k, a]) => `<li>${esc(k)}：${n(a.total)} token</li>`).join('')}</ul></section>` : ''}
${table('按天', byDay, '日期')}
${table('按任务', byProject, '任务 / 团队')}
${table('按模块', byModule, '模块')}
${table('按模型', byModel, 'provider / model')}
<section><h2>口径</h2><ul class="muted">
<li>每一步按「输入（未命中缓存）/ 缓存命中 / 缓存写入 / 输出」分别乘单价；模型取该步回复里记录的 provider / model。</li>
<li>captain 会话按团队时间窗归到任务，团队以外的部分记为「未归属」；没有团队的会话记为模块「其他会话」。</li>
<li>本月失败重试记录到的 token：${n(failedTokens)}（已计入；平台是否收费以账单为准）。</li>
<li>不含 Claude Code 等 DSH 以外工具的消耗。</li>
</ul></section>
</main></body></html>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, 'utf8');

console.log(`成本看板（D6）${month}：估算 ${yuan(mon.cost)}${budget != null ? ` / 预算 ${yuan(budget)}` : '（未设预算）'}，${n(mon.total)} token${mon.unpricedTokens ? `，其中 ${n(mon.unpricedTokens)} token 未定价` : ''}`);
if (unpriced.length) console.log(`未定价模型：${unpriced.map(([k]) => k).join('；')}（在 workspace/config/prices.md 补单价）`);
console.log(`看板：${out}`);
