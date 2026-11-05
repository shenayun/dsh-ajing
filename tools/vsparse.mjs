// vsparse —— 按信息量抽帧：同样的预算，覆盖得更好；静止多的地方能省。
// 手法取自 dsh-video-storyboard（SAOS-3624）：HSV 比色相、爆点重判、扫描缓存。
// 用法：
//   node vsparse.mjs analyze <视频>            只看分段和名额分配（不抽图，最省）
//   node vsparse.mjs sheet   <视频> [输出.png]  真抽帧并拼联络表
//   node vsparse.mjs probe   <视频>            看分数分布，用来调阈值
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// ffmpeg 的位置：环境变量 > 插件目录下的 tools/ffmpeg.exe > PATH
const FFMPEG = process.env.FFMPEG
  || (existsSync(join(dirname(fileURLToPath(import.meta.url)), 'ffmpeg.exe'))
    ? join(dirname(fileURLToPath(import.meta.url)), 'ffmpeg.exe')
    : 'ffmpeg');
// 别只 replace ffmpeg.exe —— 走 PATH 时 FFPEG 就是 "ffmpeg"，没有 .exe 后缀，
// 那个正则匹配不上，FFPROBE 会原样变成 "ffmpeg"，然后用 ffmpeg 跑 ffprobe 的参数，报 show_entries 不认识。
// 2026-11-03 实跑炸出来的。
const FFPROBE = process.env.FFPROBE || FFMPEG.replace(/ffmpeg(\.exe)?$/i, (m, ext) => 'ffprobe' + (ext || ''));
const MEM_ROOT = process.env.AJING_MEMORY
  || (existsSync('E:\\_DSH\\ajing-memory') ? 'E:\\_DSH\\ajing-memory' : join(homedir(), '.dsh', 'ajing-memory'));
const CACHE_DIR = process.env.VSPARSE_CACHE || join(MEM_ROOT, '.cache', 'vsparse');

const W = 64, H = 36;
const STEP = 2;               // HSV 采样步长：每 2 像素取 1，快 4 倍
const FPS = 2;                // 每秒看 2 次
const CHANGE = 20;   // 分数（0-255）超过这个算「画面在动」；按本机实测调过：14 太松会把噪声当动，26 太狠会漏            // 分数（0-255）超过这个算「画面在动」
const HYST = 0.55;            // 迟滞
const BASE_SEC = 5;
const MIN_FRAMES = 6;
const STATIC_SEC = 15;         // 静态内容片改按时间均匀抽，多少秒一帧
const STATIC_RATIO = 0.02;     // 活动的帧不到这个比例，就当它是「静态内容片」
const BURST_WIN = 2;          // 爆点重判窗口（秒）
const BURST_HZ = 12;          // 重判采样率

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out = [];
    const errs = [];
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => errs.push(c));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(bin + ' 退出码 ' + code + '：' + Buffer.concat(errs).toString().slice(-300)));
      resolve(Buffer.concat(out));
    });
  });
}

async function duration(file) {
  const out = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return Number(out.toString().trim());
}

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

// 一次解码，逐帧取 HSV 采样，再算相邻帧差
async function scan(file) {
  const buf = await run(FFMPEG, [
    '-v', 'error', '-i', file,
    '-vf', `fps=${FPS},scale=${W}:${H},format=rgb24`,
    '-f', 'rawvideo', '-',
  ]);
  const bytesPer = W * H * 3;
  const n = Math.floor(buf.length / bytesPer);
  const frames = [];
  for (let f = 0; f < n; f++) {
    const base = f * bytesPer;
    const arr = new Float32Array(Math.floor(W / STEP) * Math.floor(H / STEP) * 3);
    let k = 0;
    for (let y = 0; y < H; y += STEP) {
      for (let x = 0; x < W; x += STEP) {
        const i = base + (y * W + x) * 3;
        const [h, s, v] = rgb2hsv(buf[i], buf[i + 1], buf[i + 2]);
        arr[k++] = h; arr[k++] = s; arr[k++] = v;
      }
    }
    frames.push(arr);
  }

  const diffAB = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i += 3) {
      let dh = Math.abs(a[i] - b[i]);
      if (dh > 0.5) dh = 1 - dh;                 // 色相是个环，0 和 1 是一家人
      const sat = Math.min(a[i + 1], b[i + 1]);  // 灰色的色相没意义
      const dv = Math.abs(a[i + 2] - b[i + 2]);
      sum += dh * sat * 0.6 + dv * 0.4;
    }
    return (sum / (a.length / 3)) * 255;
  };

  const raw = [];
  for (let f = 1; f < n; f++) raw.push(diffAB(frames[f - 1], frames[f]));

  // 3 点平滑，压住闪烁抖动
  const diffs = raw.map((_, i) => {
    const lo = Math.max(0, i - 1), hi = Math.min(raw.length - 1, i + 1);
    let s = 0;
    for (let j = lo; j <= hi; j++) s += raw[j];
    return s / (hi - lo + 1);
  });
  return { diffs, frames, n };
}

