// Dependency-free CDP driver: launches headless Chrome, performs REAL mouse
// clicks on the scene, and asserts Phase 2 movement behaviour.
import { spawn } from 'node:child_process'

const PORT = 9333
const FILE = 'file:///Users/dario.martinovski/murder-mystery/index.html'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const results = []
const rec = (name, pass, info = '') => {
  results.push({ name, pass, info })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${!pass ? '  :: ' + info : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1060,760', '--force-device-scale-factor=1',
  '--allow-file-access-from-files',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

let stderrBuf = ''
chrome.stderr.on('data', (d) => { stderrBuf += d.toString() })

const waitForWs = async () => {
  for (let i = 0; i < 100; i++) {
    const m = stderrBuf.match(/DevTools listening on (ws:\/\/\S+)/)
    if (m) return m[1]
    await sleep(100)
  }
  throw new Error('Chrome did not open a debug port:\n' + stderrBuf.slice(-2000))
}

const browserWsUrl = await waitForWs()

// open a page target on our file
const browserWs = new WebSocket(browserWsUrl)
await new Promise((res, rej) => { browserWs.onopen = res; browserWs.onerror = rej })
let msgId = 0
const waiting = new Map()
const send = (ws, method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId
  waiting.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params }))
})
const attachHandlers = (ws, onEvent) => {
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && waiting.has(m.id)) {
      const { res, rej } = waiting.get(m.id)
      waiting.delete(m.id)
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
    } else if (m.method && onEvent) onEvent(m)
  }
}
attachHandlers(browserWs)

const { targetId } = await send(browserWs, 'Target.createTarget', { url: FILE })
const { sessionId } = await send(browserWs, 'Target.attachToTarget', { targetId, flatten: true })

// talk to the page through the browser socket, tagged with sessionId
const pageSend = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId
  waiting.set(id, { res, rej })
  browserWs.send(JSON.stringify({ sessionId, id, method, params }))
})
browserWs.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && waiting.has(m.id)) {
    const { res, rej } = waiting.get(m.id)
    waiting.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
}

const consoleLogs = []
const evaluate = async (expression) => {
  const r = await pageSend('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result.value
}

await pageSend('Page.enable')
await pageSend('Runtime.enable')
await pageSend('Log.enable')

// route page console + errors back to node
const evtWs = browserWs
const origOnMessage = evtWs.onmessage
evtWs.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleLogs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleLogs.push('PAGE EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
  }
  origOnMessage(ev)
}

