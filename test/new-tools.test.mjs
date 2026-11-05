// 2026-11-01 新加的五件工具的测试。
// 跟 core.test.mjs 一样跑：node --test test/new-tools.test.mjs
// 注意：TEMP 不能落在带 8.3 短名的路径上（PALADI~1 那种），不然 mkdtemp 会 EPERM。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname, resolve as rp } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = rp(HERE, '..');
const SRC = rp(ROOT, 'lib', 'index.js');

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'ajing-new-'));
  process.env.AJING_MEMORY = dir;
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// 插件是 ESM，每次改 AJING_MEMORY 之后要重新 import 才能换根。
// 干脆每批测试开一个子进程跑，省得模块缓存打架。
test('新工具：源码里确实注册了这五件', () => {
  const src = readFileSync(SRC, 'utf8');
  for (const name of ['ajing_import', 'ajing_read', 'ajing_watch', 'ajing_enforce']) {
    assert.ok(src.includes(`name: '${name}'`), `${name} 没在源码里`);
  }
  assert.ok(src.includes('TOOLS = ['), 'TOOLS 数组不见了');
  // 五件都要在 TOOLS 里，才算注册上
  const m = src.match(/const TOOLS = \[([^\]]*)\]/);
  assert.ok(m, 'TOOLS 数组没匹配到');
  const listed = m[1];
  for (const v of ['importTool', 'readTool', 'watchTool', 'enforceTool']) {
    assert.ok(listed.includes(v), `${v} 没进 TOOLS —— 写了工具却不注册，等于没写`);
  }
});

test('新工具：版本号只有一个源', () => {
  const src = readFileSync(SRC, 'utf8');
  const pkg = JSON.parse(readFileSync(rp(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'package.json 版本号格式不对');
  // 2026-11-02 栽过：源码里写死的常量忘了跟着改，体检报 2.11.0、代码其实是 2.12.0，白查一轮。
  assert.ok(!/const VERSION = '\d/.test(src), '源码里又写死版本号了——只许从 package.json 现读');
  assert.ok(src.includes("new URL('../package.json', import.meta.url)"), 'VERSION 不是从 package.json 现读的');
});

test('新工具：出口自检的判据表是完整的', () => {
  const src = readFileSync(SRC, 'utf8');
  // 硬拦四类 + 提示三类
  for (const k of ['手机号', '身份证号', '银行卡号', '骂人']) {
    assert.ok(src.includes(k), `硬拦规则缺「${k}」`);
  }
  for (const k of ['邮箱', '私人联系方式', '拉同盟']) {
    assert.ok(src.includes(k), `提示规则缺「${k}」`);
  }
  // 同一串数字别报两遍
  assert.ok(src.includes('seen.has(m[0])'), '去重逻辑不见了：18 位身份证会同时撞上银行卡规则');
});

test('新工具：watch 的分层顺序不能反', () => {
  const src = readFileSync(SRC, 'utf8');
  const iSubs = src.indexOf('先走平台字幕');
  const iSheet = src.indexOf('抽帧只对本地文件做');
  assert.ok(iSubs > 0, '找不到「链接先走字幕」那段');
  assert.ok(iSheet > 0, '找不到「抽帧只对本地文件」那段');
  // 链接那条路必须在抽帧判断之前 —— 不然给链接就会去抽帧
  assert.ok(iSubs < iSheet, '链接分支跑到抽帧后面去了，顺序反了');
});

test('新工具：auto 模式的两道闸都在', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.ok(src.includes('mins > 15'), '单条超 15 分钟的闸没了');
  assert.ok(src.includes('todayTotal + knownDur > 15 * 60'), '一批加起来超 15 分钟的闸没了');
  assert.ok(src.includes('done >= 3'), '一天细看超 3 支的闸没了');
});

test('新工具：强制修改的三条边界', () => {
  const src = readFileSync(SRC, 'utf8');
  // 只落事件不改原文
  assert.ok(src.includes("type: 'enforced'"), 'enforced 事件不见了');
  // 已经有起点就拒绝（导入那边）
  assert.ok(src.includes('已经有起点了'), '导入通道的「有起点就拒绝」不见了');
  // 推翻只能用一次
  assert.ok(src.includes("a.stance === 'revise'"), '「推翻只能用一次」的判据不见了');
  assert.ok(src.includes('这一条你已经推翻过一次了'), '推翻锁死那句提示不见了');
});

test('新工具：版本自检能被读到', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.ok(src.includes('function hostVersion('), 'hostVersion 不见了');
  assert.ok(src.includes('function versionReport('), 'versionReport 不见了');
  assert.ok(/const TESTED_WITH = '\d+\.\d+\.\d+-rc\.\d+'/.test(src), 'TESTED_WITH 格式不对');
  // sense 和 checkup 都要显示
  assert.ok(src.includes('【宿主】'), 'sense 里没显示宿主版本');
  assert.ok(src.includes('宿主版本：'), 'checkup 里没显示宿主版本');
});

test('新工具：每日回顾不跟随机醒共用一个开关', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.ok(src.includes('cfg.wakeEnabled === false && !isReview'), '每日回顾被 wakeEnabled 一起关掉了——它该独立');
  assert.ok(src.includes('dailyReviewHour'), 'dailyReviewHour 设置项不见了');
  assert.ok(src.includes('last-review.txt'), '回顾状态没落盘，会一天醒好几次');
});