function cacheKey(file) {
  const st = statSync(file);
  const h = createHash('sha1');
  h.update([file, st.size, Math.floor(st.mtimeMs), FPS, W, H, STEP, CHANGE].join('|'));
  return h.digest('hex').slice(0, 16);
}

function readCache(key) {
  try {
    const p = join(CACHE_DIR, key + '.json');
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch { return null; }
}

function writeCache(key, data) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, key + '.json'), JSON.stringify(data), 'utf8');
  } catch {}
}


// 阈值不写死：按本片自己的分数分布推。抄 dsh-video-storyboard 的做法——
// 拿一部片子调好的数字，换一部片子就不准了。

// ———— 第 2 层：听声音 ————
// 没字幕轨的时候，声音比画面便宜、信息密度还高。
// 流程：ffmpeg 抽 16k 单声道 wav → faster-whisper 转写 → 带时间码的文本。
const VASR = process.env.VASR_PY || join(dirname(fileURLToPath(import.meta.url)), 'vasr.py');
// 模型放哪：环境变量 > 插件自带的 vendor/models/ > 用户目录
// 自带优先，因为那是跟插件一起发的，不用用户另外下
const VENDOR_MODEL = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'models', 'faster-whisper-small');
const ASR_MODEL = process.env.VASR_MODEL
  || (existsSync(VENDOR_MODEL) ? VENDOR_MODEL : join(homedir(), '.dsh', 'models', 'faster-whisper-small'));

async function asr(file) {
  const wav = join(dirname(file), ".vasr-" + Date.now() + ".wav");
  try {
    await run(FFMPEG, ["-y", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
    const out = await runPy(VASR, [wav, ASR_MODEL]);
    return out.toString("utf8");
  } finally {
    try { rmSync(wav, { force: true }); } catch {}
  }
}

function runPy(script, args) {
  return new Promise((resolve, reject) => {
    const p = spawn("python", [script, ...args], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    const out = [];
    const errs = [];
    p.stdout.on("data", (c) => out.push(c));
    p.stderr.on("data", (c) => errs.push(c));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error("python 退出码 " + code + "：" + Buffer.concat(errs).toString().slice(-400)));
      resolve(Buffer.concat(out));
    });
  });
}

function baselineOf(dur) { return Math.max(MIN_FRAMES, Math.ceil(dur / BASE_SEC)); }

function autoThreshold(diffs) {
  if (!diffs || !diffs.length) return CHANGE;
  // Otsu：在分数直方图上找让「两类之间差得最大」的那一刀。
  // 之前用分位数，结果阈值能高过全片最大分 —— 那永远判不出「动」。
  const hist = new Array(256).fill(0);
  for (const d of diffs) hist[Math.min(255, Math.max(0, Math.round(d)))]++;
  const total = diffs.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, maxVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; best = t; }
  }
  // 夹一下：太低会把编码噪声当动，太高会漏掉真的动
  const sorted = [...diffs].sort((a, b) => a - b);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  // Otsu 给的那一刀偏低（宁可多看），往上一抬：省一点，但不至于漏掉真动的地方
  const raised = Math.round(best * 1.5);
  return Math.max(7, Math.min(Math.round(p99 * 0.85) || 255, raised));
}

