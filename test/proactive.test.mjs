// 主动说话的判定测试（2026-11-03）
// 跑法：node --test test/proactive.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

let seq = 0;
async function load() {
  return await import(`file:///E:/_DSH/ajing-plugin/lib/index.js?v=${++seq}`);
}

// 造一个「北京时间某点」的时间戳
const at = (h, m = 0) => new Date(2026, 10, 3, h, m, 0).getTime();

test('安静时段里一律不说，哪怕刚聊完', async () => {
  const m = await load();
  const r = m.proactivePlan({
    now: at(23, 30), lastTalkAt: at(23, 29) + 60000, chance: 1,
    quietWindows: [{ start: '21:00', end: '08:00' }],
  });
  assert.equal(r.go, false);
  assert.match(r.why, /安静时段/);
});

test('跨午夜的安静时段也认（21:00–08:00）', async () => {
  const m = await load();
  assert.equal(m.inQuietHours(at(6, 0), [{ start: '21:00', end: '08:00' }]), true);
  assert.equal(m.inQuietHours(at(12, 0), [{ start: '21:00', end: '08:00' }]), false);
});

test('今天说够了就不说，why 里报次数', async () => {
  const m = await load();
  const r = m.proactivePlan({ now: at(14, 0), lastTalkAt: at(9, 0), usedToday: 3, dailyMax: 3, chance: 1 });
  assert.equal(r.go, false);
  assert.match(r.why, /3\/3/);
});

test('刚说完几秒：还没到补话窗口，不说', async () => {
  const m = await load();
  const r = m.proactivePlan({ now: at(14, 0), lastTalkAt: at(14, 0), chance: 1 });
  assert.equal(r.go, false);
  assert.match(r.why, /还没到补话的窗口/);
});

test('回完 30–90 秒：算「补话」', async () => {
  const m = await load();
  const base = at(14, 0);
  const r = m.proactivePlan({ now: base + 60000, lastTalkAt: base, chance: 1 });
  assert.equal(r.go, true);
  assert.match(r.why, /补话/);
});

test('三小时没聊：算「久未联系」', async () => {
  const m = await load();
  const base = at(10, 0);
  const r = m.proactivePlan({ now: base + 4 * 3600 * 1000, lastTalkAt: base, chance: 1 });
  assert.equal(r.go, true);
  assert.match(r.why, /久未联系/);
});

test('概率 0 = 关着，概率 1 = 必说，0.5 看骰子', async () => {
  const m = await load();
  const base = at(10, 0);
  const now = base + 4 * 3600 * 1000;
  assert.equal(m.proactivePlan({ now, lastTalkAt: base, chance: 0 }).go, false);
  assert.equal(m.proactivePlan({ now, lastTalkAt: base, chance: 1 }).go, true);
  assert.equal(m.proactivePlan({ now, lastTalkAt: base, chance: 0.5, rand: () => 0.1 }).go, true);
  assert.equal(m.proactivePlan({ now, lastTalkAt: base, chance: 0.5, rand: () => 0.9 }).go, false);
});
