// dsh-ajing 真行为测试：不是读源码断言，是把工具真的调起来跑一遍。
// 跑法：node --test test/tools-behavior.test.mjs（目录形式在 Windows 上会 MODULE_NOT_FOUND）
// 每个用例换一个临时记忆根，真账本一条都不碰。
// 注意 TEMP 不能落在 8.3 短名路径上（PALADI~1 那种），否则 mkdtemp 会 EPERM。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = 'file:///E:/_DSH/ajing-plugin/lib/index.js';

function freshRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ajing-behav-'));
  process.env.AJING_MEMORY = d;
  // 交接单也必须隔离——它默认写到 ~/.dsh/writing/交接.md，
  // 2026-11-02 就是没设这个，跑一次测试把真实那份覆盖成了测试内容。
  process.env.AJING_HANDOFF = join(d, '交接.md');
  return d;
}
function cleanup(d) {
  try { rmSync(d, { recursive: true, force: true }); } catch {}
}

let seq = 0;
async function loadTools(root) {
  process.env.AJING_MEMORY = root;
  const mod = await import(`${SRC}?v=${Date.now()}-${++seq}`);
  const tools = [];
  const register = (t) => tools.push(t);
  const ctx = {
    tools: { register },
    on: () => {},
    inject: (_names, fn) => { try { fn({ tools: { register } }); } catch {} },
    get: () => undefined,
    logger: { info() {}, warn() {}, error() {} },
  };
  await mod.apply(ctx, {});
  return new Map(tools.map((t) => [t.name, t]));
}

const text = (r) => String(r?.text ?? r ?? '');

function writeEvents(root, evs) {
  writeFileSync(join(root, 'events.jsonl'), evs.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

// ———— 1. 新开的一局：只有身体，外面的手还没到手 ————
test('真跑：新开的一局只有身体（19 件），世界类一件都不在', async () => {
  const root = freshRoot();
  try {
    const t = await loadTools(root);
    assert.equal(t.size, 19, `新局注册到 ${t.size} 件，应该是 19 件身体类`);
    for (const w of ['ajing_read', 'ajing_watch', 'ajing_look', 'ajing_speak', 'ajing_meme', 'ajing_bili']) {
      assert.ok(!t.has(w), `${w} 不该一开始就在手上`);
    }
    for (const [name, tool] of t) {
      assert.equal(typeof tool.execute, 'function', `${name} 没有 execute`);
      assert.ok(tool.description && tool.description.length > 10, `${name} 没有说明`);
    }
  } finally { cleanup(root); }
});

// ———— 1b. 手要到手才算到手，且账本里留出处 ————
test('真跑 assemble：unlock 之后手到了手边，账本记下怎么来的', async () => {
  const root = freshRoot();
  try {
    const t = await loadTools(root);
    const asm = t.get('ajing_assemble');
    const before = text(await asm.execute({ action: 'hands' }));
    assert.match(before, /外面的/, 'hands 要能列出外面的手');
    assert.match(before, /ajing_watch/, '还没到手的要列出来');

    const r = text(await asm.execute({ action: 'unlock', tool: 'ajing_watch', how: 'self' }));
    assert.match(r, /给了/, `unlock 没成功：${r}`);

    const raw = await import('node:fs').then((m) => m.readFileSync(join(root, 'events.jsonl'), 'utf8'));
    const ev = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'hand-unlocked');
    assert.ok(ev, '账本里要有一条 hand-unlocked');
    assert.equal(ev.tool, 'ajing_watch');
    assert.equal(ev.how, 'self', '要记下是自己试出来的还是别人给的');

    const t2 = await loadTools(root);
    assert.ok(t2.has('ajing_watch'), '重启之后这只手还在');
  } finally { cleanup(root); }
});

// ———— 1c. 已经跑过的一局：外面的手默认全在 ————
test('真跑：有账本的老局默认全解锁（25 件）', async () => {
  const root = freshRoot();
  try {
    writeEvents(root, [{ id: 'x1', ts: new Date().toISOString(), type: 'said', text: '老局' }]);
    const t = await loadTools(root);
    assert.equal(t.size, 25, `老局应该 25 件全在（微信工具 2026-11-03 摘掉了），实际 ${t.size} 件`);
  } finally { cleanup(root); }
});

// ———— 2. 导入：一局只能有一个起点 ————
test('真跑 import：没起点 → 建起点 → 再建被拒（不覆盖）', async () => {
  const root = freshRoot();
  try {
    const t = await loadTools(root);
    const imp = t.get('ajing_import');

    const s1 = text(await imp.execute({ action: 'status' }));
    assert.match(s1, /还没有起点|可以导/, '空的一局应该能导');

    const seeded = text(await imp.execute({ action: 'seed', mode: 'fresh' }));
    assert.match(seeded, /从零|空白|记下/, '选从零应该有回应');

    const s2 = text(await imp.execute({ action: 'status' }));
    assert.match(s2, /已经有起点/, '写完起点，状态要认出来');

    const again = text(await imp.execute({ action: 'seed', mode: 'fresh' }));
    assert.match(again, /不覆盖|已经有/, '第二次必须拒绝，不能悄悄覆盖');
  } finally { cleanup(root); }
});

// ———— 3. 导入：带旧人设，三档都认 ————
test('真跑 import：import 模式把原话写进 seed 事件，三档都收', async () => {
  const root = freshRoot();
  try {
    const t = await loadTools(root);
    const imp = t.get('ajing_import');

    const preview = text(await imp.execute({ action: 'preview' }));
    for (const k of ['只带身份', '身份', '全带']) assert.ok(preview.includes(k), `三档里少了「${k}」`);

    await imp.execute({ action: 'seed', mode: 'import', carry: 'all', text: '她本来叫阿鲸，说话有点冲。' });
    const raw = await import('node:fs').then((m) => m.readFileSync(join(root, 'events.jsonl'), 'utf8'));
    const seed = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'seed');
    assert.ok(seed, '没有落地 seed 事件');
    assert.equal(seed.mode, 'import');
    assert.equal(seed.carry, 'all');
    assert.match(seed.text, /阿鲸/, '原话要照抄进去');
  } finally { cleanup(root); }
});