function segments(diffs, th = CHANGE) {
  const segs = [];
  if (!diffs.length) return segs;
  let busy = diffs[0] > th;
  let start = 0;
  for (let i = 1; i < diffs.length; i++) {
    const flip = busy ? diffs[i] < th * HYST : diffs[i] > th;
    if (flip) { segs.push({ busy, start, end: i - 1 }); busy = !busy; start = i; }
  }
  segs.push({ busy, start, end: diffs.length - 1 });
  const merged = [];
  for (const s of segs) {
    const len = s.end - s.start + 1;
    if (merged.length && len < 2) merged[merged.length - 1].end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

function pickTimes(diffs, totalSec, th = CHANGE) {
  const segs = segments(diffs, th);
  const baseline = Math.max(MIN_FRAMES, Math.ceil(totalSec / BASE_SEC));
  const busy = segs.filter((s) => s.busy);
  const quiet = segs.filter((s) => !s.busy);
  const secs = (s) => Math.max(0, (s.end - s.start + 1) / FPS);

  let quietNeed = quiet.length;
  if (quietNeed > Math.floor(baseline / 2)) {
    const q = segs.filter((s) => !s.busy);
    if (q.length) {
      quiet.length = 0;
      quiet.push({ busy: false, start: q[0].start, end: q[q.length - 1].end });
      quietNeed = 1;
    }
  }

  const busyBudget = Math.max(0, baseline - quietNeed);
  const busyTotal = busy.reduce((a, s) => a + secs(s), 0) || 1;

  const picks = [];
  for (const s of quiet) picks.push({ t: Number((((s.start + s.end) / 2) / FPS).toFixed(2)), busy: false });
  for (const s of busy) {
    const t0 = s.start / FPS, t1 = s.end / FPS, dur = t1 - t0;
    const share = (secs(s) / busyTotal) * busyBudget;
    const count = Math.max(1, Math.min(8, Math.round(share)));
    for (let k = 0; k < count; k++) {
      const t = count === 1 ? (t0 + t1) / 2 : t0 + (dur * k) / (count - 1);
      picks.push({ t: Number(t.toFixed(2)), busy: true });
    }
  }
  picks.sort((a, b) => a.t - b.t);
  const dedup = [];
  for (const p of picks) {
    if (dedup.length && Math.abs(p.t - dedup[dedup.length - 1].t) < 0.35) {
      if (p.busy) dedup[dedup.length - 1].busy = true;
      continue;
    }
    dedup.push(p);
  }
  if (dedup.length > baseline) {
    const q = dedup.filter((p) => !p.busy), b2 = dedup.filter((p) => p.busy);
    const keepBusy = b2.slice(0, Math.min(b2.length, baseline));
    const room = Math.max(0, baseline - keepBusy.length);
    const step = Math.max(1, Math.ceil(q.length / Math.max(1, room)));
    const keepQuiet = room ? q.filter((_, i) => i % step === 0).slice(0, room) : [];
    return [...keepBusy, ...keepQuiet].sort((a, b) => a.t - b.t);
  }
  return dedup;
}

// 爆点重判：粗扫的 fps=2 看不见 0.5 秒以下的刀。
// 对起伏大的段落，用 12 帧/秒 重看那两秒，数出里面到底几刀。
async function burstRefine(file, segs, th = CHANGE) {
  const anchors = [];
  for (const s of segs) {
    if (!s.busy) continue;
    if ((s.end - s.start + 1) / FPS < BURST_WIN * 2) continue;
    anchors.push(Math.max(0, ((s.start + s.end) / 2) / FPS - BURST_WIN / 2));
  }
  const uniq = [...new Set(anchors.map((t) => Number(t.toFixed(1))))].slice(0, 6);
  const out = [];
  const sw = Math.floor(W / STEP), sh = Math.floor(H / STEP), per = sw * sh;
  for (const t of uniq) {
    try {
      const buf = await run(FFMPEG, [
        '-v', 'error', '-ss', String(t), '-t', String(BURST_WIN), '-i', file,
        '-vf', `fps=${BURST_HZ},scale=${W}:${H},format=rgb24`,
        '-f', 'rawvideo', '-',
      ]);
      const bytesPer = W * H * 3;
      const n = Math.floor(buf.length / bytesPer);
      let cuts = 0, peak = 0, prev = null;
      for (let f = 0; f < n; f++) {
        const base = f * bytesPer;
        const arr = new Float32Array(per * 3);
        let k = 0;
        for (let y = 0; y < H; y += STEP) {
          for (let x = 0; x < W; x += STEP) {
            const i = base + (y * W + x) * 3;
            const [h, s, v] = rgb2hsv(buf[i], buf[i + 1], buf[i + 2]);
            arr[k++] = h; arr[k++] = s; arr[k++] = v;
          }
        }
        if (prev) {
          let sum = 0;
          for (let i = 0; i < arr.length; i += 3) {
            let dh = Math.abs(prev[i] - arr[i]);
            if (dh > 0.5) dh = 1 - dh;
            sum += dh * Math.min(prev[i + 1], arr[i + 1]) * 0.6 + Math.abs(prev[i + 2] - arr[i + 2]) * 0.4;
          }
          const d = (sum / per) * 255;
          if (d > peak) peak = d;
          if (d > th * 1.6) cuts++;
        }
        prev = arr;
      }
      out.push({ at: t, cuts, peak: Math.round(peak) });
    } catch { /* 重判失败不影响主流程 */ }
  }
  return out;
}

function frameDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 3) {
    let dh = Math.abs(a[i] - b[i]);
    if (dh > 0.5) dh = 1 - dh;
    sum += dh * Math.min(a[i + 1], b[i + 1]) * 0.6 + Math.abs(a[i + 2] - b[i + 2]) * 0.4;
  }
  return (sum / (a.length / 3)) * 255;
}

