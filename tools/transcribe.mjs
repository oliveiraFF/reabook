// D3 语音转文字：本地识别音视频里的人声，输出带时间码的 .srt（或 .txt）。不联网、不用密钥。
// 流程：ffmpeg 把输入解码成 16 kHz 单声道 wav（临时文件）→ Windows 自带中文识别器（System.Speech，
//      由 tools/transcribe-sapi.ps1 在 Windows PowerShell 5.1 里运行）→ 每句的起点/时长原样写进字幕。
// 时间码全部来自识别器的 AudioPosition / Duration，脚本不估、不补、不平移。
// 识别器中文准确率有限：文字只当草稿，edit 可按 script 口播校对文字，但不得改时间码。
// 只读输入文件；临时 wav 写在输出目录（或系统临时目录），用完即删。拒绝把输出写进 workspace/assets/。
//
// 用法（Node 18+，Windows）：
//   node tools/transcribe.mjs <音视频文件> [--out <路径.srt|.txt>] [--lang zh-CN]
//   不给 --out：SRT 打印到标准输出。给 --out：同时写一份 <同名>.d3.json（识别器原始输出 + 输入文件 SHA-256），
//   用来追溯每条时间码。
// 找 ffmpeg 的顺序（同 D2）：环境变量 FFMPEG → E:\tools\ffmpeg 下的 ffmpeg.exe → PATH。
// 退出码：0 = 成功；1 = 解码/识别失败或没识别到语音（不写字幕文件）；2 = 用法错误、找不到 ffmpeg 或识别器。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const die = (code, msg) => { console.error(msg); process.exit(code); };

// ---------- 参数 ----------
const argv = process.argv.slice(2);
let input = null, out = null, lang = 'zh-CN';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') out = argv[++i];
  else if (argv[i] === '--lang') lang = argv[++i];
  else if (!input) input = argv[i];
  else die(2, `多余的参数：${argv[i]}`);
}
if (!input || (argv.includes('--out') && !out)) {
  die(2, '用法：node tools/transcribe.mjs <音视频文件> [--out <路径.srt|.txt>] [--lang zh-CN]');
}
input = path.resolve(input);
if (!fs.existsSync(input) || !fs.statSync(input).isFile()) die(2, `找不到输入文件：${input}`);
const fmt = out ? path.extname(out).toLowerCase() : '.srt';
if (!['.srt', '.txt'].includes(fmt)) die(2, `--out 只支持 .srt 或 .txt：${out}`);
if (out) {
  out = path.resolve(out);
  const norm = out.toLowerCase().replace(/\\/g, '/');
  if (/\/workspace\/assets(\/|$)/.test(norm)) die(2, `拒绝写入原始素材目录：${out}`);
}

// ---------- 找 ffmpeg ----------
function findInDir(dir, depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === 'ffmpeg.exe') return p;
    if (e.isDirectory()) { const r = findInDir(p, depth + 1); if (r) return r; }
  }
  return null;
}
function findFfmpeg() {
  if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  const local = findInDir('E:\\tools\\ffmpeg');
  if (local) return local;
  const r = spawnSync('where', ['ffmpeg'], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.split(/\r?\n/)[0].trim();
  return null;
}
const ffmpeg = findFfmpeg();
if (!ffmpeg) die(2, '找不到 ffmpeg。请老板在自己终端运行：winget install Gyan.FFmpeg.Essentials（或设环境变量 FFMPEG）');

// ---------- 解码成 16 kHz 单声道 wav ----------
const tmpDir = out ? path.dirname(out) : os.tmpdir();
fs.mkdirSync(tmpDir, { recursive: true });
const tmpWav = path.join(tmpDir, `.d3-tmp-${process.pid}.wav`);
const cleanup = () => { try { fs.unlinkSync(tmpWav); } catch {} };
// 显式退出会跳过 finally，错误路径由退出事件清理临时 wav。
process.once('exit', cleanup);

let segs;
try {
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', tmpWav], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    die(1, `ffmpeg 解码失败（可能没有音轨或文件损坏）：${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }

  // ---------- 识别 ----------
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(HERE, 'transcribe-sapi.ps1'), '-Wav', tmpWav, '-Culture', lang],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (ps.error) die(2, `无法启动 Windows PowerShell 5.1（powershell.exe）：${ps.error.message}`);
  if (ps.status === 3) die(2, `本机没有 ${lang} 语音识别器（设置 → 时间和语言 → 语音 里添加该语言的语音识别）`);
  if (ps.status !== 0) die(1, `识别失败（退出码 ${ps.status}）：${(ps.stderr || '').trim()}`);
  segs = ps.stdout.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
} finally {
  process.off('exit', cleanup);
  cleanup();
}
if (!segs.length) die(1, '没有识别到语音，未写字幕（不编造时间码）。');

// ---------- 输出 ----------
const pad = (n, w = 2) => String(n).padStart(w, '0');
const tc = ms => `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
const body = fmt === '.srt'
  ? segs.map((s, i) => `${i + 1}\n${tc(s.start_ms)} --> ${tc(s.start_ms + s.dur_ms)}\n${s.text}\n`).join('\n')
  : segs.map(s => `[${tc(s.start_ms)} --> ${tc(s.start_ms + s.dur_ms)}] ${s.text}`).join('\n') + '\n';

if (!out) { process.stdout.write(body); process.exit(0); }

const sha = crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex');
fs.writeFileSync(out, body, 'utf8');
const meta = out.replace(/\.(srt|txt)$/i, '.d3.json');
fs.writeFileSync(meta, JSON.stringify({
  tool: 'D3 tools/transcribe.mjs',
  engine: `Windows System.Speech (SAPI desktop) ${lang}, DictationGrammar`,
  input, input_sha256: sha, created: new Date().toISOString(),
  note: 'start_ms/dur_ms 为识别器原始输出；字幕时间码 = start_ms ~ start_ms+dur_ms，未做任何调整。文字为识别草稿。',
  segments: segs,
}, null, 2) + '\n', 'utf8');
console.error(`D3：${segs.length} 句 → ${out}（溯源：${meta}）`);