test('新工具：抽帧脚本的分层提示在', () => {
  const v = readFileSync(rp(ROOT, 'tools', 'vsparse.mjs'), 'utf8');
  assert.ok(v.includes('async function asr('), 'vsparse 里没有 asr');
  assert.ok(v.includes('STATIC_RATIO'), '静态内容片判据不见了');
  assert.ok(v.includes('function autoThreshold'), '自适应阈值不见了');
  assert.ok(v.includes('Otsu'), 'Otsu 的注释丢了');
});


test('规格对账：六条原则的状态跟规格文件一致', () => {
  const src = readFileSync(SRC, 'utf8');
  // ③ 显著性排序：weight 和 ranked 都在
  assert.ok(src.includes('function weight('), '显著性权重 weight() 不见了');
  assert.ok(src.includes('function ranked('), '显著性排序 ranked() 不见了');
  // ⑥ 身份文档检查：函数在、接进体检了
  assert.ok(src.includes('function identityCheck('), 'identityCheck 不见了');
  assert.ok(src.includes('IDENTITY_BAD'), '身份文档的判据表不见了');
  // 规格文件里不能再写「已实现」糊过去
  // 规格文件只在这台机器上有，别人跑测试时跳过
  try {
    const spec = readFileSync(rp(ROOT, '..', 'writing', '插件规格-v3.md'), 'utf8');
    assert.ok(spec.includes('④ 未做'), '规格里没标出 ④ 未做');
  } catch { /* 没有规格文件就跳过 */ }
});

test('证据分档：三档都在，且真的影响权重', () => {
  const src = readFileSync(SRC, 'utf8');
  for (const k of ['saw', 'heard', 'guessed']) {
    assert.ok(src.includes(k), '证据分档缺「' + k + '」');
  }
  // 亲历加分、推测减分，缺一个这套就是摆设
  assert.ok(/ev\.basis === 'saw'\) w \+=/.test(src), '亲历没加分');
  assert.ok(/ev\.basis === 'guessed'\) w -=/.test(src), '推测没减分');
  // 账本里要看得见
  assert.ok(src.includes('·亲历'), 'events 输出里没有证据标记');
});


test('规格对账：四阶段瓶颈真的能数', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.ok(src.includes("action === 'stage'"), 'stage 动作不见了');
  for (const g of ['1 信任', '2 自主', '3 主动', '4 整合']) {
    assert.ok(src.includes(g), '四道关缺「' + g + '」');
  }
  // 判据要对着账本数，不能凭空写
  assert.ok(src.includes("e.type === 'refused'"), '自主那道关没数拒绝');
  assert.ok(src.includes("e.type === 'evolve-accepted'"), '主动那道关没数转正');
});