async function analyzeOnce(file, useCache = true) {
  const dur = await duration(file);
  const key = cacheKey(file);
  const t0 = Date.now();
  let sc = useCache ? readCache(key) : null;
  let fromCache = false;
  if (sc && Array.isArray(sc.diffs) && sc.diffs.length) fromCache = true;
  else {
    sc = await scan(file);
    writeCache(key, { diffs: sc.diffs, n: sc.n, dur, at: new Date().toISOString() });
  }
  const diffs = sc.diffs;
  const th = autoThreshold(diffs);      // 按本片自己的分布定阈值
  const segs = segments(diffs, th);
  // 先看这条片子到底动不动。人在说话的片子，画面几乎不动，
  // 按「信息量」抽只会抽出一堆一样的截图 —— 那不是省，是没看见。
  const active = diffs.length ? diffs.filter((d) => d > th).length / diffs.length : 0;
  const isStatic = active < STATIC_RATIO;
  let picks0;
  if (isStatic) {
    const nStatic = Math.max(MIN_FRAMES, Math.ceil(dur / STATIC_SEC));
    picks0 = [];
    for (let i = 0; i < nStatic; i++) {
      picks0.push({ t: Number(((dur * (i + 0.5)) / nStatic).toFixed(2)), busy: false, even: true });
    }
  } else {
    picks0 = pickTimes(diffs, dur, th);
  }

  let picks = picks0;   // 后面可能被保底逻辑补帧
  if (!fromCache && sc.frames) {
    const keep = [];
    let lastAny = -1;
    for (const p of picks0) {
      const idx = Math.round(p.t * FPS);
      if (lastAny >= 0 && sc.frames[idx] && sc.frames[lastAny] && frameDiff(sc.frames[lastAny], sc.frames[idx]) < th * 0.5) continue;
      keep.push(p);
      lastAny = idx;
    }
    if (keep.length) {
      const lastPick = picks0[picks0.length - 1];
      if (Math.abs(keep[keep.length - 1].t - lastPick.t) > 0.5) keep.push(lastPick);
    }
    picks = keep;
  }
  // 保底：阈值判得太狠时，不能省到看不见东西。
  // 至少留基线的一成半（且不少于 4 帧），按时间均匀补齐。
  const floor = Math.max(4, Math.ceil(baselineOf(dur) * 0.15));
  if (picks.length < floor) {
    const need = floor - picks.length;
    const have = new Set(picks.map((p) => Math.round(p.t * 10)));
    const gap = dur / (need + 1);
    const extra = [];
    for (let i = 1; i <= need; i++) {
      const t = Number((gap * i).toFixed(2));
      if (!have.has(Math.round(t * 10))) extra.push({ t, busy: false, padded: true });
    }
    picks = [...picks, ...extra].sort((a, b) => a.t - b.t);
  }
  return { dur, diffs, segs, picks0, picks, th, active, isStatic, ms: Date.now() - t0, fromCache };
}

