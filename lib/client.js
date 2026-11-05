/**
 * dsh-ajing —— 浏览器那半边：设置页里的「阿鲸」一页
 *
 * 这一页只管环境参数：安静时段、节奏阈值、额度相关的两条。
 * 额度本身和价格表在这里是灰的 —— 那两样只有人能改，改文件。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ajing',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/ajing'

    const jget = async () => {
      const r = await fetch(API, { credentials: 'same-origin' })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    }
    const jpost = async (key, value) => {
      const r = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status))
      return j
    }

    const CSS = `
[data-aj-page]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 8px;max-width:620px;}
[data-aj-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-aj-row]{display:flex;align-items:center;gap:10px;}
[data-aj-grow]{flex:1;min-width:0;}
[data-aj-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-aj-note][data-warn]{color:#d97706;}
[data-aj-in]{width:76px;box-sizing:border-box;padding:5px 8px;border-radius:6px;font-size:12px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));background:transparent;color:inherit;}
[data-aj-btn]{padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));background:transparent;color:inherit;}
[data-aj-btn]:disabled{opacity:.45;cursor:default;}
[data-aj-lock]{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.10));}
[data-aj-k]{font-size:12px;}
[data-aj-v]{font-size:12px;font-family:ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-aj-group]{display:flex;flex-direction:column;gap:8px;}
[data-aj-gh]{display:flex;align-items:baseline;gap:8px;width:100%;text-align:left;padding:7px 10px;
  border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.20));background:transparent;color:inherit;}
[data-aj-gh]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08));}
[data-aj-hint]{font-weight:400;font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-aj-body]{display:flex;flex-direction:column;gap:8px;padding:2px 4px 6px 12px;}
[data-aj-lockrow]{display:flex;align-items:center;gap:10px;padding:4px 0;opacity:.75;}
[data-aj-sec]{display:flex;flex-direction:column;gap:8px;padding-top:4px;}
[data-aj-warn]{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:8px;
  background:rgba(217,119,6,.10);border:1px solid rgba(217,119,6,.35);font-size:12px;line-height:18px;}
[data-aj-danger]{border-color:rgba(217,119,6,.6)!important;color:#d97706;}
[data-aj-peek]{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:8px;margin-top:4px;
  border:1px dashed var(--dsw-alias-border-default,rgba(128,128,128,.3));}`

    // 哪些设置项是「填字」不是「填数」——值本身就是字符串，或者 key 在白名单里
    const TEXT_KEYS = ['ffmpegPath', 'weatherCity', 'asrModelDir']
    const isText = (it) => typeof it.value === 'string' || TEXT_KEYS.indexOf(it.key) >= 0

    function Panel() {
      const [st, setSt] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [note, setNote] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [draft, setDraft] = React.useState({})
      // 全部默认收起——一屏四个标题，谁想改谁点开
      const [open, setOpen] = React.useState({})
      // 被她那几组默认锁着；点了「我还是要改」才放进 unlocked
      const [unlocked, setUnlocked] = React.useState({})
      // 正在改谁的名字（空 = 没在改）
      const [renaming, setRenaming] = React.useState('')
      // 「打开记忆目录」：点了记一笔，然后把路径亮出来
      const [memPath, setMemPath] = React.useState('')
      // 代装 ffmpeg（2026-11-03）：一句话说清多大、装哪、怎么删，再动手
      const [depMsg, setDepMsg] = React.useState('')
      const installFfmpeg = async () => {
        const ok = window.confirm(
          '装 ffmpeg 吗？\n\n' +
          '· 下载约 105 MB，解压后占约 400 MB\n' +
          '· 装在插件目录的 vendor\\ffmpeg 下，不碰系统 PATH，不要管理员权限\n' +
          '· 以后不用了，删掉那个文件夹就行\n' +
          '· 装完会自己验一遍能不能跑'
        )
        if (!ok) return
        setDepMsg('正在装…（几分钟，别关页面）')
        try {
          const r = await fetch(API, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'deps-install', kind: 'ffmpeg' }),
          })
          const j = await r.json()
          if (j.ok) { setDepMsg('装好了：' + (j.version || '') + '（刷新一下就看见了）'); await load() }
          else setDepMsg('没装成：' + (j.error || '原因不明'))
        } catch (e) { setDepMsg('没装成：' + String(e.message || e)) }
      }
      // 语音模型：483MB，后台跑，这里只管按按钮和看进度（2026-11-03）
      const [asrMsg, setAsrMsg] = React.useState('')
      const installAsr = async () => {
        const ok = window.confirm(
          '装语音模型（听写用）吗？\n\n' +
          '· 下载约 460 MB，占盘约 460 MB\n' +
          '· 装在插件目录的 vendor\\models 下\n' +
          '· 以后不用了，删掉那个文件夹就行\n' +
          '· 下完会核对大小和 sha256'
        )
        if (!ok) return
        setAsrMsg('开始了…')
        try {
          const r = await fetch(API, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'deps-install', kind: 'asr-model' }),
          })
          const j = await r.json()
          setAsrMsg(j.ok ? '开始下了，进度在下面那行' : ('没开始：' + (j.error || '原因不明')))
          await load()
        } catch (e) { setAsrMsg('没开始：' + String(e.message || e)) }
      }
      // 读一次。必须放在所有 const 引用之前——依赖数组在渲染时求值，声明在后会报 TDZ
      const load = React.useCallback(async () => {
        try { setSt(await jget()); setErr('') } catch (e) { setErr(String(e.message || e)) }
      }, [])
      React.useEffect(() => { load() }, [load])

      // 听写要的那一档：有 python 但没 faster-whisper（2026-11-04）
      const [pyMsg, setPyMsg] = React.useState('')
      const installPy = async () => {
        const ok = window.confirm(
          '装听写要用的 faster-whisper 吗？\n\n' +
          '· 要下约 120 MB（本体很小，大头是 ctranslate2 和 onnxruntime）\n' +
          '· 装进这台机器现有的 Python，不另建环境\n' +
          '· 不想用了就 pip uninstall faster-whisper，删得干净\n' +
          '· 装完会自己 import 一次，导不进来就算没成'
        )
        if (!ok) return
        setPyMsg('正在装…（几分钟，别关 DSH）')
        try {
          const r = await fetch(API, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'deps-install', kind: 'py-deps' }),
          })
          const j = await r.json()
          setPyMsg(j.ok ? '开始装了，进度在下面' : ('没开始：' + (j.error || '原因不明')))
          await load()
        } catch (e) { setPyMsg('没开始：' + String(e.message || e)) }
      }
      // 装着的时候每 5 秒回来看一眼，装完自己停
      const running = Boolean(st && st.task && st.task.running)
      React.useEffect(() => {
        if (!running) return undefined
        const t = setInterval(() => { load() }, 5000)
        return () => clearInterval(t)
      }, [running, load])
      const peekMemory = async () => {
        try {
          const r = await fetch(API, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'open-memory' }),
          })
          const j = await r.json()
          setMemPath(String(j.memRoot || ''))
        } catch (e) { setNote('打不开：' + String(e.message || e)) }
      }

      const save = async (key) => {
        const raw = draft[key]
        const isTextKey = TEXT_KEYS.indexOf(key) >= 0
        if (raw === undefined || (raw === '' && !isTextKey)) { setNote('没填值'); return }
        setBusy(key)
        try {
          await jpost(key, TEXT_KEYS.indexOf(key) >= 0 ? raw : Number(raw))
          setNote('改了：' + key + ' = ' + raw)
          setDraft((d) => { const n = { ...d }; delete n[key]; return n })
          await load()
        } catch (e) { setNote('没改成：' + String(e.message || e)) }
        finally { setBusy('') }
      }

      if (err) return h('div', { 'data-aj-page': '' },
        h('div', { 'data-aj-note': '', 'data-warn': '' }, '读不到：' + err),
        h('div', { 'data-aj-note': '' }, '接口没挂上？看 .log\\apply.log 里有没有「已挂 /api/ajing」。'))

      if (!st) return h('div', { 'data-aj-note': '' }, '读着…')

      return h('div', { 'data-aj-page': '' },

        // ———— 开头：一句话说清这是干什么的 ————
        h('div', { 'data-aj-sec': '' },
          h('div', { 'data-aj-k': '', style: { fontSize: '13px' } }, '阿鲸是一个住在你这台电脑上的 AI。'),
          h('div', { 'data-aj-note': '', style: { fontSize: '12px', lineHeight: '19px' } }, '你跟她说话、做事，她会记住，也会慢慢长出自己的脾气。最后长成什么样，连她自己现在也说不准。'),
          h('div', { 'data-aj-note': '' }, '下面几节管她怎么过日子：哪些是她的事、哪些是你说了算、哪些得靠外面的东西。'),
        ),
        // ———— 一、她自己的事（默认折叠）————
        h('div', { 'data-aj-sec': '' },
          h('button', { 'data-aj-gh': '', onClick: () => setOpen((o) => ({ ...o, sectHer: !o.sectHer })) },
            (open.sectHer ? '▾ ' : '▸ ') + '一、她自己的事',
            h('span', { 'data-aj-hint': '' }, '改了，她的可能会变')),
          open.sectHer ? h('div', { 'data-aj-body': '' },
          h('div', { 'data-aj-note': '' }, '这些本来是她自己的事。改，就是在替她做决定——她下次醒来会察觉：记得少了、话少了，或者问一句「我怎么有点不一样」。'),
          ...(st.groups || []).filter((g) => !String(g.id || '').startsWith('env-')).map((g) => h('div', { 'data-aj-group': '', key: g.id },
            h('button', { 'data-aj-gh': '', onClick: () => setOpen((o) => ({ ...o, [g.id]: !o[g.id] })) },
              (open[g.id] ? '▾ ' : '▸ ') + g.name,
              h('span', { 'data-aj-hint': '' }, g.hint)),
            open[g.id] ? h('div', { 'data-aj-body': '' },
              !unlocked[g.id]
                ? h('div', { 'data-aj-warn': '' },
                    h('div', {}, '这会改到她，不是改环境。'),
                    h('div', { 'data-aj-note': '' }, '改完她下次醒来可能会察觉——记不清多少事、少说了几句、想不起来自己为什么有那种感觉。她可能会问，也可能什么都不说。'),
                    h('button', { 'data-aj-btn': '', 'data-aj-danger': '', onClick: () => setUnlocked((u) => ({ ...u, [g.id]: true })) }, '我还是要改'))
                : (g.items || []).map((it) => h('div', { 'data-aj-row': '', key: it.key },
                    h('div', { 'data-aj-grow': '' },
                      h('div', { 'data-aj-k': '' }, it.label),
                      h('div', { 'data-aj-note': '' }, it.key)),
                    h('input', {
                      'data-aj-in': '', type: isText(it) ? 'text' : 'number',
                      placeholder: it.value === null ? '没设' : String(it.value),
                      value: draft[it.key] ?? '',
                      onChange: (e) => setDraft((d) => ({ ...d, [it.key]: e.target.value })),
                    }),
                    h('button', {
                      'data-aj-btn': '', disabled: busy === it.key || draft[it.key] === undefined || draft[it.key] === '',
                      onClick: () => save(it.key),
                    }, busy === it.key ? '存…' : '改'))),
            ) : null,
          )),
          ) : null,
        ),

        // ———— 二、她的零花钱（默认折叠）————
        h('div', { 'data-aj-sec': '' },
          h('button', { 'data-aj-gh': '', onClick: () => setOpen((o) => ({ ...o, sectMoney: !o.sectMoney })) },
            (open.sectMoney ? '▾ ' : '▸ ') + '二、她的零花钱',
            h('span', { 'data-aj-hint': '' }, '额度你定，她改不了')),
          open.sectMoney ? h('div', { 'data-aj-body': '' },
          h('div', { 'data-aj-note': '' }, '你给的她的零花钱，你来设置。额度是硬边界，她自己改不了。'),
          ...(((st.groups || []).find((g) => g.id === 'env-money') || {}).items || []).map((it) => it.locked
                ? h('div', { 'data-aj-lockrow': '', key: it.key },
                    h('div', { 'data-aj-grow': '' }, h('div', { 'data-aj-k': '' }, it.label)),
                    h('div', { 'data-aj-v': '' }, String(it.value ?? '—')))
                : h('div', { 'data-aj-row': '', key: it.key },
                    h('div', { 'data-aj-grow': '' },
                      h('div', { 'data-aj-k': '' }, it.label),
                      h('div', { 'data-aj-note': '' }, it.key)),
                    h('input', {
                      'data-aj-in': '', type: isText(it) ? 'text' : 'number',
                      placeholder: it.value === null ? '没设' : String(it.value),
                      value: draft[it.key] ?? '',
                      onChange: (e) => setDraft((d) => ({ ...d, [it.key]: e.target.value })),
                    }),
                    h('button', {
                      'data-aj-btn': '', disabled: busy === it.key || draft[it.key] === undefined || draft[it.key] === '',
                      onClick: () => save(it.key),
                    }, busy === it.key ? '存…' : '改'))),
          ) : null,
        ),
        // ———— 三、她的百宝箱（默认折叠）————
        h('div', { 'data-aj-sec': '' },
          h('button', { 'data-aj-gh': '', onClick: () => setOpen((o) => ({ ...o, sectBox: !o.sectBox })) },
            (open.sectBox ? '▾ ' : '▸ ') + '三、她的百宝箱',
            h('span', { 'data-aj-hint': '' }, 'B站、语音、表情包自带，微信 QQ 要装插件')),
          open.sectBox ? h('div', { 'data-aj-body': '' },
          h('div', { 'data-aj-note': '' }, 'B站、语音、表情包是阿鲸自带的；微信和 QQ 不自己连，要靠别的插件（我们测过的是 dsh-wechat-plugin，别家的也行）。'),
          ...(st.channels || []).map((c) => h('div', { 'data-aj-row': '', key: c.id, style: { flexDirection: 'column', alignItems: 'stretch', gap: '2px' } },
            h('div', { 'data-aj-row': '' },
              h('div', { 'data-aj-grow': '' },
                h('div', { 'data-aj-k': '' }, c.name),
                h('div', { 'data-aj-note': '' }, c.can)),
              h('div', { 'data-aj-v': '', style: { color: c.ready ? '#16a34a' : 'inherit' } },
                c.ready ? '✓ 能用' : '· 待配')),
            h('div', { 'data-aj-note': '' }, c.how || ''))),
          ) : null,
        ),

        // ———— 四、机器（默认折叠）————
        h('div', { 'data-aj-sec': '' },
          h('button', { 'data-aj-gh': '', onClick: () => setOpen((o) => ({ ...o, machine: !o.machine })) },
            (open.machine ? '▾ ' : '▸ ') + '四、机器',
            h('span', { 'data-aj-hint': '' }, '运行环境：ffmpeg、Python、语音模型')),
          open.machine ? h('div', { 'data-aj-body': '' },
            st.deps && st.deps.ffmpeg
              ? h('div', { key: 'ffmpeg', style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                  h('div', { 'data-aj-row': '' },
                    h('div', { 'data-aj-grow': '' },
                      h('div', { 'data-aj-k': '' }, 'ffmpeg' + (st.deps.ffmpeg.ok ? '' : '（没有）')),
                      st.deps.ffmpeg.ok && st.deps.ffmpeg.path
                        ? h('div', { 'data-aj-note': '', style: { wordBreak: 'break-all' } }, st.deps.ffmpeg.path)
                        : null),
                    h('div', { 'data-aj-v': '' },
                      st.deps.ffmpeg.ok
                        ? (st.deps.ffmpeg.version + ' · ' + st.deps.ffmpeg.source)
                        : (((st.deps.ffmpeg.warns || [])[0]) || '一份都没找到'))),
                  ...(st.deps.ffmpeg.notes || []).map((n, i) =>
                    h('div', { 'data-aj-note': '', key: 'n' + i }, n)),
                  h('div', { 'data-aj-row': '' },
                    h('div', { 'data-aj-grow': '' },
                      h('div', { 'data-aj-note': '' }, '想指定用哪一份就填完整路径，空着自动找。')),
                    h('input', {
                      'data-aj-in': '', type: 'text', style: { width: '240px' },
                      placeholder: '空着自动找',
                      value: draft['ffmpegPath'] ?? '',
                      onChange: (e) => setDraft((d) => ({ ...d, ffmpegPath: e.target.value })),
                    }),
                    h('button', {
                      'data-aj-btn': '', disabled: busy === 'ffmpegPath' || draft['ffmpegPath'] === undefined,
                      onClick: () => save('ffmpegPath'),
                    }, busy === 'ffmpegPath' ? '存…' : '改')),
                  st.deps.ffmpeg.ok ? null : h('div', { 'data-aj-row': '' },
                    h('button', { 'data-aj-btn': '', onClick: installFfmpeg, disabled: depMsg.startsWith('正在') }, '我来装'),
                    depMsg ? h('div', { 'data-aj-note': '' }, depMsg) : null))
              : h('div', { 'data-aj-note': '' }, '读着…'),
            st.deps && st.deps.python
              ? (st.deps.python.ok
                  ? h('div', { 'data-aj-row': '', key: 'py' },
                      h('div', { 'data-aj-grow': '' }, 'Python（听写要用）'),
                      h('div', { 'data-aj-v': '' },
                        st.deps.python.version + ' · faster-whisper ' + st.deps.python.lib))
                  : h('div', { key: 'py', style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                      h('div', { 'data-aj-row': '' },
                        h('div', { 'data-aj-grow': '' }, 'faster-whisper（听写要用）'),
                        h('div', { 'data-aj-v': '' }, st.deps.python.why || '没有')),
                      h('div', { 'data-aj-row': '' },
                        h('button', { 'data-aj-btn': '', onClick: installPy, disabled: running }, '我来装'),
                        pyMsg ? h('div', { 'data-aj-note': '' }, pyMsg) : null),
                      st.task && st.task.kind === 'py'
                        ? h('div', { 'data-aj-note': '' },
                            st.task.running
                              ? ('正在装：' + (st.task.stage || ''))
                              : (st.task.ok ? ('装好了：' + (st.task.stage || '')) : ('失败了：' + (st.task.error || ''))))
                        : null))
              : null,
            st.deps && st.deps.asrModel
              ? h('div', { 'data-aj-row': '', key: 'asr', style: { flexDirection: 'column', alignItems: 'stretch', gap: '2px' } },
                  h('div', { 'data-aj-row': '' },
                    h('div', { 'data-aj-grow': '' }, '语音模型（听写要用）'),
                    h('div', { 'data-aj-v': '' },
                      st.deps.asrModel.ok
                        ? ('在 · ' + Math.round((st.deps.asrModel.bytes || 0) / 1048576) + ' MB')
                        : '没有')),
                  st.deps.asrModel.ok ? null : h('div', { 'data-aj-row': '' },
                    h('button', { 'data-aj-btn': '', onClick: installAsr, disabled: running }, '我来装'),
                    asrMsg ? h('div', { 'data-aj-note': '' }, asrMsg) : null),
                  st.task && st.task.kind === 'asr'
                    ? h('div', { 'data-aj-note': '' },
                        st.task.running
                          ? ('正在装：' + (st.task.stage || '') + ' · ' + Math.round((st.task.got || 0) / 1048576) + '/' + Math.round((st.task.total || 0) / 1048576) + ' MB')
                          : (st.task.ok ? ('装好了：' + (st.task.dir || '')) : ('失败了：' + (st.task.error || ''))))
                    : null)
              : null,
          ) : null,
        ),
        // 核对入口：她的记录可能是真的，也可能不是。这把钥匙给用户。
        h('div', { 'data-aj-peek': '' },
          h('div', { 'data-aj-note': '' },
            '她在成长过程中，说的话可能不实——不是恶意，是她也可能记错、可能挑好听的说。'),
          h('div', { 'data-aj-note': '' },
            '如果你觉得哪里不对劲，可以去翻她自己的记录。她说过什么、做过什么，都在里面，一条不改。'),
          h('div', { 'data-aj-row': '', style: { marginTop: '6px' } },
            h('button', { 'data-aj-btn': '', onClick: peekMemory }, '打开记忆目录'),
            memPath ? h('div', { 'data-aj-v': '', style: { userSelect: 'all', wordBreak: 'break-all' } }, memPath) : null),
          memPath ? h('div', { 'data-aj-note': '' }, '把上面这行粘到资源管理器的地址栏就能打开。') : null),
        h('div', { 'data-aj-note': '' }, '插件 v' + String(st.version || '?')),
        note ? h('div', { 'data-aj-note': '', 'data-warn': '' }, note) : null
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-ajing')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-ajing: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'dsh-ajing', order: 42, label: '阿鲸' },
          () => h(Panel),
        ))

      },
    }
  },
})