await sleep(1500)
// Phase 8: the intro narration covers the viewport on load and consumes every
// click. Skip to the end, then dismiss, before touching the game.
// Phase 9: the loading screen covers everything until fonts resolve and the
// minimum display time passes; wait for it to go before touching anything.
const waitLoading = async () => {
  for (let i = 0; i < 60; i++) {
    const gone = await evaluate(`(() => { const l = document.getElementById('loading-screen')
      return !l || l.classList.contains('loading-screen--hidden') || getComputedStyle(l).display === 'none' })()`)
    if (gone) return
    await sleep(200)
  }
}
await waitLoading()
const skipNarration = async () => {
  const c = await evaluate(`(() => { const r = document.getElementById('narration').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  // self-contained on pageSend so this can run before the click helpers exist
  const click = async () => {
    await pageSend('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'left', clickCount: 0, buttons: 0 })
    await sleep(25)
    await pageSend('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1, buttons: 1 })
    await pageSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1, buttons: 0 })
  }
  await click(); await sleep(250)
  await click(); await sleep(950)
}
await skipNarration()
 // let fonts + layout settle

// This suite drives dozens of walks and panel open/close cycles. The dialogue
// panel, item modal and inventory bar all carry backdrop-filter, which a
// software rasterizer re-blurs on every animated frame — pure decoration that
// costs seconds per cycle here and nothing to what is being tested. Panel
// animation and blur are covered by the Phase 3 and Phase 5 suites instead.
await evaluate(`(() => {
  const s = document.createElement('style')
  s.textContent = [
    '.dialogue, .item-modal { transition: none !important; }',
    '.dialogue, .inventory, .item-modal { backdrop-filter: none !important; }',
    '.item-modal--open .item-modal__card { animation: none !important; }',
  ].join('')
  document.head.appendChild(s)
})()`)

const readState = () => evaluate(`({
  left: parseFloat(player.style.left),
  top: parseFloat(player.style.top),
  px: playerPos.x, py: playerPos.y,
  isMoving,
  duration: player.style.transitionDuration,
  movingClass: player.classList.contains('player--moving'),
  playerExists: !!document.getElementById('player'),
  avatar: !!document.querySelector('.player__avatar'),
  shadow: !!document.querySelector('.player__shadow'),
  sceneCursor: getComputedStyle(document.querySelector('.scene')).cursor,
})`)

const clientFor = (x, y) => evaluate(`(() => {
  const s = document.querySelector('.scene')
  const r = s.getBoundingClientRect()
  return { cx: r.left + s.clientLeft + ${x}, cy: r.top + s.clientTop + ${y} }
})()`)

const mouse = async (type, cx, cy, button = 'left', clickCount = 0) =>
  pageSend('Input.dispatchMouseEvent', { type, x: cx, y: cy, button, clickCount, buttons: type === 'mousePressed' ? 1 : 0 })

// Phase 3: arriving at an interactable opens the dialogue panel, and an open
// panel deliberately swallows floor clicks. Reset with a real Escape keypress
// so movement assertions always start from a closed panel.
const panelOpen = () => evaluate(`dialogueState.open`)
// Synthetic keydown on document.body: headless Chrome's real key-input pipeline
// stalls when another CDP call follows a dispatchKeyEvent, and this suite fires
// one before every click. The body is what a real keypress targets when nothing
// is focused, so the page's Escape listener is exercised identically.
const pressEscape = async () => {
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
  await sleep(120)
}
const ensurePanelClosed = async () => { if (await panelOpen()) await pressEscape() }

const realClick = async (x, y) => {
  await ensurePanelClosed()
  const { cx, cy } = await clientFor(x, y)
  await mouse('mouseMoved', cx, cy)
  await sleep(30)
  await mouse('mousePressed', cx, cy, 'left', 1)
  await mouse('mouseReleased', cx, cy, 'left', 1)
}

const APPROACH = {
  'table-a': [572, 238], 'table-b': [182, 238], 'table-c': [400, 488],
  'table-d': [620, 350], 'bar': [752, 450], 'door-wc': [82, 80], 'door-exit': [856, 80],
}
// a point on each interactable that a real mouse can hit
const HIT = {
  'table-a': [572, 176], 'table-b': [182, 176], 'table-c': [400, 426],
  'table-d': [620, 404], 'bar': [826, 450], 'door-wc': [82, 26], 'door-exit': [856, 26],
}

// ── 1. player exists, avatar + shadow present, starts at Our Table ──
let s = await readState()
rec('1. player element exists with avatar + shadow', s.playerExists && s.avatar && s.shadow, JSON.stringify({ avatar: s.avatar, shadow: s.shadow }))
rec('1. starts beside Our Table (178,354)', s.px === 178 && s.py === 354, `playerPos=(${s.px},${s.py}) style=(${s.left},${s.top})`)
rec('1. left/top are centre-offset by 14px', s.left === 164 && s.top === 340, `left=${s.left} top=${s.top}`)
rec('1. no slide-in animation on load', s.duration === '', `transitionDuration='${s.duration}'`)

// ── 2. cursor ──
rec('2. scene uses the custom cursor (system cursor hidden)', s.sceneCursor === 'none', s.sceneCursor)
rec('2. interactables also hide the system cursor',
  await evaluate(`getComputedStyle(document.getElementById('table-a')).cursor`) === 'none')

// ── 3. free floor walk, and the bar wrapper must not swallow it ──
await realClick(300, 500)
s = await readState()
rec('3. floor click moves her there (centre coords)', s.px === 300 && s.py === 500, `playerPos=(${s.px},${s.py})`)
rec('3. full-scene #bar wrapper did NOT hijack the click', s.px !== 752 && s.py !== 450, `playerPos=(${s.px},${s.py})`)
rec('3. vignette overlay does not block clicks', s.px === 300, `playerPos=(${s.px},${s.py})`)
rec('3. player--moving applied during walk', s.movingClass === true, `movingClass=${s.movingClass}`)
await sleep(1200)
s = await readState()
rec('3. player--moving cleared on arrival', s.movingClass === false && s.isMoving === false, `moving=${s.movingClass} isMoving=${s.isMoving}`)

// ── 4. duration scales with distance ──
const durFor = async (x, y) => { await realClick(x, y); return parseInt((await readState()).duration, 10) }
const d1 = await durFor(330, 500)          // ~30px  -> clamps to MIN 200
const d2 = await durFor(500, 500)          // ~170px -> ~306ms
const d3 = await durFor(860, 120)          // ~520px -> clamps to MAX 900
const dist = (a, b, c, d) => Math.round(Math.hypot(c - a, d - b))
rec('4. short step clamps to 200ms minimum', d1 === 200, `30px -> ${d1}ms`)
rec('4. mid walk is proportional (~1.8ms/px)', d2 === Math.max(200, Math.min(900, dist(330, 500, 500, 500) * 1.8)), `170px -> ${d2}ms`)
rec('4. long walk clamps to 900ms maximum', d3 === 900, `~520px -> ${d3}ms`)
rec('4. near < mid < far', d1 < d2 && d2 < d3, `${d1} < ${d2} < ${d3}`)
await sleep(1200)

// ── 5. blocked zones and bounds are ignored ──
const assertNoMove = async (label, x, y) => {
  const before = await readState()
  await realClick(x, y)
  await sleep(120)
  const after = await readState()
  rec(`5. ignored: ${label}`, before.px === after.px && before.py === after.py,
    `(${before.px},${before.py}) -> (${after.px},${after.py})`)
}
await assertNoMove('Our Table is solid', 178, 416)
await assertNoMove('unclickable table is solid', 120, 556)
await assertNoMove('bartender standing behind the bar', 890, 450)
await assertNoMove('behind the bar is solid', 890, 500)
await assertNoMove('outside left wall', 10, 300)
await assertNoMove('outside top wall', 400, 20)
await assertNoMove('outside bottom wall', 400, 615)

// Table A and the bar counter are ALSO solid, but they are interactable, so a
// click on them must walk her to the approach point rather than be ignored.
for (const [id, [ax, ay]] of [['table-a', APPROACH['table-a']], ['bar', APPROACH['bar']]]) {
  const before = await readState()
  await realClick(...HIT[id])
  await sleep(150)
  const after = await readState()
  rec(`5. solid-but-interactable ${id} walks to approach, is not ignored`,
    !(before.px === after.px && before.py === after.py) && after.px === ax && after.py === ay,
    `(${before.px},${before.py}) -> (${after.px},${after.py}) want (${ax},${ay})`)
  await sleep(1200)
}

// click outside the scene entirely (page body)
{
  const before = await readState()
  const r = await evaluate(`(() => { const b = document.querySelector('.scene').getBoundingClientRect(); return { x: b.left - 25, y: b.top + 300 } })()`)
  await mouse('mouseMoved', r.x, r.y); await sleep(20)
  await mouse('mousePressed', r.x, r.y, 'left', 1); await mouse('mouseReleased', r.x, r.y, 'left', 1)
  await sleep(150)
  const after = await readState()
  rec('5. click outside the scene does nothing', before.px === after.px && before.py === after.py,
    `(${before.px},${before.py}) -> (${after.px},${after.py})`)
}

// ── 6. interactables walk to their approach point ──
// (arrival no longer logs — Phase 3 replaced that console.log with
//  openDialogue(), which test/phase3-dialogue.test.mjs covers)
for (const [id, [ax, ay]] of Object.entries(APPROACH)) {
  const [hx, hy] = HIT[id]
  await realClick(hx, hy)
  const mid = await readState()
  rec(`6. ${id}: real click reaches approach (${ax},${ay})`,
    mid.px === ax && mid.py === ay, `playerPos=(${mid.px},${mid.py})`)
  await sleep(1300)
  // the approach point must itself be walkable, else she can never arrive
  rec(`6. ${id}: approach point is walkable`,
    await evaluate(`isWalkable(${ax}, ${ay})`) === true)
  // and she must not be standing on top of the thing she approached
  rec(`6. ${id}: stops off to the side, not on top`,
    await evaluate(`!BLOCKED.some(z => ${ax} >= z.x && ${ax} <= z.x + z.w && ${ay} >= z.y && ${ay} <= z.y + z.h)`) === true)
}

// ── 7. hover styling ──
// section 6 ends with a panel open (the locked-door beat); it would cover the bar
await evaluate(`closeDialogue()`); await sleep(400)
const hoverOf = async (x, y) => {
  const { cx, cy } = await clientFor(x, y)
  await mouse('mouseMoved', cx, cy)
  await sleep(320)
}
await hoverOf(572, 176)
let hov = await evaluate(`(() => {
  const el = document.getElementById('table-a')
  const a = getComputedStyle(el, '::after')
  return { ring: a.borderTopColor, w: a.borderTopWidth, table: getComputedStyle(el.querySelector('.table')).filter }
})()`)
rec('7. hover shows subtle amber ring on table', hov.ring === 'rgba(244, 168, 67, 0.35)', hov.ring)
rec('7. ring is a 1px hairline, not a bright outline', hov.w === '1px', hov.w)
rec('7. hover brightens the tabletop', hov.table.includes('brightness(1.2)'), hov.table)

await hoverOf(400, 300) // empty floor
hov = await evaluate(`getComputedStyle(document.getElementById('table-a'), '::after').borderTopColor`)
rec('7. ring clears when not hovering', hov === 'rgba(244, 168, 67, 0)', hov)

await hoverOf(826, 450)
hov = await evaluate(`getComputedStyle(document.querySelector('.bar-counter')).filter`)
rec('7. hover brightens the bar counter', hov.includes('brightness(1.2)'), hov)

await hoverOf(82, 26)
hov = await evaluate(`getComputedStyle(document.getElementById('door-wc')).filter`)
rec('7. hover brightens the WC door', hov.includes('brightness(1.15)'), hov)

// the door handle (::after) must survive the interactable ring rule
hov = await evaluate(`(() => { const a = getComputedStyle(document.getElementById('door-wc'), '::after'); return { w: a.width, h: a.height, r: a.borderRadius } })()`)
rec('7. door handle ::after not clobbered by ring rule', hov.w === '4px' && hov.h === '4px' && hov.r === '50%', JSON.stringify(hov))

// ── 8. a click mid-walk supersedes the old one ──
await realClick(...HIT['table-a'])
await sleep(120)
await realClick(...HIT['table-c'])
await sleep(1500)
{
  const p = await evaluate(`({ open: dialogueState.open, npc: dialogueState.currentNpcId })`)
  const fin = await readState()
  // the stale table-a arrival callback must never open its panel
  rec('8. superseded walk does not fire its stale callback',
    p.open === true && p.npc === 'table-c', JSON.stringify(p))
  rec('8. ends at the newest target', fin.px === 400 && fin.py === 488, `playerPos=(${fin.px},${fin.py})`)
  rec('8. movement flag reset after supersede', fin.isMoving === false && fin.movingClass === false, `isMoving=${fin.isMoving}`)
}

// ── 9. she can still reach both halves of the room (half-wall not blocking) ──
await realClick(400, 200)   // upper half
const up = await readState()
await realClick(400, 520)   // lower half
const down = await readState()
rec('9. half-wall does not trap her in one half',
  up.py === 200 && down.py === 520, `upper=${up.py} lower=${down.py}`)

// ── 12. the seated circles show the character portraits ──
{
  const want = {
    'npc-a': 'TableA-Goran.png', 'npc-b': 'TableB-Darko.png', 'npc-c': 'TableC-Simon.png',
    'npc-d': 'TableD-Angel.png', 'bartender': 'Waiter.png',
  }
  for (const [id, file] of Object.entries(want)) {
    let loaded = false
    for (let i = 0; i < 40 && !loaded; i++) {          // ~2MB portraits decode slowly
      loaded = await evaluate(`(() => { const im = document.querySelector('#${id} .npc__portrait')
        return im.complete && im.naturalWidth > 0 })()`)
      if (!loaded) await sleep(250)
    }
    const st = await evaluate(`(() => { const im = document.querySelector('#${id} .npc__portrait')
      const ini = document.querySelector('#${id} .npc__initial')
      return { src: im.getAttribute('src') || '', shown: getComputedStyle(im).display !== 'none',
        letterHidden: getComputedStyle(ini).display === 'none' } })()`)
    rec(`12. ${id} shows its portrait with the letter hidden`,
      loaded && st.src.endsWith(file) && st.shown && st.letterHidden, JSON.stringify(st))
  }
  rec('12. anonymous patrons stay letterless grey circles',
    await evaluate(`document.querySelectorAll('.npc--patron .npc__portrait').length`) === 0)
  rec('12. portraits are cropped to the circle',
    await evaluate(`getComputedStyle(document.querySelector('#npc-a .npc__portrait')).objectFit`) === 'cover')
  rec('12. all five circles received their src once the intro was dismissed',
    await evaluate(`document.querySelectorAll('.npc__portrait[src]').length`) === 5)

  // a missing file must fall back to the letter, not a broken icon
  await evaluate(`(() => { const im = document.querySelector('#npc-a .npc__portrait')
    im.onerror = () => im.removeAttribute('src'); im.src = 'assets/images/nope.png' })()`)
  await sleep(700)
  rec('12. a missing portrait falls back to the letter',
    await evaluate(`getComputedStyle(document.querySelector('#npc-a .npc__initial')).display`) !== 'none')
  await evaluate(`(() => { const im = document.querySelector('#npc-a .npc__portrait'); im.src = im.dataset.portrait })()`)
  await sleep(700)
  rec('12. restoring the src brings the portrait back',
    await evaluate(`getComputedStyle(document.querySelector('#npc-a .npc__initial')).display`) === 'none')
}

// ── 10. no page errors at all ──
{
  const errs = consoleLogs.filter((l) => l.startsWith('PAGE EXCEPTION'))
  rec('10. no uncaught page exceptions', errs.length === 0, JSON.stringify(errs))
}

// ── 11. Phase 1 untouched: structure + no stray inline styles ──
{
  const phase1 = await evaluate(`({
    tables: document.querySelectorAll('.table-group').length,
    ids: ['table-a','table-b','table-c','table-d','table-ours','table-quiet','bar','bartender','door-wc','door-exit'].every(i => !!document.getElementById(i)),
    npcs: document.querySelectorAll('.npc').length,
    vignette: !!document.querySelector('.vignette'),
    separator: !!document.querySelector('.separator'),
    floors: document.querySelectorAll('.floor').length,
    plants: document.querySelectorAll('.plant').length,
    exitComment: document.documentElement.innerHTML.length > 0,
    inlineStyles: [...document.querySelectorAll('.scene *')].filter(e => e.getAttribute('style')).map(e => e.id || e.className),
    scriptCount: document.querySelectorAll('script').length,
    scriptIsLast: (() => { const k = [...document.body.children]; return k.filter(e => e.id === 'item-modal').length === 1 && k[k.length-1].tagName === 'SCRIPT' && document.scripts[document.scripts.length-1].src.endsWith('js/init.js') })(),
    sceneSize: (() => { const s = document.querySelector('.scene'); return s.offsetWidth + 'x' + s.offsetHeight })(),
  })`)
  rec('11. all Phase 1 ids still present', phase1.ids)
  // Phase 1 has 4 named guests + 2 anonymous patrons + the bartender
  rec('11. Phase 1 element counts intact (6 tables, 7 npcs, 2 floors, 2 plants)',
    phase1.tables === 6 && phase1.npcs === 7 && phase1.floors === 2 && phase1.plants === 2,
    JSON.stringify(phase1))
  rec('11. vignette + separator still present', phase1.vignette && phase1.separator)
  rec('11. scene still exactly 960x640', phase1.sceneSize === '960x640', phase1.sceneSize)
  // inline styles are only ever written at runtime by JS: #player (left/top)
  // and #dialogue-avatar (per-NPC colour). The markup itself carries none.
  rec('11. no inline styles in markup (only runtime-written ones present)',
    phase1.inlineStyles.every((id) => ['player', 'dialogue-avatar'].includes(id)),
    JSON.stringify(phase1.inlineStyles))
  rec('11. nine classic scripts, init.js last', phase1.scriptCount === 9 && phase1.scriptIsLast,
    `count=${phase1.scriptCount} last=${phase1.scriptIsLast}`)
}

// ── report ──
const failed = results.filter((r) => !r.pass)
console.log('\n' + results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? '  :: ' + r.info : ''}`).join('\n'))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('\nFailures:')
  failed.forEach((f) => console.log(`  - ${f.name} :: ${f.info}`))
}
console.log('\nConsole output captured from page:')
console.log(consoleLogs.slice(0, 40).map((l) => '  ' + l).join('\n'))

await pageSend('Page.captureScreenshot', { format: 'png' }).then(async (r) => {
  const { writeFileSync } = await import('node:fs')
  writeFileSync('/Users/dario.martinovski/murder-mystery/.qwen/tmp/phase2.png', Buffer.from(r.data, 'base64'))
})

browserWs.close()
chrome.kill()
process.exit(failed.length ? 1 : 0)
