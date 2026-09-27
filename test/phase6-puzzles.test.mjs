// Phase 6 — puzzles. Real clicks against headless Chrome.
// Usage: node test/phase6-puzzles.test.mjs
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const PORT = 9337
const ROOT = '/Users/dario.martinovski/murder-mystery'
const FILE = `file://${ROOT}/index.html`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// source of truth is now spread across index.html + css/ + js/
const SRC = [`${ROOT}/index.html`,
  ...readdirSync(`${ROOT}/css`).sort().map(f => `${ROOT}/css/${f}`),
  ...readdirSync(`${ROOT}/js`).sort().map(f => `${ROOT}/js/${f}`),
].map(p => readFileSync(p, 'utf8')).join('\n')

const results = []
const rec = (name, pass, info = '') => {
  results.push({ name, pass, info: String(info) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${!pass ? '  :: ' + info : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

process.on('unhandledRejection', (e) => {
  const failed = results.filter((r) => !r.pass)
  console.log(`\nHARNESS ERROR: ${e && e.message}`)
  console.log(`${results.length - failed.length}/${results.length} assertions passed before the error`)
  if (failed.length) failed.forEach((f) => console.log(`  FAIL - ${f.name} :: ${f.info}`))
  try { chrome.kill() } catch {}
  process.exit(1)
})

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--window-size=1060,760', '--force-device-scale-factor=1',
  '--allow-file-access-from-files', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
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
    const { res, rej } = waiting.get(m.id); waiting.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  } else if (m.method === 'Runtime.consoleAPICalled') {
    consoleLogs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleLogs.push('[PAGE EXCEPTION] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
  }
}
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++msgId; waiting.set(id, { res, rej })
  browserWs.send(JSON.stringify(sessionId ? { sessionId, id, method, params } : { id, method, params }))
  setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); rej(new Error(`CDP TIMEOUT (12s): ${method}`)) } }, 12000)
})
const { targetId } = await send('Target.createTarget', { url: FILE })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const pageSend = (m, p = {}) => send(m, p, sessionId)
const evaluate = async (expression) => {
  const r = await pageSend('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
await pageSend('Page.enable'); await pageSend('Runtime.enable')
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
  await mouse('mouseMoved', cx, cy); await sleep(25)
  await mouse('mousePressed', cx, cy, 'left', 1); await mouse('mouseReleased', cx, cy, 'left', 1)
}
const centreOf = (sel) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
const clickSel = async (sel) => {
  const c = await centreOf(sel)
  if (!c) throw new Error('selector not found: ' + sel)
  await clickClient(c.x, c.y)
}
// the item card scrolls; a real user would scroll to a control first, and a CDP
// click at unscrolled coordinates lands on whatever is actually there
const clickSelInView = async (sel) => {
  await evaluate(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`)
  await sleep(150)
  await clickSel(sel)
}
const pressEscapeOnBody = () => evaluate(
  `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
const resetG = () => evaluate(`Object.keys(G).forEach(k => { G[k] = false });
  document.querySelectorAll('.npc--hint-pulse').forEach(e => e.classList.remove('npc--hint-pulse'));
  document.getElementById('door-exit').classList.remove('door--active')`)
const clearInv = () => evaluate(`inventory.length = 0; renderInventory()`)
const setType = (sel, v) => evaluate(`document.querySelector(${JSON.stringify(sel)}).value = ${JSON.stringify(v)}`)
const feedback = (id) => evaluate(`(() => { const f = document.getElementById(${JSON.stringify(id)})
  return f ? { text: f.textContent, cls: f.className } : null })()`)
const pulses = () => evaluate(`[...document.querySelectorAll('.npc--hint-pulse')].map(e => e.id || e.className)`)
const toastState = () => evaluate(`(() => { const t = document.getElementById('toast')
  const r = t.getBoundingClientRect(); const s = document.querySelector('.scene').getBoundingClientRect()
  const sc = document.querySelector('.scene')
  return { visible: t.classList.contains('toast--visible'), text: t.textContent,
    opacity: getComputedStyle(t).opacity, z: getComputedStyle(t).zIndex,
    cx: r.left + r.width / 2 - s.left - sc.clientLeft, top: r.top - s.top - sc.clientTop,
    innerW: s.width - 2 * sc.clientLeft } })()`)
const openItem = async (id) => { await evaluate(`openItemModal('${id}')`); await sleep(400) }
const closeItem = async () => { await pressEscapeOnBody(); await sleep(400) }
// click until the expected effect lands — headless input occasionally drops
// a click when it lands mid-innerHTML swap of the option list
const pickUntil = async (sel, probe, budget = 4000) => {
  const t0 = Date.now()
  for (;;) {
    await clickSel(sel)
    for (let i = 0; i < 10; i++) {
      if (await evaluate(probe)) return true
      await sleep(150)
    }
    if (Date.now() - t0 > budget) return false
  }
}
const openNpc = async (id) => { await evaluate(`closeDialogue()`); await sleep(300); await evaluate(`openDialogue('${id}')`); await sleep(950) }

// ══════════════════════════════════════════
// 2. SOS wrong answers first (state stays clean)
// ══════════════════════════════════════════
await resetG(); await clearInv()
await evaluate(`addToInventory('note')`); await sleep(150)
await openItem('note')
await setType('#puzzle-sos-input', '')
await clickSel('#puzzle-sos-submit'); await sleep(200)
let fb = await feedback('puzzle-sos-feedback')
rec('2. empty submit gives the lookup nudge',
  fb.cls === 'puzzle-feedback puzzle-feedback--wrong' && /periodic table/.test(fb.text), JSON.stringify(fb))
await setType('#puzzle-sos-input', 'help')
await clickSel('#puzzle-sos-submit'); await sleep(200)
fb = await feedback('puzzle-sos-feedback')
rec('2. wrong submit gives the atomic-number nudge',
  fb.cls === 'puzzle-feedback puzzle-feedback--wrong' && /atomic number/.test(fb.text), JSON.stringify(fb))
rec('2. wrong submits leave the puzzle unsolved and enabled',
  await evaluate(`G.decodedSOS`) === false &&
  await evaluate(`!document.getElementById('puzzle-sos-input').disabled`))
rec('2. no pulse and no toast from a wrong answer',
  (await pulses()).length === 0 && (await toastState()).visible === false, JSON.stringify(await pulses()))

// ══════════════════════════════════════════
// 1. SOS correct (case-insensitive)
// ══════════════════════════════════════════
await setType('#puzzle-sos-input', 'sos')          // lowercase on purpose
await clickSel('#puzzle-sos-submit'); await sleep(600)
fb = await feedback('puzzle-sos-feedback')
rec('1. "sos" (lowercase) solves it', fb.cls === 'puzzle-feedback puzzle-feedback--correct' &&
  /S — O — S/.test(fb.text), JSON.stringify(fb))
rec('1. input and button disabled once solved',
  await evaluate(`document.getElementById('puzzle-sos-input').disabled && document.getElementById('puzzle-sos-submit').disabled`))
rec('1. G.decodedSOS set', await evaluate(`G.decodedSOS`) === true)
// Phase 8: solving closes the item modal and plays the sos-beat narration;
// the Table B pulse now fires only when she dismisses it.
rec('7. solving closes the item modal',
  await evaluate(`document.getElementById('item-modal').classList.contains('item-modal--open')`) === false)
rec('7. sos-beat narration plays', await evaluate(`narrationActive`) === true)
rec('7. no pulse while the narration is up', (await pulses()).length === 0, JSON.stringify(await pulses()))
await skipNarration()
rec('7. Table B pulses only after dismissal', (await pulses()).join(',') === 'npc-b', JSON.stringify(await pulses()))

// 3. solved state survives close + reopen
await closeItem()
await openItem('note')
fb = await feedback('puzzle-sos-feedback')
rec('3. reopening shows the solved state immediately',
  fb.cls === 'puzzle-feedback puzzle-feedback--correct' && /S — O — S/.test(fb.text), JSON.stringify(fb))
rec('3. reopened inputs are disabled',
  await evaluate(`document.getElementById('puzzle-sos-input').disabled && document.getElementById('puzzle-sos-submit').disabled`))
// a solved puzzle cannot be re-solved into a duplicate toast/pulse
consoleLogs.length = 0
await evaluate(`document.getElementById('puzzle-sos-submit').click()`)
await sleep(200)
rec('3. a disabled submit cannot re-fire the consequence',
  (await pulses()).join(',') === 'npc-b', JSON.stringify(await pulses()))
await closeItem()

// 10. toast fades out after ~3.2s
await sleep(3600)
let t = await toastState()
rec('10. toast fades out after its duration', t.visible === false && t.opacity === '0', JSON.stringify(t))

// toast supersede: a short-lived first toast must not cut a newer one short
await evaluate(`showToast('first', 500)`); await sleep(100)
await evaluate(`showToast('second', 5000)`); await sleep(1000)
t = await toastState()
rec('10. a superseded toast cannot dismiss the newer one early',
  t.visible === true && t.text === 'second', JSON.stringify(t))
await sleep(5200)
rec('10. the newer toast then expires on its own', (await toastState()).visible === false)

// ══════════════════════════════════════════
// 5. binary wrong, then 4. binary correct
// ══════════════════════════════════════════
await evaluate(`addToInventory('binaryNote')`); await sleep(150)
await openItem('binaryNote')
// guard the puzzle's own arithmetic: the four terms on the note must total
// 00010111, otherwise the '23' answer below is unreachable
rec('5. the note\'s column sum totals 00010111 = 23', await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.binary-sum__row')]
    .map(r => ({ op: r.querySelector('.binary-sum__op').textContent.trim(),
                 val: r.querySelector('.binary-sum__val').textContent.trim() }))
    .filter(r => /^[01]+$/.test(r.val))
  let total = 0
  rows.forEach((r, i) => { const n = parseInt(r.val, 2); total += (i === 0 || r.op === '+') ? n : -n })
  return JSON.stringify({ n: rows.length, total, bits: total.toString(2).padStart(8, '0') })
})()`) === '{"n":4,"total":23,"bits":"00010111"}',
  await evaluate(`document.querySelector('.binary-sum').textContent.replace(/\\s+/g, ' ').trim()`))
rec('5. the note hides the total behind a blank answer line',
  await evaluate(`/_{8}/.test(document.querySelector('.binary-sum__row--answer').textContent)`) === true)
await setType('#puzzle-binary-input', '24')
await clickSel('#puzzle-binary-submit'); await sleep(200)
fb = await feedback('puzzle-binary-feedback')
rec('5. wrong binary gives the column-sum nudge',
  fb.cls === 'puzzle-feedback puzzle-feedback--wrong' && /carry when a column reaches two/.test(fb.text), JSON.stringify(fb))
rec('5. wrong binary leaves it unsolved', await evaluate(`G.solvedBinary`) === false)

// she worked the sum but stopped one step short of the decimal answer
await setType('#puzzle-binary-input', '10111')
await clickSel('#puzzle-binary-submit'); await sleep(200)
fb = await feedback('puzzle-binary-feedback')
rec('5. the binary total is recognised but not accepted',
  fb.cls === 'puzzle-feedback puzzle-feedback--wrong' && /convert it to decimal/.test(fb.text) &&
  await evaluate(`G.solvedBinary`) === false, JSON.stringify(fb))

await setType('#puzzle-binary-input', '23')
await clickSel('#puzzle-binary-submit'); await sleep(400)
fb = await feedback('puzzle-binary-feedback')
rec('4. "23" solves the binary puzzle',
  fb.cls === 'puzzle-feedback puzzle-feedback--correct' && /number on the jacket/.test(fb.text), JSON.stringify(fb))
rec('4. G.solvedBinary set', await evaluate(`G.solvedBinary`) === true)
rec('4. Table B pulse removed, Table D and the bartender pulsed',
  (await pulses()).sort().join(',') === 'bartender,npc-d', JSON.stringify(await pulses()))
await sleep(600)   // 50ms reveal delay + 0.3s fade
t = await toastState()
rec('4. toast names the jacket', t.visible === true && /saw that jacket/.test(t.text), JSON.stringify(t))
rec('10. toast sits top-centre above everything',
  Number(t.z) === 300 && Math.abs(t.cx - t.innerW / 2) < 4 && t.top < 40, JSON.stringify(t))
rec('10. toast faded in (opacity 1)', t.opacity === '1', t.opacity)

// 6. binary solved state survives reopen
await closeItem()
await openItem('binaryNote')
fb = await feedback('puzzle-binary-feedback')
rec('6. reopening the binary note shows the solved state',
  fb.cls === 'puzzle-feedback puzzle-feedback--correct' &&
  await evaluate(`document.getElementById('puzzle-binary-input').disabled`), JSON.stringify(fb))
await closeItem()

// ══════════════════════════════════════════
// 7/8. dialogue gates now open
// ══════════════════════════════════════════
// section 4 already proved solvedBinary's effects; drop it here so Table B's
// entry node reflects decodedSOS alone, then restore it for section 8
await evaluate(`G.solvedBinary = false`)
await openNpc('table-b')
rec('7. after decodedSOS, Table B opens on b_unlocked',
  await evaluate(`dialogueState.currentNodeId`) === 'b_unlocked', await evaluate(`dialogueState.currentNodeId`))
await evaluate(`closeDialogue()`)
await evaluate(`G.solvedBinary = true`)

await openNpc('table-d')
rec('8. after solvedBinary, Table D opens on d_ready',
  await evaluate(`dialogueState.currentNodeId`) === 'd_ready', await evaluate(`dialogueState.currentNodeId`))
await pickUntil('.dialogue__option', 'G.tableDConfirmed === true')   // -> d_number
rec('8. confirming sets G.tableDConfirmed',
  await evaluate(`G.tableDConfirmed`) === true &&
  await evaluate(`dialogueState.currentNodeId`) === 'd_number')
await evaluate(`closeDialogue()`)

// ══════════════════════════════════════════
// 9/13. waiter hint clears pulses and reveals the patio
// ══════════════════════════════════════════
await evaluate(`G.tableCVisited = true`)
rec('9. pulses still present just before the waiter hint', (await pulses()).length === 2, JSON.stringify(await pulses()))
await openNpc('bar')
rec('9. all gates met -> the approach beat', await evaluate(`dialogueState.currentNodeId`) === 'w_hint',
  await evaluate(`dialogueState.currentNodeId`))
rec('9. approaching alone leaves the pulses up', (await pulses()).length === 2, JSON.stringify(await pulses()))
await clickSel('.dialogue__option:nth-child(2)'); await sleep(700)   // show him the number
rec('9. the payoff beat removes every pulse', (await pulses()).length === 0, JSON.stringify(await pulses()))
const door = await evaluate(`(() => { const d = document.getElementById('door-exit')
  return { active: d.classList.contains('door--active'), shadow: getComputedStyle(d).boxShadow,
    cue: getComputedStyle(d.querySelector('.door__patio-cue')).display } })()`)
rec('13. exit door gains .door--active', door.active === true, JSON.stringify(door))
rec('13. door carries the amber glow', /244, 168, 67/.test(door.shadow), door.shadow)
rec('13. PATIO cue visible', door.cue === 'block', door.cue)
await evaluate(`closeDialogue()`)

// ══════════════════════════════════════════
// 11/12. receipt — not in gameplay yet, but solvable when opened
// ══════════════════════════════════════════
rec('11. only the Phase 7 phone adds the receipt',
  (SRC.match(/addToInventory\('receipt'\)/g) || []).length === 1)
consoleLogs.length = 0
await openItem('receipt')
rec('11. receipt opens manually without error',
  (await evaluate(`document.getElementById('item-modal').classList.contains('item-modal--open')`)) === true &&
  !consoleLogs.some((l) => l.startsWith('[PAGE EXCEPTION]')), JSON.stringify(consoleLogs))
await setType('#puzzle-receipt-input', 'RAM')          // uppercase on purpose
await clickSelInView('#puzzle-receipt-submit'); await sleep(400)
fb = await feedback('puzzle-receipt-feedback')
rec('11. "RAM" (case-insensitive) solves the receipt puzzle',
  fb.cls === 'puzzle-feedback puzzle-feedback--correct' && /note app unlocks/.test(fb.text), JSON.stringify(fb))
rec('11. G.crackedNoteApp set and Phase 7 log emitted',
  await evaluate(`G.crackedNoteApp`) === true &&
  consoleLogs.some((l) => l.includes('note_app unlocked') && l.includes('Phase 7')), JSON.stringify(consoleLogs))
t = await toastState()
rec('11. toast announces the unlock', t.visible === true && /Two notes inside/.test(t.text), JSON.stringify(t))
await closeItem()
await openItem('receipt')
fb = await feedback('puzzle-receipt-feedback')
rec('12. reopening the receipt shows the solved state',
  fb.cls === 'puzzle-feedback puzzle-feedback--correct' &&
  await evaluate(`document.getElementById('puzzle-receipt-input').disabled`), JSON.stringify(fb))
await closeItem()

// wrong receipt answer nudge (fresh state)
await resetG()
await openItem('receipt')
await setType('#puzzle-receipt-input', 'mar')
await clickSelInView('#puzzle-receipt-submit'); await sleep(200)
fb = await feedback('puzzle-receipt-feedback')
rec('11. wrong receipt answer nudges about the loop bound',
  fb.cls === 'puzzle-feedback puzzle-feedback--wrong' && /tacos >= 0/.test(fb.text), JSON.stringify(fb))
await closeItem()

// ══════════════════════════════════════════
// 14. nothing restructured
// ══════════════════════════════════════════
{
  rec('14. the three Phase 5 placeholder logs are gone',
    !SRC.includes("console.log('SOS puzzle submitted") &&
    !SRC.includes("console.log('Binary puzzle submitted") &&
    !SRC.includes("console.log('Receipt puzzle submitted"))
  rec('14. the three consequence functions exist',
    /function onSOSSolved\(\)/.test(SRC) && /function onBinarySolved\(\)/.test(SRC) && /function onNoteAppUnlocked\(\)/.test(SRC))
  rec('14. w_hint onEnter replaced (cleanup + reveal, single revealPatioDoor call)',
    /G\.waiterHintGiven = true[\s\S]{0,300}?querySelectorAll\('\.npc--hint-pulse'\)[\s\S]{0,200}?revealPatioDoor\(\)/.test(SRC) &&
    (SRC.match(/revealPatioDoor\(\)/g) || []).length === 2)   // definition + one call
  rec('14. Phase 1-5 internals intact',
    ['const WALKABLE = { xMin: 26, xMax: 908, yMin: 58, yMax: 544 }', 'function isWalkable(x, y)',
     'function renderNode(node, npcId)', 'function addToInventory(itemId)', 'function openItemModal(itemId)',
     'function wirePuzzleInputs(itemId)', 'const NODES = {', 'dialogue__options--pending',
     'if (itemModal.classList.contains(\'item-modal--open\')) return'].every((s) => SRC.includes(s)))
  rec('14. nine classic scripts, init.js last',
    await evaluate(`document.querySelectorAll('script').length === 9 &&
      (() => { const k = [...document.body.children]; return k.filter(e => e.id === 'item-modal').length === 1 && k[k.length-1].tagName === 'SCRIPT' && document.scripts[document.scripts.length-1].src.endsWith('js/init.js') })()`))
  rec('14. scene still exactly 960x640',
    await evaluate(`(() => { const s = document.querySelector('.scene'); return s.offsetWidth === 960 && s.offsetHeight === 640 })()`))
  rec('14. scene tail is toast then the sound toggle',
  await evaluate(`(() => { const k = [...document.querySelector('.scene').children]
    return k[k.length-1].id === 'sound-toggle' && k[k.length-2].id === 'toast' })()`))
const errs = consoleLogs.filter((l) => l.startsWith('[PAGE EXCEPTION]') || l.startsWith('[error]'))
rec('ERR. no uncaught exceptions or console errors', errs.length === 0, JSON.stringify(errs.slice(0, 5)))
}

// ── screenshot: solved note with toast visible ──
await resetG()
await evaluate(`addToInventory('note')`)
await sleep(200)
await openItem('note')
await setType('#puzzle-sos-input', 'SOS')
await clickSel('#puzzle-sos-submit')
await sleep(600)
const shot = await pageSend('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${ROOT}/.qwen/tmp/phase6-solved.png`, Buffer.from(shot.data, 'base64'))

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name} :: ${f.info}`)) }

browserWs.close(); chrome.kill()
process.exit(failed.length ? 1 : 0)
