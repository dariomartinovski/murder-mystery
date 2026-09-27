// Phase 3 — dialogue panel. Real mouse/keyboard events against headless Chrome.
// Usage: node test/phase3-dialogue.test.mjs
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const PORT = 9334
const ROOT = '/Users/dario.martinovski/murder-mystery'
const FILE = `file://${ROOT}/index.html`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// source of truth is now spread across index.html + css/ + js/
const SRC = [`${ROOT}/index.html`,
  ...readdirSync(`${ROOT}/css`).sort().map(f => `${ROOT}/css/${f}`),
  ...readdirSync(`${ROOT}/js`).sort().map(f => `${ROOT}/js/${f}`),
].map(p => readFileSync(p, 'utf8')).join('\n')

const results = []
const rec = (name, pass, info = '') => results.push({ name, pass, info: String(info) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1060,760', '--force-device-scale-factor=1',
  '--allow-file-access-from-files', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

let stderrBuf = ''
chrome.stderr.on('data', (d) => { stderrBuf += d.toString() })
const waitForWs = async () => {
  for (let i = 0; i < 100; i++) {
    const m = stderrBuf.match(/DevTools listening on (ws:\/\/\S+)/)
    if (m) return m[1]
    await sleep(100)
  }
  throw new Error('no debug port:\n' + stderrBuf.slice(-2000))
}

const browserWs = new WebSocket(await waitForWs())
await new Promise((res, rej) => { browserWs.onopen = res; browserWs.onerror = rej })

let msgId = 0
const waiting = new Map()
const consoleLogs = []
browserWs.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && waiting.has(m.id)) {
    const { res, rej } = waiting.get(m.id)
    waiting.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  } else if (m.method === 'Runtime.consoleAPICalled') {
    consoleLogs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleLogs.push('[PAGE EXCEPTION] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
  }
}
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++msgId
  waiting.set(id, { res, rej })
  browserWs.send(JSON.stringify(sessionId ? { sessionId, id, method, params } : { id, method, params }))
})

const { targetId } = await send('Target.createTarget', { url: FILE })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const pageSend = (m, p = {}) => send(m, p, sessionId)

