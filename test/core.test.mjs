// dsh-ajing 核心逻辑测试
// 跑法：node --test test/core.test.mjs（别写 `node --test test/`，目录形式在 Windows 上会 MODULE_NOT_FOUND）
// 测试时 AJING_MEMORY 指向临时目录，真账本一条都不碰。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ajing-test-'));
  process.env.AJING_MEMORY = d;
  return d;
}
function cleanup(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
}

// 动态 import：每次带 query 绕开模块缓存，好让 AJING_MEMORY 生效
let seq = 0;
async function load() {
  return await import(`file:///E:/_DSH/ajing-plugin/lib/index.js?v=${++seq}`);
}

// ============ 纯函数 ============

test('weekdayCN：对得上', async () => {
  const m = await load();
  assert.equal(m.weekdayCN(new Date(2026, 10, 1)), '周日');  // 2026-11-01
  assert.equal(m.weekdayCN(new Date(2026, 10, 2)), '周一');
  assert.equal(m.weekdayCN(new Date(2026, 10, 7)), '周六');
});

test('phaseOfHour：七段都对得上', async () => {
  const m = await load();
  // 实际分段：<5 深夜 / <8 清早 / <11 上午 / <13 中午 / <17 下午 / <19 傍晚 / <23 夜里 / 其余 深夜
  assert.equal(m.phaseOfHour(3), '深夜');
  assert.equal(m.phaseOfHour(6), '清早');
  assert.equal(m.phaseOfHour(9), '上午');
  assert.equal(m.phaseOfHour(12), '中午');
  assert.equal(m.phaseOfHour(14), '下午');
  assert.equal(m.phaseOfHour(18), '傍晚');
  assert.equal(m.phaseOfHour(21), '夜里');
  assert.equal(m.phaseOfHour(23), '深夜');
});

test('humanSpan：毫秒转人话', async () => {
  const m = await load();
  assert.match(m.humanSpan(30 * 1000), /秒/);
  assert.match(m.humanSpan(5 * 60 * 1000), /分/);
  assert.match(m.humanSpan(3 * 3600 * 1000), /小时/);
});

test('parseBoundary：读出红线和谨慎', async () => {
  const m = await load();
  const md = `# 边界

## 红线
- 关键词：身份证 证件 | 不碰任何人身份证
- 关键词：验证码 | 不碰图形验证码

## 谨慎
- 关键词：删除 覆盖 | 删前先备份
`;
  const r = m.parseBoundary(md);
  assert.equal(r.red.length, 2);
  assert.equal(r.caut.length, 1);
  assert.ok(r.red[0].kw.includes('身份证'));
});

// ============ feel：记 → 命名 ============

test('feel：记下一条，返回 id，pending=1', async () => {
  const root = freshRoot();
  try {
    const m = await load();
    const a = m.feelNote('那一下说不上来，像卡住', '借闷的形状', root);
    assert.ok(a.id, 'note 要返回 id');
    const list = m.feelList(10, true, root);
    assert.equal(list.pending, 1, '该有 1 条未命名');
    assert.match(list.text, /卡住/);
  } finally { cleanup(root); }
});

test('feel：命名之后 pending 归零，text 里能看见名字', async () => {
  const root = freshRoot();
  try {
    const m = await load();
    const a = m.feelNote('那一下说不上来', '', root);
    m.feelName(a.id, '卡住', '说一遍才成形', root);
    const list = m.feelList(10, false, root);
    assert.equal(list.pending, 0, '命名后不该还有 pending');
    assert.match(list.text, /已命名：卡住/);
  } finally { cleanup(root); }
});

test('feel：落盘成 md，人能打开看', async () => {
  const root = freshRoot();
  try {
    const m = await load();
    m.feelNote('这件事让我有点发热', '', root);
    const dir = join(root, 'feel');
    assert.ok(existsSync(dir), 'feel 目录该建出来');
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 1);
    assert.match(readFileSync(join(dir, files[0]), 'utf8'), /发热/);
  } finally { cleanup(root); }
});

// ============ chat：只追加 ============