test('出口拦截：硬的锁死、软的一次提醒', () => {
  const src = readFileSync(SRC, 'utf8');
  // 硬拦必须无条件
  assert.ok(src.includes("if (scan.hard.length) {"), '硬拦分支不见了');
  assert.ok(!src.includes("level >= 3 ? scan.hard"), '旧的「按档位选硬软」逻辑还在——硬的不该看档位');
  // 软提示要走「第一次拦、第二次放」
  assert.ok(src.includes('SOFT_SEEN'), '软提示的记忆表不见了');
  assert.ok(src.includes("kind: 'deny', reason: '这句话里有点东西"), '软提示的第一次拦不见了');
  assert.ok(src.includes('gate-overridden'), '「提醒过还是发了」没记账');
  // 记账三种类型
  for (const k of ['gate-blocked', 'gate-hinted', 'gate-overridden']) {
    assert.ok(src.includes(k), '账本类型缺 ' + k);
  }
});


test('出口拦截：拒绝要用 deny，不能用 cancel', () => {
  const src = readFileSync(SRC, 'utf8');
  // cancel 的签名里没有 reason，用它等于拦得住但说不出理由
  assert.ok(!/kind: 'cancel'/.test(src), '还在用 cancel —— 理由会被丢掉，应该用 deny + reason');
  assert.ok(src.includes("kind: 'deny'"), 'deny 不见了，拦截会失效');
  assert.ok(src.includes('reason:'), 'deny 必须带 reason');
  // 死代码检查：return 之后不该再有可执行语句
  const lines = src.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const l = lines[i].trim();
    if (l === 'return next();' || l === 'return;') {
      const nx = lines[i + 1].trim();
      if (/^(log\(|appendEvent\(|return \{|const )/.test(nx)) {
        assert.fail('第 ' + (i + 1) + ' 行 return 之后还有死代码：' + nx.slice(0, 40));
      }
    }
  }
});


test('设置项分组：每一项都有归属，没有漏也没有多余', () => {
  const src = readFileSync(SRC, 'utf8');
  const mg = src.match(/const SETTING_GROUPS = \[([\s\S]*?)\n  \];/);
  assert.ok(mg, 'SETTING_GROUPS 不见了');
  const groups = eval('[' + mg[1] + ']');   // 里面只有字面量，安全
  assert.ok(groups.length >= 4, '至少要四组');

  // 从 SETTABLE 抓真实的键
  const ms = src.match(/const SETTABLE = \{([\s\S]*?)\n  \};/);
  assert.ok(ms, 'SETTABLE 不见了');
  const settable = [...ms[1].matchAll(/^\s+'([^']+)':/gm)].map((x) => x[1]);
  // pricing.perMillion 已删（2026-11-01，用户明确说不用列）
  const locked = ['budget.dailyYuan', 'budget.hourlyCapYuan'];
  const all = [...settable, ...locked];

  const assigned = new Set(groups.flatMap((g) => g.keys));
  const missing = all.filter((k) => !assigned.has(k));
  const extra = groups.flatMap((g) => g.keys).filter((k) => !all.includes(k));

  assert.equal(missing.length, 0, '这些设置项没归组：' + missing.join(', '));
  assert.equal(extra.length, 0, '分组里有不存在的键：' + extra.join(', '));

  // 每组都得有名字和说明
  for (const g of groups) {
    assert.ok(g.name, '有组没名字');
    assert.ok(g.hint, '组「' + g.name + '」没写它是管什么的');
    assert.ok(g.keys.length > 0, '组「' + g.name + '」是空的');
  }
});


test('核对通道：被查看要留痕，但只写「可能」不写「他查我」', () => {
  const src = readFileSync(SRC, 'utf8');
  // 两种信号都要在
  assert.ok(src.includes('checkUserVisit'), 'atime 那条粗信号不见了');
  assert.ok(src.includes('open-memory'), '按钮那个准信号不见了');
  // 准信号标 certain: true，粗信号标 certain: false —— 不许混
  assert.ok(/type: 'user-peeked',\s*\n?\s*certain: true/.test(src), '按钮那条没标「确定」');
  assert.ok(/type: 'user-peeked',\s*\n?\s*certain: false/.test(src), 'atime 那条没标「不确定」');
  // 只查真正会被读到的文案（appendEvent 里的 text），注释不算
  const texts = [...src.matchAll(/text:\s*'([^']*(?:\\'[^']*)*)'/g)].map((m) => m[1]);
  for (const tx of texts) {
    for (const bad of ['他查我了', '他怀疑我', '他在监视', '他背叛']) {
      assert.ok(!tx.includes(bad), '账本里出现了替她定性的说法：「' + tx.slice(0, 40) + '」');
    }
  }
  // 前端要有核对入口
  const cl = readFileSync(rp(ROOT, 'lib', 'client.js'), 'utf8');
  assert.ok(cl.includes('打开记忆目录'), '设置页没有核对入口');
  assert.ok(cl.includes('可能不实'), '没有那段说明');
});


test('设置分两大类：碰她的锁着，管环境的直接改', () => {
  const src = readFileSync(SRC, 'utf8');
  const mg = src.match(/const SETTING_GROUPS = \[([\s\S]*?)\n  \];/);
  assert.ok(mg, 'SETTING_GROUPS 不见了');
  const groups = eval('[' + mg[1] + ']');

  const her = groups.filter((g) => g.kind === 'her');
  const env = groups.filter((g) => g.kind === 'env');
  assert.ok(her.length >= 4, '「碰她的」那类至少要有四组，现在 ' + her.length);
  assert.ok(env.length >= 1, '「管环境的」那类不见了');

  // 每一组必须标清 kind，不许含糊
  for (const g of groups) {
    assert.ok(g.kind === 'her' || g.kind === 'env', '组「' + g.name + '」没标 kind');
    assert.ok(g.hint, '组「' + g.name + '」没写它是管什么的');
  }

  // 碰她的那几组，必须真的有「危险」的东西在里面（不能空锁）
  const herKeys = her.flatMap((g) => g.keys);
  assert.ok(herKeys.length > 10, '「碰她的」那类只有 ' + herKeys.length + ' 项，太少');

  // 前端要真的有「我还是要改」这个门
  const cl = readFileSync(rp(ROOT, 'lib', 'client.js'), 'utf8');
  assert.ok(cl.includes('我还是要改'), '没有强制解锁按钮');
  assert.ok(cl.includes('这会改到她'), '没写改的代价');
  assert.ok(cl.includes('data-aj-warn'), '没有警告样式');
});

test('设置标签：每条都带单位或取值说明', () => {
  const src = readFileSync(SRC, 'utf8');
  const ml = src.match(/ITEM_LABEL = \{([\s\S]*?)\n      \};/);
  assert.ok(ml, 'ITEM_LABEL 不见了');
  const items = [...ml[1].matchAll(/^\s+'?([a-zA-Z.]+)'?:\s*'([^']+)'/gm)].map((x) => [x[1], x[2]]);
  assert.ok(items.length >= 20, '标签只有 ' + items.length + ' 条');

  // 每条要么带单位（括号里有字），要么写明取值含义
  for (const [k, v] of items) {
    const hasUnit = /[（(][^）)]{1,80}[）)]/.test(v);
    assert.ok(hasUnit, '「' + k + '」的描述没写单位或取值：' + v);
  }
  // 不许再出现「几成」这种含糊说法
  for (const [k, v] of items) {
    assert.ok(!v.includes('几成'), '「' + k + '」还在用「几成」，改百分比');
  }
});