const evaluate = async (expression) => {
  const r = await pageSend('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}

await pageSend('Page.enable')
await pageSend('Runtime.enable')
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


// ── helpers ──
const mouse = (type, x, y, button = 'left', clickCount = 0) =>
  pageSend('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: type === 'mousePressed' ? 1 : 0 })

const clickClient = async (cx, cy) => {
  await mouse('mouseMoved', cx, cy); await sleep(30)
  await mouse('mousePressed', cx, cy, 'left', 1)
  await mouse('mouseReleased', cx, cy, 'left', 1)
}

// scene-local (centre coords) -> viewport coords
const centreOf = (sel) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
// poll until the typewriter has reached text matching re (or give up)
const waitText = async (re, ms = 12000) => {
  const t0 = Date.now()
  let t = ''
  for (;;) {
    t = await evaluate(`document.getElementById('dialogue-text').textContent`)
    if (re.test(t) || Date.now() - t0 > ms) return t
    await sleep(200)
  }
}
const clickScene = async (x, y) => {
  const { cx, cy } = await evaluate(`(() => { const s = document.querySelector('.scene'); const r = s.getBoundingClientRect()
    return { cx: r.left + s.clientLeft + ${x}, cy: r.top + s.clientTop + ${y} } })()`)
  await clickClient(cx, cy)
}

// Synthetic keydown on document.body: headless Chrome's real key-input pipeline
// stalls when another CDP call follows a dispatchKeyEvent. The body is what a
// real keypress targets when nothing is focused, so the page's Escape listener
// is exercised identically.
const pressEscape = async () => {
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
  await sleep(80)
}

const panel = () => evaluate(`(() => {
  const p = document.getElementById('dialogue')
  const cs = getComputedStyle(p)
  const mt = new DOMMatrixReadOnly(cs.transform)
  const opts = [...document.querySelectorAll('.dialogue__option')]
  const ocs = getComputedStyle(document.getElementById('dialogue-options'))
  return {
    open: dialogueState.open, npc: dialogueState.currentNpcId, nodeId: dialogueState.currentNodeId,
    hasOpenClass: p.classList.contains('dialogue--open'),
    ariaHidden: p.getAttribute('aria-hidden'),
    tx: mt.m41, transition: cs.transitionProperty + ' ' + cs.transitionDuration,
    pointerEvents: cs.pointerEvents,
    name: document.getElementById('dialogue-npc-name').textContent,
    avatarText: document.getElementById('dialogue-avatar').textContent,
    avatarBg: document.getElementById('dialogue-avatar').style.background,
    text: document.getElementById('dialogue-text').textContent,
    optionTexts: opts.map(o => o.textContent),
    optionsPending: document.getElementById('dialogue-options').classList.contains('dialogue__options--pending'),
    optionsOpacity: ocs.opacity, optionsPointer: ocs.pointerEvents,
    rect: (() => { const r = p.getBoundingClientRect(); const s = document.querySelector('.scene').getBoundingClientRect()
      const sc = document.querySelector('.scene')
      return { leftInScene: r.left - s.left - sc.clientLeft, width: r.width } })(),
  }
})()`)

const playerAt = () => evaluate(`({ x: playerPos.x, y: playerPos.y })`)

// ── content-agnostic helpers ──
// Phase 4 replaced the placeholder greetings with real dialogue trees, so this
// suite reads expected content out of the live NPCS/NODES rather than hardcoding
// it. That keeps these tests aimed at panel MECHANICS across later phases.
const resetG = () => evaluate(`Object.keys(G).forEach(k => { G[k] = false })`)

const entryInfo = (id) => evaluate(`(() => {
  const npc  = NPCS['${id}']
  const nid  = npc.entryNode(G)
  const node = NODES['${id}'][nid]
  return {
    nodeId: nid,
    npcText: node.npcText,
    options: node.options.filter(o => !o.condition || o.condition())
                         .map(o => ({ text: o.text, next: o.next }))
  }
})()`)

// current node + rendered text, read straight from the panel
const node = () => evaluate(`({
  nodeId: dialogueState.currentNodeId,
  npc: dialogueState.currentNpcId,
  text: document.getElementById('dialogue-text').textContent
})`)

const APPROACH = {
  'table-a': [572, 238], 'table-b': [182, 238], 'table-c': [400, 488],
  'table-d': [620, 350], 'bar': [752, 450], 'door-wc': [82, 80], 'door-exit': [856, 80],
}
const HIT = {
  'table-a': [572, 176], 'table-b': [182, 176], 'table-c': [400, 426],
  'table-d': [620, 404], 'bar': [826, 450], 'door-wc': [82, 26], 'door-exit': [856, 26],
}
const EXPECT = {
  'table-a': ['Goran', 'A', 'rgb(107, 123, 94)', 'assets/images/TableA-Goran.png'],
  'table-b': ['Darko', 'B', 'rgb(94, 107, 123)', 'assets/images/TableB-Darko.png'],
  'table-c': ['Simon', 'C', 'rgb(123, 94, 107)', 'assets/images/TableC-Simon.png'],
  'table-d': ['Angel', 'D', 'rgb(123, 107, 94)', 'assets/images/TableD-Angel.png'],
  'bar': ['Marko', 'M', 'rgb(139, 105, 20)', 'assets/images/Waiter.png'],
  'door-wc': ['Toilet', '🚪', 'rgb(58, 58, 58)', null],
}

// ══════════════════════════════════════════
// 0. panel exists, starts closed and off-scene
// ══════════════════════════════════════════
let p = await panel()
rec('0. panel markup present and closed on load', p.open === false && p.hasOpenClass === false && p.ariaHidden === 'true')
rec('0. closed panel is parked off to the right (translateX 100%)', p.tx === 340, `tx=${p.tx}`)
rec('0. closed panel is click-through', p.pointerEvents === 'none', p.pointerEvents)
rec('0. transform transition is 0.3s ease-in-out', /transform/.test(p.transition) && /0\.3s/.test(p.transition), p.transition)
rec('0. no horizontal overflow from the parked panel',
  await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`))

// a click where the closed panel sits must reach the scene, not the panel
await clickScene(880, 200)
rec('0. closed panel does not intercept scene clicks',
  await evaluate(`!document.elementFromPoint(0,0) || true`) === true && (await playerAt()).x === 880,
  JSON.stringify(await playerAt()))
await sleep(1000)

// ══════════════════════════════════════════
// 1. each interactable: walk there, then panel opens
// 3. correct name / initial / avatar colour
// ══════════════════════════════════════════
for (const id of Object.keys(EXPECT)) {
  await evaluate(`closeDialogue()`); await sleep(400)
  await resetG()                       // every NPC starts from a pristine state
  const want = await entryInfo(id)
  await clickScene(...HIT[id])
  await sleep(1400)
  const pos = await playerAt()
  const [ax, ay] = APPROACH[id]
  p = await panel()
  rec(`1. ${id}: arrives at approach then opens panel`,
    pos.x === ax && pos.y === ay && p.open === true && p.hasOpenClass && p.ariaHidden === 'false',
    `pos=(${pos.x},${pos.y}) want (${ax},${ay}) open=${p.open}`)
  const [name, initial, color, portrait] = EXPECT[id]
  const head = await evaluate(`(() => { const a = document.getElementById('dialogue-avatar')
    const img = document.getElementById('dialogue-portrait')
    return { photo: a.classList.contains('dialogue__avatar--photo'),
             src: img.getAttribute('src') || '',
             text: document.getElementById('dialogue-initial').textContent,
             initialHidden: getComputedStyle(document.getElementById('dialogue-initial')).display === 'none',
             portraitShown: getComputedStyle(img).display !== 'none' } })()`)
  if (portrait) {
    rec(`3. ${id}: renamed and portrait shown in the header`,
      p.name === name && head.photo === true && head.src.endsWith(portrait) &&
      head.portraitShown === true && head.initialHidden === true,
      `${p.name} | ${head.src} | photo=${head.photo} | shown=${head.portraitShown} | initialHidden=${head.initialHidden}`)
  } else {
    rec(`3. ${id}: no portrait falls back to the initial`,
      p.name === name && head.photo === false && head.text === initial && head.initialHidden === false,
      `${p.name} | '${head.text}' | initialHidden=${head.initialHidden}`)
  }
  rec(`3. ${id}: avatar colour correct`, p.avatarBg === color, p.avatarBg)
  rec(`3. ${id}: state tracks the npc`, p.npc === id, p.npc)
  rec(`3. ${id}: opens on its state-aware entry node`, p.nodeId === want.nodeId,
    `${p.nodeId} want ${want.nodeId}`)
  // wait proportional to the node length — the typewriter runs at 22ms/char
  await sleep(Math.min(want.npcText.length * 22 + 600, 16000))
  p = await panel()
  rec(`3. ${id}: node text typed out in full`, p.text === want.npcText,
    `got ${p.text.length} chars, want ${want.npcText.length}`)
  rec(`3. ${id}: all visible options rendered`,
    p.optionTexts.length === want.options.length &&
    p.optionTexts.every((t, i) => t === want.options[i].text),
    JSON.stringify(p.optionTexts))
}

// ══════════════════════════════════════════
// 2. slides in smoothly — caught mid-transition
// ══════════════════════════════════════════
await evaluate(`closeDialogue()`); await sleep(500)
const closedTx = (await panel()).tx
await evaluate(`openDialogue('table-b')`)
await sleep(140)
const midTx = (await panel()).tx
await sleep(500)
const openTx = (await panel()).tx
rec('2. panel is mid-slide partway through (no jump)',
  closedTx === 340 && midTx > 5 && midTx < 335 && openTx === 0,
  `closed=${closedTx} mid=${midTx} open=${openTx}`)

// ══════════════════════════════════════════
// 4/5. typewriter pacing, options held back then revealed
// ══════════════════════════════════════════
await evaluate(`closeDialogue()`); await sleep(450)
await resetG()
const wantA = await entryInfo('table-a')
await evaluate(`openDialogue('table-a')`)
const full = wantA.npcText
await sleep(120)
const t1 = (await panel()).text
const pend1 = await panel()
await sleep(160)
const t2 = (await panel()).text
rec('4. text types out character by character',
  t1.length > 0 && t1.length < full.length && t2.length > t1.length,
  `"${t1}"(${t1.length}) -> "${t2}"(${t2.length}) of ${full.length}`)
rec('4. typed text is a clean prefix, never scrambled',
  full.startsWith(t1) && full.startsWith(t2), `"${t1}" / "${t2}"`)
rec('5. options hidden while the greeting is typing',
  pend1.optionsPending === true && pend1.optionsOpacity === '0' && pend1.optionsPointer === 'none',
  `pending=${pend1.optionsPending} opacity=${pend1.optionsOpacity} pointer=${pend1.optionsPointer}`)
await sleep(700)
const rev = await panel()
rec('5. options revealed after ~300ms',
  rev.optionsPending === false && rev.optionsOpacity === '1' && rev.optionTexts.length === wantA.options.length,
  `pending=${rev.optionsPending} opacity=${rev.optionsOpacity} n=${rev.optionTexts.length}`)
rec('5. options are real <button> elements',
  await evaluate(`[...document.querySelectorAll('.dialogue__option')].every(b => b.tagName === 'BUTTON')`))

// options must not be clickable while hidden
await evaluate(`closeDialogue()`); await sleep(450)
await evaluate(`openDialogue('table-a')`)
await sleep(60)
{
  const box = await evaluate(`(() => { const b = document.querySelectorAll('.dialogue__option')[0].getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
  const hit = await evaluate(`(() => { const el = document.elementFromPoint(${box.x}, ${box.y})
    return el ? (el.className || el.tagName) : 'none' })()`)
  rec('5. hidden options are not hit-testable', !/dialogue__option/.test(String(hit)), `elementFromPoint -> ${hit}`)
}

// ══════════════════════════════════════════
// 6. clicking an option advances the node graph (Phase 4)
// ══════════════════════════════════════════
const clickOption = async (i) => {
  const box = await evaluate(`(() => {
    const b = document.querySelectorAll('.dialogue__option')[${i}]
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!box) throw new Error(`no rendered option at index ${i}`)
  await clickClient(box.x, box.y)
}

await evaluate(`closeDialogue()`); await sleep(400)
await resetG()
await evaluate(`openDialogue('table-a')`); await sleep(900)
consoleLogs.length = 0
{
  const seenText = await evaluate(`NODES['table-a']['a_seen'].npcText`)
  await clickOption(0)                       // -> a_seen
  await sleep(700)
  p = await panel()
  rec('6. option with a next advances to that node and stays open',
    p.nodeId === 'a_seen' && p.open === true && p.npc === 'table-a',
    `node=${p.nodeId} open=${p.open}`)
  rec('6. advancing runs the new node onEnter (G.foundNote)',
    await evaluate(`G.foundNote`) === true)
  // Phase 5 replaced the placeholder console.log with a real pickup
  rec('6. onEnter adds the note to the inventory (Phase 5 wiring)',
    await evaluate(`inventory.includes('note')`) === true,
    JSON.stringify(await evaluate(`[...inventory]`)))
  rec('6. new node text begins typing',
    p.text.length > 0 && seenText.startsWith(p.text) && p.text.length < seenText.length,
    `${p.text.length}/${seenText.length}`)
  await sleep(Math.min(seenText.length * 22 + 600, 16000))
  p = await panel()
  rec('6. options re-render for the new node',
    p.optionTexts.length === 2 && p.optionsPending === false, JSON.stringify(p.optionTexts))
  rec('6. new node text completes', p.text === seenText, `${p.text.length}/${seenText.length}`)

  await clickOption(1)                       // next: null -> close
  await sleep(600)
  p = await panel()
  rec('6. next:null option closes the panel',
    p.open === false && p.ariaHidden === 'true' && p.tx === 340, `open=${p.open} tx=${p.tx}`)
  rec('6. close clears node state', p.npc === null && p.nodeId === null,
    JSON.stringify({ npc: p.npc, nodeId: p.nodeId }))
}

// ══════════════════════════════════════════
// 7/8. close button and Escape
// ══════════════════════════════════════════
await evaluate(`openDialogue('bar')`); await sleep(600)
{
  const box = await evaluate(`(() => { const b = document.getElementById('dialogue-close').getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
  await clickClient(box.x, box.y)
  await sleep(500)
  p = await panel()
  rec('7. close button closes the panel', p.open === false && p.tx === 340, `open=${p.open} tx=${p.tx}`)
}
await evaluate(`openDialogue('bar')`); await sleep(600)
await pressEscape(); await sleep(450)
p = await panel()
rec('8. Escape closes the panel', p.open === false && p.ariaHidden === 'true' && p.tx === 340, `open=${p.open}`)
rec('8. Escape clears npc state', p.npc === null && p.nodeId === null, JSON.stringify({ npc: p.npc, nodeId: p.nodeId }))

// ══════════════════════════════════════════
// 9/10. movement locked while open, restored after
// ══════════════════════════════════════════
await evaluate(`openDialogue('table-b')`); await sleep(500)
{
  const before = await playerAt()
  await clickScene(300, 520)          // empty floor, left of the panel
  await sleep(250)
  const after = await playerAt()
  rec('9. floor click while open does not move her',
    before.x === after.x && before.y === after.y, `(${before.x},${before.y}) -> (${after.x},${after.y})`)
  rec('9. that same click closed the panel', (await panel()).open === false)
}
await sleep(500)
{
  await clickScene(300, 520)
  await sleep(200)
  const after = await playerAt()
  rec('10. floor click after closing moves her normally', after.x === 300 && after.y === 520,
    `(${after.x},${after.y})`)
}
await sleep(1100)

// clicking inside the panel must NOT close it
await evaluate(`openDialogue('table-d')`); await sleep(600)
{
  const box = await evaluate(`(() => { const b = document.getElementById('dialogue-bubble').getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + 20 } })()`)
  await clickClient(box.x, box.y)
  await sleep(200)
  rec('10. clicking inside the panel keeps it open', (await panel()).open === true)
}

// ══════════════════════════════════════════
// 11. restaurant stays visible left of the panel
// ══════════════════════════════════════════
{
  const q = await panel()
  rec('11. panel covers only the right 340px', q.rect.width === 340 && q.rect.leftInScene === 602,
    JSON.stringify(q.rect))
  const hits = await evaluate(`(() => {
    const s = document.querySelector('.scene'); const r = s.getBoundingClientRect()
    const at = (x, y) => { const el = document.elementFromPoint(r.left + s.clientLeft + x, r.top + s.clientTop + y)
      return el ? (el.id || el.className) : 'none' }
    return { left: at(200, 300), mid: at(500, 300), underPanel: at(800, 300) }
  })()`)
  rec('11. floor left of the panel is still hit-testable', !/dialogue/.test(String(hits.left)), JSON.stringify(hits))
  rec('11. panel does occlude the right side (it is on top)', /dialogue/.test(String(hits.underPanel)), JSON.stringify(hits))
  rec('11. no full-screen backdrop was added',
    await evaluate(`getComputedStyle(document.getElementById('dialogue')).position === 'absolute' &&
      ![...document.querySelectorAll('.scene > *')].some(e => /overlay|backdrop|scrim/i.test(e.className) && e.className !== 'vignette')`))
}

// ══════════════════════════════════════════
// 12. door-exit — locked before the unlock, a beat not a dead end
// ══════════════════════════════════════════
await evaluate(`closeDialogue()`); await sleep(450)
await resetG()
consoleLogs.length = 0
await clickScene(...HIT['door-exit'])
await sleep(1400)
{
  const pos = await playerAt()
  p = await panel()
  rec('12. door-exit still walks to its approach point', pos.x === 856 && pos.y === 80, JSON.stringify(pos))
  rec('12. pre-unlock she gets the locked-door beat',
    p.open === true && p.nodeId === 'x_locked', `open=${p.open} node=${p.nodeId}`)
  const lockedText = await waitText(/banging/)
  rec('12. the beat names the bolt and the banging',
    /Locked/.test(lockedText) && /bolt/.test(lockedText) && /banging/.test(lockedText), lockedText.slice(0, 120))
  rec('12. no silent-fallback warning any more',
    consoleLogs.filter((l) => l.includes('No dialogue defined for')).length === 0, JSON.stringify(consoleLogs))
  rec('12. the locked door does not transition to the patio',
    await evaluate(`document.getElementById('screen-restaurant').classList.contains('game-screen--active')`) === true)
  await clickOption(0)
  const glassText = await waitText(/Smeared glass/)
  const g = await panel()
  rec('12. looking through the glass reaches x_glass',
    g.nodeId === 'x_glass' && /Smeared glass/.test(glassText), `${g.nodeId} | ${glassText.slice(0, 60)}`)
  await evaluate(`closeDialogue()`); await sleep(400)

  // once the flag flips, the entry node flips too
  await evaluate(`G.patioUnlocked = true`)
  await evaluate(`openDialogue('door-exit')`); await sleep(700)
  rec('12. with patioUnlocked the entry node is x_open',
    await evaluate(`dialogueState.currentNodeId`) === 'x_open', await evaluate(`dialogueState.currentNodeId`))
  rec('12. x_open carries a step-outside action',
    await evaluate(`typeof NODES['door-exit']['x_open'].options[0].action`) === 'function')
  await clickOption(0); await sleep(1800)
  rec('12. stepping outside from x_open transitions to the patio',
    await evaluate(`document.getElementById('screen-patio').classList.contains('game-screen--active')`) === true)
  await evaluate(`transitionToRestaurant()`); await sleep(900)
  if (await evaluate(`narrationActive`)) {
    const c = await centreOf('#narration')
    await clickClient(c.x, c.y); await sleep(250)
    await clickClient(c.x, c.y); await sleep(900)
  }
  await evaluate(`G.patioUnlocked = false; G.patioEntered = false`)
  rec('12. NPCS covers all seven interactables',
    await evaluate(`['table-a','table-b','table-c','table-d','bar','door-wc','door-exit'].every(k => k in NPCS)`))
}

// ══════════════════════════════════════════
// 13. robustness of the timers I own
// ══════════════════════════════════════════
// close mid-typewriter: nothing may keep writing into the hidden panel
await evaluate(`openDialogue('table-a')`); await sleep(150)
await evaluate(`closeDialogue()`)
const atClose = (await panel()).text
await sleep(900)
const later = (await panel()).text
rec('13. closing mid-typewriter stops the interval', atClose === later, `"${atClose}" -> "${later}"`)

// walk straight from one NPC to another: text must not interleave
await evaluate(`closeDialogue()`); await sleep(450)
await resetG()
const wantBar = await entryInfo('bar')
const wantB   = await entryInfo('table-b')
await evaluate(`openDialogue('table-b')`); await sleep(200)
await evaluate(`openDialogue('bar')`);     await sleep(300)
{
  const t = (await panel()).text
  rec('13. switching NPC mid-type starts the new text cleanly',
    t.length > 0 && wantBar.npcText.startsWith(t), `"${t}"`)
  await sleep(wantBar.npcText.length * 22 + 600)
  const done = await panel()
  rec('13. switched text is not contaminated by the previous NPC',
    done.text === wantBar.npcText, `got ${done.text.length} chars, want ${wantBar.npcText.length}`)
  rec('13. header follows the newest NPC', done.name === 'Marko', done.name)
  rec('13. only one typewriter ran (no char doubling)',
    !done.text.includes(wantB.npcText.slice(0, 12)), done.text.slice(0, 60))
}

// reopen after close shows a fresh node, not leftovers
await evaluate(`closeDialogue()`); await sleep(500)
await resetG()
const wantWc = await entryInfo('door-wc')
await evaluate(`openDialogue('door-wc')`)
await sleep(wantWc.npcText.length * 22 + 600)
rec('13. reopening shows a clean node text', (await panel()).text === wantWc.npcText,
  `"${(await panel()).text.slice(0, 60)}"`)

// no timer leak after many open/close cycles
await evaluate(`(async () => { for (let i = 0; i < 12; i++) { openDialogue('table-a'); await new Promise(r => setTimeout(r, 40)); closeDialogue() } })()`)
await sleep(1200)
rec('13. timers quiesce after rapid open/close cycling',
  await evaluate(`typeTimer === null && optionsTimer === null`),
  `typeTimer/optionsTimer not null`)
{
  // the panel keeps whatever few characters landed before the final close;
  // the point is that it stops there instead of continuing to type.
  const cyc = (await panel()).text
  const wantCyc = (await entryInfo('table-a')).npcText
  await sleep(700)
  const cyc2 = (await panel()).text
  rec('13. text frozen after rapid cycling (no orphaned interval)',
    cyc === cyc2 && wantCyc.startsWith(cyc2), `"${cyc}" -> "${cyc2}"`)
  rec('13. panel left closed after rapid cycling', (await panel()).open === false)
}

// ══════════════════════════════════════════
// 14. no page errors
// ══════════════════════════════════════════
rec('14. no uncaught page exceptions',
  consoleLogs.filter((l) => l.startsWith('[PAGE EXCEPTION]')).length === 0,
  JSON.stringify(consoleLogs.filter((l) => l.startsWith('[PAGE EXCEPTION]'))))

// ══════════════════════════════════════════
// 16. portrait lightbox — click to expand, click or Escape to close
// ══════════════════════════════════════════
await evaluate(`closeDialogue()`); await sleep(400)
await resetG()
await clickScene(...HIT['table-a']); await sleep(1400)
rec('16. dialogue open with Goran before expanding',
  await evaluate(`dialogueState.open`) === true &&
  await evaluate(`document.getElementById('dialogue-npc-name').textContent`) === 'Goran')

const avatarC = await centreOf('#dialogue-avatar')
await clickClient(avatarC.x, avatarC.y); await sleep(400)
rec('16. clicking the portrait opens the lightbox',
  await evaluate(`document.getElementById('portrait-lightbox').classList.contains('portrait-lightbox--open')`) === true)
rec('16. lightbox shows the right image and caption',
  await evaluate(`document.getElementById('portrait-lightbox-img').getAttribute('src').endsWith('assets/images/TableA-Goran.png')`) &&
  await evaluate(`document.getElementById('portrait-lightbox-name').textContent`) === 'Goran')
rec('16. lightbox paints above the dialogue panel',
  Number(await evaluate(`getComputedStyle(document.getElementById('portrait-lightbox')).zIndex`)) >
  Number(await evaluate(`getComputedStyle(document.getElementById('dialogue')).zIndex`)))
rec('16. opening the lightbox does not close the dialogue',
  await evaluate(`dialogueState.open`) === true)

// any click inside closes it
const lbC = await centreOf('#portrait-lightbox-backdrop')
await clickClient(lbC.x, lbC.y); await sleep(400)
rec('16. clicking the backdrop closes the lightbox',
  await evaluate(`document.getElementById('portrait-lightbox').classList.contains('portrait-lightbox--open')`) === false)
rec('16. dialogue still open underneath', await evaluate(`dialogueState.open`) === true)

// Escape peels the lightbox only
await clickClient(avatarC.x, avatarC.y); await sleep(400)
await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
await sleep(300)
rec('16. Escape closes the lightbox but not the dialogue',
  await evaluate(`document.getElementById('portrait-lightbox').classList.contains('portrait-lightbox--open')`) === false &&
  await evaluate(`dialogueState.open`) === true)
// and a second Escape then closes the dialogue as usual
await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
await sleep(400)
rec('16. a second Escape closes the dialogue', await evaluate(`dialogueState.open`) === false)

// portraits are fetched lazily, not eagerly on load
rec('16. only talked-to portraits are requested',
  await evaluate(`performance.getEntriesByType('resource').filter(r => r.name.includes('assets/images/')).length`) <= 2,
  JSON.stringify(await evaluate(`performance.getEntriesByType('resource').filter(r => r.name.includes('assets/images/')).map(r => r.name.split('/').pop())`)))

// ══════════════════════════════════════════
// 15. Phase 1 + 2 untouched (source-level and DOM-level)
// ══════════════════════════════════════════
{
  const dom = await evaluate(`({
    tables: document.querySelectorAll('.table-group').length,
    npcs: document.querySelectorAll('.npc').length,
    floors: document.querySelectorAll('.floor').length,
    plants: document.querySelectorAll('.plant').length,
    player: !!document.getElementById('player'),
    ids: ['table-a','table-b','table-c','table-d','table-ours','table-quiet','bar','bartender','door-wc','door-exit','player']
      .every(i => !!document.getElementById(i)),
    sceneSize: (() => { const s = document.querySelector('.scene'); return s.offsetWidth + 'x' + s.offsetHeight })(),
    scriptCount: document.querySelectorAll('script').length,
    scriptIsLast: (() => { const k = [...document.body.children]; return k.filter(e => e.id === 'item-modal').length === 1 && k[k.length-1].tagName === 'SCRIPT' && document.scripts[document.scripts.length-1].src.endsWith('js/init.js') })(),
    // the dialogue panel must come after the vignette; Phase 5 appends the
    // inventory bar and item modal after it
    panelOrder: (() => { const ids = [...document.querySelector('.scene').children].map(e => e.id)
      return { afterVignette: ids.indexOf('dialogue') > ids.indexOf(''),
               order: ids.slice(-2).join(',') } })(),
  })`)
  rec('15. Phase 1 element counts intact', dom.tables === 6 && dom.npcs === 7 && dom.floors === 2 && dom.plants === 2, JSON.stringify(dom))
  rec('15. Phase 1+2 ids all present', dom.ids)
  rec('15. scene still exactly 960x640', dom.sceneSize === '960x640', dom.sceneSize)
  rec('15. nine classic scripts, init.js last', dom.scriptCount === 9 && dom.scriptIsLast)
  rec('15. scene tail is inventory then toast (item modal lifted to body in Phase 7)',
    dom.panelOrder.order === 'toast,sound-toggle', dom.panelOrder.order)

  // source-level: only the one sanctioned Phase 2 line changed
  rec('15. Phase 2 arrival log replaced by openDialogue(el.id)',
    /moveTo\(targetX, targetY, \(\) => \{[\s\S]{0,200}?openDialogue\(el\.id\)/.test(SRC))
  rec('15. no leftover "Arrived at:" log in source', !SRC.includes("console.log('Arrived at:'"))
  rec('15. floor-click guards added ahead of the interactable guard',
    /if \(dialogueState\.open\) return[\s\S]{0,400}?if \(e\.target\.closest\('\.interactable'\)\) return/.test(SRC) &&
    /if \(itemModal\.classList\.contains\('item-modal--open'\)\) return[\s\S]{0,300}?if \(e\.target\.closest\('\.interactable'\)\) return/.test(SRC))
  rec('15. Phase 2 movement internals untouched',
    ['const WALKABLE = { xMin: 26, xMax: 908, yMin: 58, yMax: 544 }',
     'function isWalkable(x, y)', 'function scenePoint(e)', 'function renderPlayer()',
     'let playerPos = { x: 178, y: 354 }'].every((s) => SRC.includes(s)))
  rec('15. Phase 1 CSS palette untouched', SRC.includes('--floor-dark: #2C1810;') && SRC.includes('--amber: #F4A843;'))

  // the placeholder marker moves on each phase: Phase 4's handleOption note is
  // gone (replaced), Phase 5's puzzle wiring now carries the forward marker
  rec('15. Phase 4 handleOption placeholder fully replaced',
    !/PHASE 4 REPLACES THIS LOGIC/.test(SRC) && /function handleOption\(option\)/.test(SRC))
  // the placeholder marker moves on each phase: Phase 6 replaced all three
  // submit placeholders with real answer logic
  rec('15. Phase 6 replaced all three puzzle placeholders',
    (SRC.match(/Phase 6 replaces this handler entirely/g) || []).length === 0 &&
    /function onSOSSolved\(\)/.test(SRC) && /function onBinarySolved\(\)/.test(SRC) &&
    /function onNoteAppUnlocked\(\)/.test(SRC))
}

// ── report ──
await evaluate(`openDialogue('bar')`)
await sleep(900)
const shot = await pageSend('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${ROOT}/.qwen/tmp/phase3-panel-open.png`, Buffer.from(shot.data, 'base64'))

const failed = results.filter((r) => !r.pass)
console.log('\n' + results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${!r.pass ? '  :: ' + r.info : ''}`).join('\n'))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name} :: ${f.info}`)) }
console.log('\nPage console:')
console.log(consoleLogs.slice(0, 30).map((l) => '  ' + l).join('\n'))

browserWs.close()
chrome.kill()
process.exit(failed.length ? 1 : 0)
