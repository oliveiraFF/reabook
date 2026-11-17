// D1 编号核对：扫描交付物里引用的编号，对照投喂、模块记忆、素材索引，列出不存在的编号；
// 同时检查每个模块记忆是否超过 50 条、是否有重复编号。只读，不改任何文件。
//
// 用法（Node 18+）：
//   node tools/check-ids.mjs                         扫描 workspace/projects 下全部 .md
//   node tools/check-ids.mjs <交付物路径> [...]        只扫描指定文件或目录
//   --workspace <路径>                               工作区目录，默认是本脚本上一级的 workspace
// 退出码：0 = 全部存在；1 = 有不存在的编号或重复编号；2 = 用法或读取错误。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULES = ['idea', 'script', 'edit', 'asset', 'design', 'captain', 'advocate', 'reviewer', 'data', 'strategist', 'finance', 'coach'];
const FILE_OWNER = { 'idea.md': 'idea', 'script.md': 'script', 'assets.md': 'asset' };
const MEMORY_LIMIT = 50;

const args = process.argv.slice(2);
let ws = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace');
const targets = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace') ws = path.resolve(args[++i] ?? '');
  else targets.push(path.resolve(args[i]));
}
if (!fs.existsSync(path.join(ws, 'feeds'))) {
  console.error(`找不到工作区：${ws}（缺 feeds 目录）`);
  process.exit(2);
}

const read = f => fs.readFileSync(f, 'utf8');
const walk = d => !fs.existsSync(d) ? [] : fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []);
const rel = f => path.relative(ws, f).split(path.sep).join('/');

// ---------- 1. 收集已定义的编号 ----------
const defined = new Set();
const defAt = new Map(); // 编号 -> 定义位置
const addDef = (id, where) => { defined.add(id); if (!defAt.has(id)) defAt.set(id, where); };