async function analyze(file) {
  const r = await analyzeOnce(file);
  const baseline = Math.max(MIN_FRAMES, Math.ceil(r.dur / BASE_SEC));
  const busySec = r.segs.filter((s) => s.busy).reduce((a, s) => a + (s.end - s.start + 1) / FPS, 0);
  const saved = Math.round((1 - r.picks.length / baseline) * 100);
  const out = [
    '片子：' + (r.dur / 60).toFixed(1) + ' 分钟（' + Math.round(r.dur) + ' 秒）',
    '分析：' + r.diffs.length + ' 帧 HSV 缩略（' + FPS + ' 帧/秒，' + W + 'x' + H + '，步长 ' + STEP + '）· ' +
      (r.fromCache ? '命中缓存，秒开' : '花了 ' + (r.ms / 1000).toFixed(1) + ' 秒'),
    '阈值：' + r.th + '（按本片分布自适应）· 活动的帧占 ' + Math.round(r.active * 100) + '%',
    r.isStatic ? '判定：**静态内容片**（画面几乎不动）—— 按时间均匀抽，每 ' + STATIC_SEC + ' 秒一帧；真正的内容多半在台词里，建议先走字幕 / ASR' : '判定：动态片 —— 按信息量抽，动的地方多分、静止的地方少分',
    '段落：' + r.segs.length + ' 段，其中动的 ' + r.segs.filter((s) => s.busy).length + ' 段，动了 ' + busySec.toFixed(0) + ' 秒',
    '',
    '旧办法（每 ' + BASE_SEC + ' 秒一帧）：' + baseline + ' 帧',
    '这个办法（按信息量）：' + r.picks.length + ' 帧' + (saved > 0 ? '，省 ' + saved + '%' : saved === 0 ? '，持平' : '，反而多 ' + -saved + '%'),
    '联络表（16 格一张）：' + Math.ceil(baseline / 16) + ' 张 → ' + Math.ceil(r.picks.length / 16) + ' 张',
    '',
    r.picks.slice(0, 32).map((p) => (p.busy ? '[动]' : '[静]') + p.t + 's').join('  '),
    r.picks.length > 32 ? '…还有 ' + (r.picks.length - 32) + ' 个' : '',
  ];
  if (!r.fromCache) {
    const bursts = await burstRefine(file, r.segs, r.th);
    if (bursts.length) {
      out.push('');
      out.push('爆点重判（粗扫看不见 0.5 秒以下的刀，这里按 ' + BURST_HZ + ' 帧/秒重看）：');
      for (const b of bursts) out.push('  ' + b.at + 's 起 ' + BURST_WIN + ' 秒内 ' + b.cuts + ' 刀，峰值 ' + b.peak);
    }
  }
  return out.join('\n');
}


// ———— 第 0 层：先探，再决定值不值得解 ————
// 抽帧是最后手段，不是第一手段。有字幕轨就先读字幕，那才是快的那条路。
async function streams(file) {
  const out = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'stream=index,codec_type,codec_name',
    '-show_entries', 'format=duration,size',
    '-of', 'json', file,
  ]);
  let j = {};
  try { j = JSON.parse(out.toString()); } catch {}
  const list = Array.isArray(j.streams) ? j.streams : [];
  const pick = (t) => list.filter((x) => x.codec_type === t);
  return {
    video: pick('video'),
    audio: pick('audio'),
    subs: pick('subtitle'),
    duration: Number(j.format?.duration || 0),
    size: Number(j.format?.size || 0),
  };
}

async function advise(file) {
  const s0 = await streams(file);
  const dur = s0.duration || 0;
  const lines = [];
  lines.push('片子：' + (dur / 60).toFixed(1) + ' 分钟（' + Math.round(dur) + ' 秒）· ' +
    (s0.size ? (s0.size / 1048576).toFixed(0) + ' MB' : '?'));
  lines.push('流：视频 ' + s0.video.length + ' 条' + (s0.video[0] ? '（' + s0.video[0].codec_name + '）' : '') +
    ' · 音频 ' + s0.audio.length + ' 条' + (s0.audio[0] ? '（' + s0.audio[0].codec_name + '）' : '') +
    ' · 字幕 ' + s0.subs.length + ' 条');
  lines.push('');
  if (!s0.video.length) {
    lines.push('没有视频流——这不是能看的片子，只有声音或者干脆是别的东西。');
    if (s0.audio.length) lines.push('要走文字就用 ASR 听，别抽帧。');
    return lines.join('\n');
  }
  lines.push('建议（从便宜到贵，能用上面的就别用下面的）：');
  if (s0.subs.length) {
    lines.push('  ① 有字幕轨 → 先读字幕，一遍解码都不用。命令：');
    lines.push('     node vsparse.mjs subs "' + file + '" 输出.srt');
    lines.push('  ② 字幕不够再说画面 → 才去 sheet');
  } else {
    lines.push('  ① 没有字幕轨 → 要文字就走本地 ASR（faster-whisper，全离线不花钱）');
    lines.push('     实测：5.5 分钟音频约 100 秒转完。命令：node vsparse.mjs asr \"' + file + '\"');
    lines.push('     代价是专有名词会听错（人名、产品名），要紧的名字回头对照原文核一遍。');
    lines.push('  ② 还要看画面 → 才去 sheet / analyze');
  }
  lines.push('  ③ 同一部片子再看一次会自动命中缓存，秒开');
  return lines.join('\n');
}

