// 依赖解析测试（2026-11-03）
// 只测 resolveFfmpeg 的挑选逻辑，不真起 ffmpeg：run 和候选都注入。
// 跑法：node --test test/deps.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let seq = 0;
async function load() {
  return await import(`file:///E:/_DSH/ajing-plugin/lib/index.js?v=${++seq}`);
}

// 真实存在的可执行文件，让 existsSync 那关过得去
const REAL = process.execPath;

test('ffmpegCandidates：座次 手填 > 环境变量 > 自带 > PATH，同一路径只出现一次', async () => {
  const m = await load();
  const bare = m.ffmpegCandidates('');
  assert.equal(bare[bare.length - 1].source, 'PATH');
  assert.ok(bare.some((x) => x.source === '插件自带'), '插件自带那份要在候选里');
  const dup = m.ffmpegCandidates(REAL);
  assert.equal(dup.filter((x) => x.path === REAL).length, 1);
});

test('手填那份能跑但解码过不去 → 退到下一份，并且说出来', async () => {
  const m = await load();
  const run = async (bin, args) => {
    const isVersion = args[0] === '-version';
    if (bin === REAL) {
      return isVersion
        ? { ok: true, out: 'ffmpeg version 9.9.9-hand' }
        : { ok: false, err: 'Unknown decoder h264' };
    }
    return isVersion ? { ok: true, out: 'ffmpeg version 7.1-path' } : { ok: true };
  };
  const r = await m.resolveFfmpeg({ ffmpegPath: REAL }, {
    run,
    candidates: [{ path: REAL, source: '设置里手填' }, { path: 'ffmpeg', source: 'PATH' }],
  });
  assert.equal(r.chosen.source, 'PATH');
  assert.equal(r.chosen.version, '7.1-path');
  assert.ok(r.warns.some((n) => n.includes('解码')), '手填那份为什么没用，得说出口');
});

test('两份都能干活 → 按座次取手填那份，不多话', async () => {
  const m = await load();
  const run = async (bin, args) => {
    if (args[0] === '-version') return { ok: true, out: 'ffmpeg version ' + (bin === REAL ? '9.0-hand' : '7.1-path') };
    return { ok: true };
  };
  const r = await m.resolveFfmpeg({ ffmpegPath: REAL }, {
    run,
    candidates: [{ path: REAL, source: '设置里手填' }, { path: 'ffmpeg', source: 'PATH' }],
  });
  assert.equal(r.chosen.source, '设置里手填');
  assert.equal(r.warns.length, 0);
  assert.equal(r.notes.length, 0);
});

test('手填路径不存在 → 报「用不了」，不静默换人', async () => {
  const m = await load();
  const run = async (_bin, args) => (args[0] === '-version' ? { ok: true, out: 'ffmpeg version 7.1' } : { ok: true });
  const r = await m.resolveFfmpeg({ ffmpegPath: 'Z:\\nowhere\\ffmpeg.exe' }, {
    run,
    candidates: [{ path: 'Z:\\nowhere\\ffmpeg.exe', source: '设置里手填' }, { path: 'ffmpeg', source: 'PATH' }],
  });
  assert.equal(r.chosen.source, 'PATH');
  assert.ok(r.warns.some((n) => n.includes('用不了') && n.includes('文件不在')));
});

test('asrModelDir：环境变量指的那份优先，认 model.bin 不认目录名', async () => {
  const m = await load();
  const d = mkdtempSync(join(tmpdir(), 'ajing-asr-'));
  try {
    writeFileSync(join(d, 'model.bin'), Buffer.alloc(32));
    process.env.AJING_ASR_MODEL = d;
    const r = m.asrModelDir();
    assert.equal(r.ok, true, '有 model.bin 就该认');
    assert.equal(r.dir, d);
    assert.equal(r.bytes, 32);
  } finally {
    delete process.env.AJING_ASR_MODEL;
    rmSync(d, { recursive: true, force: true });
  }
});

test('一份都用不起来 → chosen 为 null，warns 说得清都坏在哪', async () => {
  const m = await load();
  const run = async () => ({ ok: false, err: 'ENOENT' });
  const r = await m.resolveFfmpeg({}, {
    run,
    candidates: [{ path: 'ffmpeg', source: 'PATH' }, { path: REAL, source: '插件自带' }],
  });
  assert.equal(r.chosen, null);
  assert.equal(r.tried.length, 2);
  assert.ok(r.warns.some((n) => n.includes('一份都用不起来')));
});