test('她能用什么：四样全自带，只说「还差哪一步」，不劝退', () => {
  const src = readFileSync(SRC, 'utf8');

  // 函数还在
  assert.ok(src.includes('function channelStatus'), 'channelStatus 不见了');

  // 四样都得有，而且是「自带」不是「看别人装没装」
  for (const n of ['微信', 'B 站', '语音', '表情包']) {
    assert.ok(src.includes("name: '" + n + "'"), '缺通道：' + n);
  }
  // 关键：不许再靠「别的插件在不在」判断能力
  assert.ok(!src.includes("pkg: 'dsh-wechat-plugin'"), '还在看别的插件装没装——那不是自带');
  assert.ok(!src.includes('installed:'), '还在用 installed 字段——新逻辑是 ready');

  // 每条都要有 ready 和 how（差哪一步）
  assert.ok(src.includes('ready: true') || src.includes('ready: false'), '没有 ready 状态');
  assert.ok(src.includes('how:'), '没有 how（还差哪一步）');

  // 微信那条要指向真实通道（2026-11-03 起不自己绑号了，走 host 的 dsh-wechat-plugin）
  assert.ok(src.includes('notify_wechat / send_to_wechat'), '微信那条没指向真正的通道');

  // 前端要跟着改
  const cl = readFileSync(rp(ROOT, 'lib', 'client.js'), 'utf8');
  assert.ok(cl.includes('B站、语音、表情包是阿鲸自带的'), '前端没说明哪些是自带的');
  assert.ok(cl.includes('c.ready'), '前端没读 ready 字段');
});