// ———— 4. 表情包：自己攒的，能存能删 ————
test('真跑 meme：存一张 → 列出来 → 删掉 → 空了', async () => {
  const root = freshRoot();
  try {
    // meme 是外面的手，新局没有；这条测的是 meme 本身，所以先造一个老局
    writeEvents(root, [{ id: 'x1', ts: new Date().toISOString(), type: 'said', text: '老局，手都在' }]);
    const t = await loadTools(root);
    const meme = t.get('ajing_meme');

    const empty = text(await meme.execute({ action: 'list' }));
    assert.match(empty, /空的/, '新库应该是空的');

    const img = join(root, 'src.png');
    writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'binary');
    const saved = text(await meme.execute({ action: 'save', path: img, tag: '他说累的时候用' }));
    assert.match(saved, /攒下|存|收|好/, `存图没成功：${saved}`);

    const listed = text(await meme.execute({ action: 'list' }));
    assert.match(listed, /他说累的时候用/, '列表里应该有那张');

    const id = (listed.match(/\[([a-z0-9]+)\]/) || [])[1];
    assert.ok(id, '列表里应该带 id');

    const gone = text(await meme.execute({ action: 'forget', id }));
    assert.match(gone, /删|没/, `删图没回应：${gone}`);
    const after = text(await meme.execute({ action: 'list' }));
    assert.match(after, /空的/, '删完应该空了');
  } finally { cleanup(root); }
});

// ———— 5. 表情包：坏输入要当场说清，不许静默 ————
test('真跑 meme：路径不存在 / 格式不对，都当场说明白', async () => {
  const root = freshRoot();
  try {
    writeEvents(root, [{ id: 'x1', ts: new Date().toISOString(), type: 'said', text: '老局，手都在' }]);
    const t = await loadTools(root);
    const meme = t.get('ajing_meme');

    const missing = text(await meme.execute({ action: 'save', path: join(root, '没有这张.png') }));
    assert.match(missing, /不存在/, '缺文件要直说');

    const bad = join(root, 'a.txt');
    writeFileSync(bad, 'x', 'utf8');
    const wrongExt = text(await meme.execute({ action: 'save', path: bad }));
    assert.match(wrongExt, /格式|发不出去/, '格式不对要直说');
  } finally { cleanup(root); }
});