// 投喂：列表项开头的编号（「- T-base-01 …」「- S-01-5 …」），以及风格 / 类型投喂文件名前缀
for (const f of walk(path.join(ws, 'feeds'))) {
  read(f).split(/\r?\n/).forEach((l, i) => {
    const m = l.match(/^\s*-\s+((?:[TPE]-[A-Za-z0-9]+-\d{2})|(?:S-\d{2}-\d+))\b/);
    if (m) addDef(m[1], `${rel(f)}:${i + 1}`);
    const row = l.match(/^\|\s*(S-\d{2})\s*\|/); // 蒸馏原料索引行
    if (row && /feeds\/sources\//.test(rel(f))) addDef(row[1], `${rel(f)}:${i + 1}`);
  });
  const fm = path.basename(f).match(/^((?:S|TY)-\d{2})_/);
  if (fm) addDef(fm[1], rel(f));
}

// 素材索引：「| A-0001 | …」
const assetIndex = path.join(ws, 'assets', '_index.md');
if (fs.existsSync(assetIndex)) read(assetIndex).split(/\r?\n/).forEach((l, i) => {
  const m = l.match(/^\|\s*(A-\d{4})\s*\|/);
  if (m) addDef(m[1], `assets/_index.md:${i + 1}`);
});

// 模块记忆：「- M-01 …」，按模块分开
const memory = {}; // 模块 -> Map(编号 -> 行号)
const problems = [];
for (const mod of fs.existsSync(path.join(ws, 'modules')) ? fs.readdirSync(path.join(ws, 'modules')) : []) {
  const f = path.join(ws, 'modules', mod, 'memory.md');
  if (mod.startsWith('_') || !fs.existsSync(f)) continue;
  const ids = new Map();
  read(f).split(/\r?\n/).forEach((l, i) => {
    const m = l.match(/^\s*-\s+(M-\d{2})\b/);
    if (!m) return;
    if (ids.has(m[1])) problems.push(`重复编号：${mod} 记忆里 ${m[1]} 出现两次（第 ${ids.get(m[1])} 行、第 ${i + 1} 行）`);
    else ids.set(m[1], i + 1);
  });
  memory[mod] = ids;
}

// ---------- 2. 扫描交付物里的引用 ----------
const files = (targets.length ? targets : [path.join(ws, 'projects')])
  .flatMap(t => fs.existsSync(t) && fs.statSync(t).isDirectory() ? walk(t) : [t]);
if (!files.length) { console.error('没有可扫描的文件'); process.exit(2); }

const ID_RE = /(?<![A-Za-z0-9-])((?:[TPE]-[A-Za-z0-9]+-\d{2})|(?:S-\d{2}(?:-\d+)?)|(?:TY-\d{2})|(?:A-\d{4})|(?:M-\d{2}))(?![0-9])((?:\s*[～~]\s*\d{1,2})?)/g;

function ownerOf(file) {
  const r = rel(file);
  const base = path.basename(file);
  if (FILE_OWNER[base]) return FILE_OWNER[base];
  const m = r.match(/projects\/[^/]+\/(edit|design)\//);
  return m ? m[1] : null;
}

// M- 编号属于哪个模块：紧挨在前面写了模块名（「script M-02」「idea memory M-01」「modules/idea/memory.md 的 M-01」）就按它，
// 否则按文件归属（idea.md → idea）
function memoryModule(line, idx, fileOwner) {
  const before = line.slice(Math.max(0, idx - 30), idx).replace(/[\s的记忆`/.]|memory|md/g, '');
  return MODULES.find(mod => before.endsWith(mod)) ?? fileOwner;
}

let refCount = 0;
const missing = [];
for (const f of files) {
  const owner = ownerOf(f);
  read(f).split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(ID_RE)) {
      let ids = [m[1]];
      // 区间写法「T-base-01～06」展开为 01…06
      const range = m[2] && m[2].match(/(\d{1,2})$/);
      if (range) {
        const head = m[1].replace(/\d+$/, '');
        const from = Number(m[1].match(/(\d+)$/)[1]);
        const to = Number(range[1]);
        const width = m[1].match(/(\d+)$/)[1].length;
        if (to > from && to - from < 50) ids = Array.from({ length: to - from + 1 }, (_, k) => head + String(from + k).padStart(width, '0'));
      }
      for (const id of ids) {
        refCount++;
        const where = `${rel(f)}:${i + 1}`;
        if (id.startsWith('M-')) {
          const mod = memoryModule(line, m.index, owner);
          if (!mod) { missing.push(`${where}  ${id}  无法判断属于哪个模块的记忆（请写成「idea M-01」这种形式）`); continue; }
          if (!memory[mod]?.has(id)) missing.push(`${where}  ${id}  ${mod} 的记忆里没有这条`);
        } else if (!defined.has(id)) {
          missing.push(`${where}  ${id}  投喂 / 素材索引里没有这个编号`);
        }
      }
    }
  });
}

// ---------- 3. 记忆条数 ----------
const memLines = Object.entries(memory).map(([mod, ids]) => {
  const warn = ids.size > MEMORY_LIMIT ? `  ⚠️ 超过 ${MEMORY_LIMIT} 条上限，先合并再写` : ids.size >= MEMORY_LIMIT - 5 ? '  ⚠️ 接近上限' : '';
  if (ids.size > MEMORY_LIMIT) problems.push(`${mod} 记忆 ${ids.size} 条，超过上限 ${MEMORY_LIMIT}`);
  return `  ${mod.padEnd(9)} ${String(ids.size).padStart(2)} 条${warn}`;
});

// ---------- 4. 报告 ----------
console.log(`编号核对（D1）  工作区：${ws}`);
console.log(`扫描文件 ${files.length} 个，引用 ${refCount} 处；已定义投喂 / 素材编号 ${defined.size} 个`);
console.log('\n模块记忆条数：');
console.log(memLines.join('\n'));
if (missing.length) {
  console.log(`\n❌ 不存在的编号 ${missing.length} 处：`);
  missing.forEach(x => console.log('  ' + x));
} else console.log('\n✅ 引用的编号全部存在');
if (problems.length) {
  console.log('\n❌ 其他问题：');
  problems.forEach(x => console.log('  ' + x));
}
console.log('\n说明：本脚本只核对「编号是否存在」，不判断释义和适用场景是否用对，那部分仍由 reviewer 核对。');
process.exit(missing.length || problems.length ? 1 : 0);
