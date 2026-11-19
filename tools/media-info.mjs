// D2 素材信息：调用 ffprobe 读出 assets/_index.md 需要的字段（类型、时长/尺寸、编码、大小）。
// 只读：只运行 ffprobe 读取文件头，不改、不移动、不重命名任何素材，也不写任何文件。
//
// 用法（Node 18+）：
//   node tools/media-info.mjs <文件或目录> [...]     目录会递归；跳过 .md 文件和以 . 开头的文件
//   --json                                          输出 JSON（默认输出 Markdown 表格）
// 找 ffprobe 的顺序：环境变量 FFPROBE → E:\tools\ffmpeg 下的 ffprobe.exe → PATH。
// 退出码：0 = 全部读出；1 = 有文件读不出（该行类型写「未知」）；2 = 用法错误或找不到 ffprobe。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const targets = args.filter(a => a !== '--json');
if (!targets.length) {
  console.error('用法：node tools/media-info.mjs <文件或目录> [...] [--json]');
  process.exit(2);
}

// ---------- 找 ffprobe ----------
function findInDir(dir, depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === 'ffprobe.exe') return p;
    if (e.isDirectory()) { const r = findInDir(p, depth + 1); if (r) return r; }
  }
  return null;
}
function works(bin) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; }
}
const candidates = [process.env.FFPROBE, findInDir('E:\\tools\\ffmpeg'), 'ffprobe'].filter(Boolean);
const ffprobe = candidates.find(works);
if (!ffprobe) {
  console.error('找不到 ffprobe：已试过 环境变量 FFPROBE、E:\\tools\\ffmpeg、PATH。');
  console.error('请老板在自己的终端安装：winget install --id Gyan.FFmpeg.Essentials -e --location E:\\tools\\ffmpeg');
  process.exit(2);
}

// ---------- 收集文件 ----------
const files = [];
const walk = p => {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p).sort()) if (!e.startsWith('.')) walk(path.join(p, e));
  } else if (!p.toLowerCase().endsWith('.md')) files.push(p);
};
for (const t of targets) {
  const p = path.resolve(t);
  if (!fs.existsSync(p)) { console.error(`不存在：${p}`); process.exit(2); }
  walk(p);
}
// 显示名：相对第一个目标目录（目标是文件时只写文件名）
const base = fs.statSync(path.resolve(targets[0])).isDirectory() ? path.resolve(targets[0]) : path.dirname(path.resolve(targets[0]));
const shown = f => path.relative(base, f).split(path.sep).join('/');

// ---------- 读信息 ----------
const IMAGE_FMT = /(^|,)(image2|[a-z0-9]+_pipe|png|apng|bmp|webp)(,|$)/;
const num = v => (v === undefined || v === 'N/A' || isNaN(Number(v)) ? null : Number(v));
const fmtSize = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDur = s => `${s.toFixed(1)}s`;
const fps = r => { const [a, b] = String(r || '').split('/').map(Number); return a && b ? +(a / b).toFixed(2) : null; };

function probe(f) {
  const size = fs.statSync(f).size;
  const row = { 文件名: shown(f), 类型: '未知', 时长尺寸: '未知', 编码: '未知', 帧率: null, 大小: fmtSize(size), 备注: '' };
  let info;
  try {
    info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }));
  } catch (e) {
    row.备注 = `ffprobe 读不出：${String(e.stderr || e.message).trim().split(/\r?\n/)[0]}`;
    return row;
  }
  const streams = info.streams || [];
  const fmt = info.format || {};
  const v = streams.find(s => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find(s => s.codec_type === 'audio');
  const dur = num(fmt.duration) ?? num(v && v.duration) ?? num(a && a.duration);
  let wh = '';
  if (v && v.width && v.height) {
    const rot = Math.abs(num((v.side_data_list || []).find(d => d.rotation !== undefined)?.rotation) ?? num(v.tags && v.tags.rotate) ?? 0);
    wh = rot % 180 === 90 ? `${v.height}x${v.width}` : `${v.width}x${v.height}`; // 手机竖拍：按显示方向写
  }
  const isImage = v && (IMAGE_FMT.test(fmt.format_name || '') || (v.nb_frames === '1' && !a));
  if (isImage) {
    row.类型 = '图片';
    row.时长尺寸 = wh || '未知';
    row.编码 = v.codec_name;
  } else if (v) {
    row.类型 = '视频';
    row.时长尺寸 = [dur !== null ? fmtDur(dur) : '时长未知', wh || '尺寸未知'].join(' · ');
    row.编码 = [v.codec_name, a ? a.codec_name : '无音轨'].join(' / ');
    row.帧率 = fps(v.avg_frame_rate) ?? fps(v.r_frame_rate);
  } else if (a) {
    row.类型 = '音频';
    row.时长尺寸 = dur !== null ? fmtDur(dur) : '未知';
    row.编码 = [a.codec_name, a.sample_rate ? `${a.sample_rate} Hz` : null, a.channels ? `${a.channels} 声道` : null].filter(Boolean).join(' · ');
  } else {
    row.备注 = '没有音视频流';
  }
  return row;
}

const rows = files.map(probe);
if (asJson) {
  console.log(JSON.stringify({ ffprobe, files: rows }, null, 2));
} else {
  console.log(`ffprobe：${ffprobe}`);
  console.log(`文件数：${rows.length}\n`);
  console.log('| 文件名 | 类型 | 时长/尺寸 | 编码 | 帧率 | 大小 | 备注 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.文件名} | ${r.类型} | ${r.时长尺寸} | ${r.编码} | ${r.帧率 ?? '—'} | ${r.大小} | ${r.备注 || '—'} |`);
}
process.exit(rows.some(r => r.类型 === '未知') ? 1 : 0);