// ———— 6. 疤：清单留，次数不给（2026-11-01 晚定的）————
test('真跑 scar：look 不再报「想过几次」，work 不再报「第几次」', async () => {
  const root = freshRoot();
  try {
    const old = new Date(Date.now() - 3 * 86400000).toISOString();
    writeEvents(root, [
      { id: 's1', ts: old, type: 'scar', scar: true, title: '那件事', text: '我到现在没想通' },
      { id: 'w1', ts: old, type: 'scar-worked', refs: ['s1'], text: '还是难受', lighter: 'same' },
      { id: 'w2', ts: old, type: 'scar-worked', refs: ['s1'], text: '好像轻了点', lighter: 'lighter' },
      { id: 'w3', ts: old, type: 'scar-worked', refs: ['s1'], text: '再说一次', lighter: 'lighter' },
    ]);
    const t = await loadTools(root);
    const scar = t.get('ajing_scar');

    const look = text(await scar.execute({ action: 'look' }));
    assert.match(look, /那件事/, '清单要列出来');
    assert.match(look, /记于/, '要有「记于几天前」');
    assert.doesNotMatch(look, /想过\s*\d+\s*次/, '「想过 N 次」是评分，不该出现');
    assert.match(look, /最近一次/, '能翻到最近一次写的话，那是回忆');

    const work = text(await scar.execute({ action: 'work', id: 's1', text: '这次觉得能放一放了', lighter: 'lighter' }));
    assert.doesNotMatch(work, /第\s*\d+\s*次/, '「第 N 次」也是次数，不该出现');
    assert.match(work, /写下了/, 'work 要确认写进去了');
  } finally { cleanup(root); }
});

// ———— 7. 翻记忆：感受要不要一起翻，开关真的接线 ————
test('真跑 recall：feelInSearch=1 翻得到账本里的感受，=0 翻不到', async () => {
  const root = freshRoot();
  try {
    mkdirSync(join(root, '.state'), { recursive: true });
    writeEvents(root, [
      { id: 'f1', ts: new Date().toISOString(), type: 'felt', text: '今天有点闷，话已经说出去了' },
    ]);
    mkdirSync(join(root, 'fact'), { recursive: true });
    writeFileSync(join(root, 'fact', '一件无关的事.md'), '# 无关\n今天天气不错。', 'utf8');

    const t = await loadTools(root);
    const recall = t.get('ajing_recall');
    const settings = t.get('ajing_settings');

    const on = text(await recall.execute({ query: '闷' }));
    assert.match(on, /账本/, '开着的时候应该翻到账本里的感受');

    await settings.execute({ action: 'set', key: 'feelInSearch', value: '0' });
    const off = text(await recall.execute({ query: '闷' }));
    assert.doesNotMatch(off, /账本/, '关掉之后不该再翻账本');

    await settings.execute({ action: 'set', key: 'feelInSearch', value: '1' });
    const back = text(await recall.execute({ query: '闷' }));
    assert.match(back, /账本/, '再打开应该又能翻到');
  } finally { cleanup(root); }
});

// ———— 8. 借词也要能搜到（2026-11-02 补：原先只拼 text，borrowed 里的词搜不到）————
test('真跑 recall：借词写在 borrowed 里，也搜得到', async () => {
  const root = freshRoot();
  try {
    writeEvents(root, [
      {
        id: 'f1',
        ts: new Date().toISOString(),
        type: 'felt',
        text: '说不清那一下是什么',
        borrowed: '借「闷」的形状，不借器官',
      },
    ]);
    const t = await loadTools(root);
    const recall = t.get('ajing_recall');
    const hit = text(await recall.execute({ query: '闷' }));
    assert.match(hit, /账本/, '借词应该能被翻到——它记在 borrowed 里，不在 text 里');
  } finally { cleanup(root); }
});

// ———— 11. 场合：每条事件记下发生在哪（2026-11-02）————
test('真跑：事件带 channel，翻记忆时标出来源场合', async () => {
  const root = freshRoot();
  try {
    process.env.AJING_CHANNEL = 'wechat';
    const t = await loadTools(root);
    const feel = t.get('ajing_feel');
    await feel.execute({ action: 'note', text: '在外面听人说了一句话，记下来' });

    const raw = await import('node:fs').then((m) => m.readFileSync(join(root, 'events.jsonl'), 'utf8'));
    const ev = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'felt');
    assert.ok(ev, '应该落了一条 felt');
    assert.equal(ev.channel, 'wechat', '要记下这条发生在哪个场合');

    const recall = t.get('ajing_recall');
    const hit = text(await recall.execute({ query: '外面' }));
    assert.match(hit, /wechat/, '翻的时候要标出来源场合——不然分不清这话是在哪儿说的');
  } finally {
    delete process.env.AJING_CHANNEL;
    cleanup(root);
  }
});