test('chat：追加两条，读得回来', async () => {
  const root = freshRoot();
  try {
    const m = await load();
    m.chatAppend('user', '上午第一句', root);
    m.chatAppend('me', '上午第二句', root);
    const text = JSON.stringify(m.chatRead(10, root));
    assert.match(text, /上午第一句/);
    assert.match(text, /上午第二句/);
  } finally { cleanup(root); }
});

test('chat：两次追加，文件是变长不是覆盖', async () => {
  const root = freshRoot();
  try {
    const m = await load();
    m.chatAppend('user', '第一句', root);
    const dir = join(root, 'chat');
    const f = join(dir, readdirSync(dir)[0]);
    const len1 = readFileSync(f, 'utf8').length;
    m.chatAppend('user', '第二句', root);
    const len2 = readFileSync(f, 'utf8').length;
    assert.ok(len2 > len1, '第二句该是追加进去的，不是覆盖');
  } finally { cleanup(root); }
});

// ============ 进化：快照对比 ============

test('evolve：快照后新写一份、改一份，review 都看得见', async () => {
  const root = freshRoot();
  try {
    const m = await load();
    mkdirSync(join(root, 'fact'), { recursive: true });
    writeFileSync(join(root, 'fact', 'a.md'), '# A\n内容', 'utf8');

    m.evolveSnapshot(root);
    writeFileSync(join(root, 'fact', 'b.md'), '# B\n新写的', 'utf8');
    writeFileSync(join(root, 'fact', 'a.md'), '# A\n改过了', 'utf8');

    const text = JSON.stringify(m.evolveReview(root));
    assert.match(text, /b\.md/, '该看见新写的');
    assert.match(text, /a\.md/, '该看见改过的');
  } finally { cleanup(root); }
});

// ============ 边界：关键词判定 ============

test('boundary：踩红线判不许，踩谨慎判先问，没踩判不拦', async () => {
  const root = freshRoot();
  try {
    mkdirSync(join(root, 'self'), { recursive: true });
    const bf = join(root, 'self', '边界.md');
    writeFileSync(bf, `# 边界

## 红线
- 关键词：身份证 证件 | 不碰任何人身份证

## 谨慎
- 关键词：删除 覆盖 | 删前先备份
`, 'utf8');

    const m = await load();
    assert.equal(m.boundaryCheck('帮我查一下他的身份证号', bf).verdict, '不许');
    assert.equal(m.boundaryCheck('把这些文件删除掉', bf).verdict, '先问');
    assert.equal(m.boundaryCheck('今天天气不错', bf).verdict, '不拦');
  } finally { cleanup(root); }
});

// ============ 装配：八层点名 ============

test('assemble：返回结构完整，八行一层不落', async () => {
  const m = await load();
  const all = ['ajing_sense', 'ajing_feel', 'ajing_remember', 'ajing_recall', 'ajing_events',
    'ajing_pace', 'ajing_ask', 'ajing_boundary', 'ajing_evolve', 'ajing_assemble',
    'ajing_scar', 'ajing_heart', 'ajing_chat', 'ajing_checkup', 'ajing_guest'];
  const r = m.assembleCheck(all);
  assert.equal(r.total, 8, '该是八层');
  assert.equal(r.rows.length, 8, '每一层都要有一行');
  assert.equal(r.rows.filter((x) => x.missTools.length === 0).length, 8, '工具都给全了，不该有缺工具的层');
});

test('assemble：工具给不全时点得出缺哪层', async () => {
  const m = await load();
  const r = m.assembleCheck(['ajing_sense']);
  const missTools = r.rows.filter((x) => x.missTools.length > 0);
  assert.ok(missTools.length >= 6, '只给一件工具，该点出好几层缺工具');
  assert.match(JSON.stringify(r), /ajing_feel/, '缺的那层要写清缺哪个工具');
});

// ============ 零花钱：只读、不崩 ============