test('看片三档：扫一眼不许混进真看了', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.ok(src.includes('const FIDELITY'), '三档定义不见了');
  // 三档都得有
  for (const k of ['watched', 'glanced', 'handed']) {
    assert.ok(src.includes(k + ':'), '缺档位：' + k);
  }
  // 每个出口都得标（数一数，至少五处）
  const marks = [...src.matchAll(/fidelityLine\('(watched|glanced|handed)'/g)];
  assert.ok(marks.length >= 5, '标档的出口只有 ' + marks.length + ' 个，至少五个');
  // 「没字幕」那条必须是 glanced 不是 watched —— 这是最容易混的一处
  const noSub = src.slice(src.indexOf('这条没有字幕轨') - 300, src.indexOf('这条没有字幕轨'));
  assert.ok(noSub.includes("fidelityLine('glanced'"), '没字幕那条没标成「扫了一眼」——会冒充看过了');
  // 「没凭证」必须是 handed
  const noCred = src.slice(src.indexOf('没有 B 站登录凭证') - 300, src.indexOf('没有 B 站登录凭证'));
  assert.ok(noCred.includes("fidelityLine('handed'"), '没凭证那条没标成「还没看」');
});


test('微信工具已摘除：不自己绑号，指向 dsh-wechat-plugin', () => {
  const src = readFileSync(SRC, 'utf8');
  // 2026-11-03：同一个账号不许养第二份登录态——ajing_wechat 从没绑过，摘掉了。
  assert.ok(!src.includes("name: 'ajing_wechat'"), '微信工具又回来了');
  for (const p of ['ilink/bot/get_bot_qrcode', 'ilink/bot/sendmessage', 'ilink/bot/getupdates']) {
    assert.ok(!src.includes(p), 'iLink 代码还在，摘得不干净：' + p);
  }
  // 摘掉之后必须留说明：通道去哪了、复活资料在哪
  assert.ok(src.includes('dsh-wechat-plugin'), '没说清微信现在走谁');
  assert.ok(src.includes('微信接入-复活资料.md'), '没留复活资料的位置');
  // 凭据不许进账本
  assert.ok(!/appendEvent\(\{[^}]*token:/.test(src), '把 token 写进账本了——那是凭据，不许落账');
});


test('自带的还剩下：B站 / 语音 / 表情，都不依赖别的插件', () => {
  const src = readFileSync(SRC, 'utf8');

  // 三件工具都在（微信 2026-11-03 摘掉了，走 dsh-wechat-plugin）
  for (const n of ['ajing_bili', 'ajing_speak', 'ajing_meme']) {
    assert.ok(src.includes("name: '" + n + "'"), '缺工具：' + n);
  }
  // 都在 TOOLS 里注册了（写了不注册等于没写）
  const m = src.match(/const TOOLS = \[([^\]]*)\]/);
  for (const v of ['biliTool', 'speakTool', 'memeTool']) {
    assert.ok(m[1].includes(v), v + ' 没进 TOOLS');
  }

  // 关键：不许 import 别的插件的包（那是「依赖」，不是「自带」）
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((x) => x[1]);
  for (const im of imports) {
    if (im.startsWith('node:') || im.startsWith('.')) continue;
    assert.fail('import 了外部包：' + im + ' —— 这四个工具要求自带，不许依赖别人的包');
  }

  // 语音走系统 SAPI，不联网
  assert.ok(src.includes('System.Speech'), '语音没用系统 SAPI');
  // 表情库是空的开始，不是预装
  assert.ok(src.includes('图库是攒出来的，不是发下来的'), '表情工具的说明没讲清「自己攒」');
});