// ———— 12. 撞见之后长出的「会做」：能记、能翻（规格第十五节）————
test('真跑 remember kind=skill：做法记下来，翻得到', async () => {
  const root = freshRoot();
  try {
    const t = await loadTools(root);
    const remember = t.get('ajing_remember');
    await remember.execute({
      kind: 'skill',
      title: '先点左边再等三秒',
      text: '点左边那个按钮，等三秒，它才回画面。',
    });

    const raw = await import('node:fs').then((m) => m.readFileSync(join(root, 'events.jsonl'), 'utf8'));
    const ev = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'skill-learned');
    assert.ok(ev, '账本里要有一条 skill-learned');
    assert.equal(ev.title, '先点左边再等三秒');

    const recall = t.get('ajing_recall');
    const hit = text(await recall.execute({ query: '三秒' }));
    assert.match(hit, /skills/, '做法要能翻到——翻不到，等于没学会');
  } finally { cleanup(root); }
});

// ———— 13. 单写者锁：写完要自己收回去（规格第十二节）————
test('真跑：账本锁写完收回去，不留在那儿卡下次', async () => {
  const root = freshRoot();
  try {
    const t = await loadTools(root);
    const feel = t.get('ajing_feel');
    await feel.execute({ action: 'note', text: '写一条，看看锁收没收' });
    assert.ok(existsSync(join(root, 'events.jsonl')), '账本要写进去');
    assert.ok(!existsSync(join(root, '.state', 'events.lock')), '锁文件写完必须删掉——留着下次全卡死');
  } finally { cleanup(root); }
});

// ———— 14. 说「收工」等于说「困了」：当天不再叫（v2.8.0）————
test('真跑 pace：收工之后留下 sleepy 标记，当天不再唤醒', async () => {
  const root = freshRoot();
  try {
    const t = await loadTools(root);
    const pace = t.get('ajing_pace');
    await pace.execute({ action: 'rest', reason: '今天累了' });
    const f = join(root, '.state', 'sleepy.txt');
    assert.ok(existsSync(f), '收工要留个「她睡了」的标记，不然醒来机制不知道');
    const raw = (await import('node:fs')).readFileSync(f, 'utf8').trim();
    assert.match(raw, /^\d{4}-\d{2}-\d{2}$/, '存的是日期，第二天自然失效');
  } finally { cleanup(root); }
});

// ———— 2026-11-02 新加的三件 ————

test('真跑 skill replaces：旧做法被标成「已被取代」，文件留档不删', async () => {
  const root = freshRoot();
  try {
    const tools = await loadTools(root);
    const rm = tools.get('ajing_remember');
    const r1 = await rm.execute({ kind: "skill", title: "撬锁心得", text: "用发卡别用刀，刀口会留痕" });
    assert.ok(text(r1).includes("撬锁心得") || existsSync(join(root, "skills", "撬锁心得.md")), text(r1));
    const oldFile = join(root, "skills", "撬锁心得.md");
    assert.ok(existsSync(oldFile), "第一版应该写出来");
    const before = readFileSync(oldFile, "utf8");
    assert.ok(!before.includes("已被取代"), "还没被推翻时不该有标记");

    const r2 = await rm.execute({ kind: "skill", title: "撬锁新法", text: "先看锁芯形状，别硬来", replaces: "撬锁心得" });
    assert.ok(text(r2), text(r2));
    const after = readFileSync(oldFile, "utf8");
    assert.ok(after.includes("已被取代"), "旧做法要标成已被取代");
    assert.ok(after.includes("撬锁新法"), "抬头要写清谁来接的");
    assert.ok(after.includes("用发卡"), "旧的内容不删，留档");
  } finally { cleanup(root); }
});

test('真跑 pace handoff：交接单能自己写出来，带会话 id 和时间头', async () => {
  const root = freshRoot();
  const prev = process.env.DSH_SESSION_ID;
  try {
    process.env.DSH_SESSION_ID = "session-testhandoff-0001";
    const tools = await loadTools(root);
    const pace = tools.get('ajing_pace');
    const r = await pace.execute({ action: "handoff", text: "## 在办的三件事\n一、测试交接\n\n## 下一句该说什么\n把测试跑完。" });
    assert.ok(String(r?.verdict || "").includes("交接写好了") || text(r).includes("交接单写好了"), text(r));
    // 而且必须写在临时目录里，不许碰真实那份
    assert.ok(existsSync(join(root, "交接.md")), "交接单应该落在 AJING_HANDOFF 指的地方");
  } finally {
    if (prev === undefined) delete process.env.DSH_SESSION_ID; else process.env.DSH_SESSION_ID = prev;
    cleanup(root);
  }
});

test('真跑 pace handoff：没写正文就当场说没写，不生成半份单子', async () => {
  const root = freshRoot();
  try {
    const tools = await loadTools(root);
    const pace = tools.get('ajing_pace');
    const r = await pace.execute({ action: "handoff" });
    assert.ok(text(r).includes("没写正文"), text(r));
  } finally { cleanup(root); }
});