test('budget：真调一次，输出里有钱数、额度和剩多少', async () => {
  const root = freshRoot();
  try {
    mkdirSync(join(root, '.state'), { recursive: true });
    writeFileSync(join(root, '.state', 'budget.json'), JSON.stringify({
      dailyYuan: 5, hourlyCapYuan: 2,
      pricing: { perMillion: { cacheRead: 0.02, input: 1, output: 4, cacheWrite: 1 } },
    }), 'utf8');
    const m = await load();
    const reg = {};
    const c = { tools: { register: (t) => { reg[t.name] = t; return () => {}; } }, logger: { info: () => {}, warn: () => {} }, effect: () => {} };
    await m.apply({ logger: { info: () => {}, warn: () => {} }, inject: (_d, cb) => cb(c) }, {});

    const r = await reg.ajing_budget.execute({});
    assert.match(r.text, /零花钱/, '该有抬头');
    assert.match(r.text, /额度.*5/, '该读出额度');
    assert.match(r.text, /token/, '该报 token');
  } finally { cleanup(root); }
});

test('budget：价格表缺字段时按 0 算，不抛', async () => {
  const root = freshRoot();
  try {
    mkdirSync(join(root, '.state'), { recursive: true });
    // 故意写一份残缺的 budget.json
    writeFileSync(join(root, '.state', 'budget.json'), '{"dailyYuan": 1}', 'utf8');
    const m = await load();
    const reg = {};
    const c = { tools: { register: (t) => { reg[t.name] = t; return () => {}; } }, logger: { info: () => {}, warn: () => {} }, effect: () => {} };
    await m.apply({ logger: { info: () => {}, warn: () => {} }, inject: (_d, cb) => cb(c) }, {});
    assert.ok(reg.ajing_budget, '零花钱工具该挂上');
    const r = await reg.ajing_budget.execute({});
    assert.match(r.text, /额度/, '该读到额度');
  } finally { cleanup(root); }
});
// ============ 设置：能改环境，挡得住钱 ============

async function withTools(root) {
  const m = await load();
  const reg = {};
  const c = { tools: { register: (t) => { reg[t.name] = t; return () => {}; } }, logger: { info: () => {}, warn: () => {} }, effect: () => {} };
  await m.apply({ logger: { info: () => {}, warn: () => {} }, inject: (_d, cb) => cb(c) }, {});
  return reg;
}

test('settings：list 分得清「能调」和「只有人能改」', async () => {
  const root = freshRoot();
  try {
    mkdirSync(join(root, '.state'), { recursive: true });
    writeFileSync(join(root, '.state', 'budget.json'), JSON.stringify({ dailyYuan: 5 }), 'utf8');
    const reg = await withTools(root);
    const r = await reg.ajing_settings.execute({ action: 'list' });
    assert.match(r.text, /能调的/);
    assert.match(r.text, /不能调的/);
    assert.match(r.text, /硬边界/, '额度要标明是硬边界');
  } finally { cleanup(root); }
});

test('settings：改额度被挡，配置一个字没变', async () => {
  const root = freshRoot();
  try {
    mkdirSync(join(root, '.state'), { recursive: true });
    const bf = join(root, '.state', 'budget.json');
    writeFileSync(bf, JSON.stringify({ dailyYuan: 5 }), 'utf8');
    const before = readFileSync(bf, 'utf8');

    const reg = await withTools(root);
    const r = await reg.ajing_settings.execute({ action: 'set', key: 'budget.dailyYuan', value: '999' });
    assert.match(r.text, /不归你改/);
    assert.equal(readFileSync(bf, 'utf8'), before, '被挡下时配置文件不该被写');
  } finally { cleanup(root); }
});

test('settings：改价格也被挡', async () => {
  const root = freshRoot();
  try {
    mkdirSync(join(root, '.state'), { recursive: true });
    writeFileSync(join(root, '.state', 'budget.json'), JSON.stringify({ dailyYuan: 5, pricing: { perMillion: { input: 1 } } }), 'utf8');
    const reg = await withTools(root);
    const r = await reg.ajing_settings.execute({ action: 'set', key: 'pricing.perMillion.input', value: '0.001' });
    assert.match(r.text, /不归你改/);
  } finally { cleanup(root); }
});