// 有字幕轨时把第一条字幕导出成 srt，零画面解码
async function subs(file, outPath) {
  const s0 = await streams(file);
  if (!s0.subs.length) {
    return '这条片子没有字幕轨。要文字只能走 ASR，或者从平台那边拿（外挂 srt / 弹幕 / 简介）。';
  }
  await run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-map', '0:s:0', outPath]);
  const txt = readFileSync(outPath, 'utf8');
  return '字幕导出来了：' + outPath + '（' + txt.length + ' 字符，' +
    (txt.match(/-->/g) || []).length + ' 条）\n零画面解码，这一步比抽帧快两个数量级。';
}

async function probe(file) {
  const advice = await advise(file);
  const r = await analyzeOnce(file, false);
  const sorted = [...r.diffs].sort((a, b) => a - b);
  const q = (p) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]);
  return [advice, '', '分数分布（0-255，' + sorted.length + ' 个）：',
    '  最小 ' + Math.round(sorted[0]) + ' · 25% ' + q(0.25) + ' · 中位 ' + q(0.5) + ' · 75% ' + q(0.75) + ' · 95% ' + q(0.95) + ' · 最大 ' + Math.round(sorted[sorted.length - 1]),
    '  本条自适应阈值=' + r.th + '（写死的默认是 ' + CHANGE + '），判为「动」的帧占 ' + Math.round((sorted.filter((d) => d > r.th).length / sorted.length) * 100) + '%',
    '调法：想让更多帧算「动」就调低；想更省就调高。',
  ].join('\n');
}

async function sheet(file, outPath) {
  const r = await analyzeOnce(file);
  const picks = r.picks;
  const tmp = join(dirname(outPath), '.vsparse-tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  await run(FFMPEG, [
    '-v', 'error', '-i', file,
    '-vf', `fps=${FPS},select='${picks.map((p) => 'eq(n\\,' + Math.round(p.t * FPS) + ')').join('+')}',scale=320:-2`,
    '-vsync', '0',
    join(tmp, 'f%03d.png'),
  ]);
  const files = readdirSync(tmp).filter((f) => f.endsWith('.png')).sort();
  if (!files.length) { rmSync(tmp, { recursive: true, force: true }); throw new Error('一帧都没抽出来'); }
  const cols = Math.min(4, files.length);
  const rows = Math.ceil(files.length / cols);
  await run(FFMPEG, [
    '-v', 'error', '-framerate', '1', '-i', join(tmp, 'f%03d.png'),
    '-vf', `tile=${cols}x${rows}:padding=4:margin=8:color=white`,
    '-frames:v', '1', outPath,
  ]);
  rmSync(tmp, { recursive: true, force: true });
  return { out: outPath, used: files.length };
}

const [cmd, file, out] = process.argv.slice(2);
if (!cmd || !file) {
  console.log('用法：node vsparse.mjs analyze|sheet|probe|asr <视频> [输出] | subs <视频> [输出.srt]');
  process.exit(1);
}
try {
  if (cmd === 'analyze') console.log(await analyze(file));
  else if (cmd === 'sheet') {
    const r = await sheet(file, out || join(process.cwd(), 'sheet.png'));
    console.log('拼好了：' + r.out + '\n用了 ' + r.used + ' 帧');
  } else if (cmd === 'probe') console.log(await probe(file));
  else if (cmd === 'subs') console.log(await subs(file, out || join(process.cwd(), 'subs.srt')));
  else if (cmd === 'asr') console.log(await asr(file));
  else console.log('不认识的动作：' + cmd);
} catch (e) {
  console.log('出错了：' + (e?.message ?? e));
}