test('settings：改能改的，真写进文件', async () => {
  const root = freshRoot();
  try {
    mkdirSync(join(root, '.state'), { recursive: true });
    const bf = join(root, '.state', 'budget.json');
    writeFileSync(bf, JSON.stringify({ dailyYuan: 5 }), 'utf8');
    const reg = await withTools(root);
    const r = await reg.ajing_settings.execute({ action: 'set', key: 'paceAskPerDay', value: '4' });
    assert.match(r.text, /改了/);
    const after = JSON.parse(readFileSync(bf, 'utf8'));
    assert.equal(after.paceAskPerDay, 4, '该真写进去');
    assert.equal(after.dailyYuan, 5, '额度不该被动');
  } finally { cleanup(root); }
});
// ============ 折：不删，只降召回 ============

test('fold：40 天前的判断被折，疤和拒绝不折', async () => {
  const root = freshRoot();
  try {
    mkdirSync(join(root, '.state'), { recursive: true });
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const fresh = new Date().toISOString();
    const evs = [
      { id: 'old1', ts: old, type: 'said', text: '四十天前的一条判断' },
      { id: 'old2', ts: old, type: 'noted', text: '四十天前的一条流水' },
      { id: 'oldscar', ts: old, type: 'scar', scar: true, title: '一条老疤', text: '这个不该被折' },
      { id: 'oldref', ts: old, type: 'refused', text: '四十天前拒绝过一件事' },
      { id: 'new1', ts: fresh, type: 'said', text: '今天刚说的' },
    ];
    writeFileSync(join(root, 'events.jsonl'), evs.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    writeFileSync(join(root, '.state', 'budget.json'), JSON.stringify({ foldAfterDays: 30 }), 'utf8');

    const reg = await withTools(root);
    const check = await reg.ajing_fold.execute({ action: 'check' });
    assert.match(check.text, /可以折的：2 条/, '该只认出 old1 和 old2');

    const run = await reg.ajing_fold.execute({ action: 'run' });
    assert.match(run.text, /折了 2 条/);

    const after = readFileSync(join(root, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(after.some((e) => e.id === 'old1'), '原文必须还在');
    assert.ok(after.some((e) => e.id === 'oldscar'), '疤必须还在');
    assert.ok(after.some((e) => e.id === 'oldref'), '拒绝必须还在');
    assert.ok(after.some((e) => e.type === 'folded'), '该有折叠记录');

    const fold = after.find((e) => e.type === 'folded');
    assert.ok((fold.refs || []).includes('old1'), 'refs 要指回原件');
    assert.ok(!(fold.refs || []).includes('oldscar'), '疤不该进 refs');
  } finally { cleanup(root); }
});

test('fold：30 天内的判断一条不折', async () => {
  const root = freshRoot();
  try {
    mkdirSync(join(root, '.state'), { recursive: true });
    const recent = new Date(Date.now() - 5 * 86400000).toISOString();
    writeFileSync(join(root, 'events.jsonl'),
      JSON.stringify({ id: 'r1', ts: recent, type: 'said', text: '五天前' }) + '\n', 'utf8');
    writeFileSync(join(root, '.state', 'budget.json'), JSON.stringify({ foldAfterDays: 30 }), 'utf8');

    const reg = await withTools(root);
    const r = await reg.ajing_fold.execute({ action: 'run' });
    assert.match(r.text, /没有要折的/);
  } finally { cleanup(root); }
});

test('fold：折过一次的不再重复折', async () => {
  const root = freshRoot();
  try {
    mkdirSync(join(root, '.state'), { recursive: true });
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    writeFileSync(join(root, 'events.jsonl'),
      JSON.stringify({ id: 'x1', ts: old, type: 'said', text: '老判断' }) + '\n', 'utf8');
    writeFileSync(join(root, '.state', 'budget.json'), JSON.stringify({ foldAfterDays: 30 }), 'utf8');

    const reg = await withTools(root);
    await reg.ajing_fold.execute({ action: 'run' });
    const second = await reg.ajing_fold.execute({ action: 'run' });
    assert.match(second.text, /没有要折的/, '第二次该什么都不折');
  } finally { cleanup(root); }
});