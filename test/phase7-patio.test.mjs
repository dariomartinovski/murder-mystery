// Phase 7 — patio, phone, final reveal. Full end-to-end playthrough with real
// clicks and real typed input; no page-side console shortcuts anywhere.
// Usage: node test/phase7-patio.test.mjs
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const PORT = 9338
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
// click a point in a given scene's local coordinates
const clickIn = async (sceneSel, x, y) => {
  const c = await evaluate(`(() => { const s = document.querySelector(${JSON.stringify(sceneSel)})
    const r = s.getBoundingClientRect()
    return { cx: r.left + s.clientLeft + ${x}, cy: r.top + s.clientTop + ${y} } })()`)
  await clickClient(c.cx, c.cy)
}
// real typing: focus then insert text through the input pipeline
const typeInto = async (sel, text) => {
  await evaluate(`document.querySelector(${JSON.stringify(sel)}).focus()`)
  await pageSend('Input.insertText', { text })
  await sleep(80)
}
const screens = () => evaluate(`(['screen-restaurant','screen-patio','screen-final']
  .map(id => [id, document.getElementById(id).classList.contains('game-screen--active')])
  .filter(([, on]) => on).map(([id]) => id)).join(',')`)
const G = () => evaluate(`JSON.parse(JSON.stringify(G))`)
const pressEscapeOnBody = () => evaluate(
  `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)

// restaurant dialogue helper: open by clicking the table, pick option i
const talkTo = async (hitX, hitY) => { await clickIn('.scene', hitX, hitY); await sleep(1300) }
const pick = async (i) => {
  const c = await evaluate(`(() => { const b = document.querySelectorAll('.dialogue__option')[${i}]
    if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 } })()`)
  if (!c) throw new Error('no dialogue option ' + i)
  await clickClient(c.x, c.y)
  await sleep(700)
}
const closeDialoguePanel = async () => { await pressEscapeOnBody(); await sleep(350) }

// ══════════════════════════════════════════
// 18. FULL END-TO-END RUN — no console, only clicks and typing
// ══════════════════════════════════════════
rec('0. restaurant is the only active screen on load', await screens() === 'screen-restaurant', await screens())
rec('0. item modal was lifted to body so it works on every screen',
  await evaluate(`document.getElementById('item-modal').parentElement === document.body`))

// ── restaurant: collect the note ──
await talkTo(572, 176)                       // Table A
await pick(0)                                // -> a_seen, grants note
await closeDialoguePanel()
rec('E2E. note collected', (await evaluate(`[...inventory]`)).includes('note'), JSON.stringify(await evaluate(`[...inventory]`)))

// ── solve SOS from the inventory ──
await clickSel('[data-item-id="note"]'); await sleep(400)
await typeInto('#puzzle-sos-input', 'SOS')
await clickSel('#puzzle-sos-submit'); await sleep(600)
rec('E2E. SOS solved by typing', (await G()).decodedSOS === true)
// Phase 8: the solve closes the modal itself and plays the sos-beat narration
rec('E2E. sos-beat narration plays after solving', await evaluate(`narrationActive`) === true)
await skipNarration()

// ── Table C for tableCVisited ──
await talkTo(400, 426)
await pick(0); await pick(0)                 // c_nothing -> c_where
await closeDialoguePanel()
rec('E2E. tableCVisited set', (await G()).tableCVisited === true)

// ── Table B now unlocked: get the binary note ──
await talkTo(182, 176)
rec('E2E. Table B opens on b_unlocked after SOS', await evaluate(`dialogueState.currentNodeId`) === 'b_unlocked',
  await evaluate(`dialogueState.currentNodeId`))
await closeDialoguePanel()
rec('E2E. binaryNote collected', (await evaluate(`[...inventory]`)).includes('binaryNote'))

// ── solve binary ──
await clickSel('[data-item-id="binaryNote"]'); await sleep(400)
await typeInto('#puzzle-binary-input', '23')
await clickSel('#puzzle-binary-submit'); await sleep(300)
rec('E2E. binary solved by typing', (await G()).solvedBinary === true)
await pressEscapeOnBody(); await sleep(350)

// ── Table D confirms 23 ──
await talkTo(620, 404)
rec('E2E. Table D opens on d_ready after the binary solve', await evaluate(`dialogueState.currentNodeId`) === 'd_ready')
await pick(0)                                // -> d_number
await closeDialoguePanel()
rec('E2E. tableDConfirmed set', (await G()).tableDConfirmed === true)

// ── waiter gives the hint and reveals the patio ──
await talkTo(826, 450)
rec('E2E. waiter opens on the approach beat with all gates met',
  await evaluate(`dialogueState.currentNodeId`) === 'w_hint', await evaluate(`dialogueState.currentNodeId`))
await pick(1)                                // show him the number -> payoff + unlock
rec('E2E. showing the number unlocks the patio', (await G()).patioUnlocked === true)
await closeDialoguePanel()
const doorState = await evaluate(`(() => { const d = document.getElementById('door-exit')
  return { active: d.classList.contains('door--active'), interactable: d.classList.contains('interactable'),
    tx: d.dataset.targetX, ty: d.dataset.targetY } })()`)
rec('1. exit door is active, interactable and retargeted after the hint',
  doorState.active && doorState.interactable && doorState.tx === '800' && doorState.ty === '110',
  JSON.stringify(doorState))

// ── 15. back door round trip is tested after arriving; first go out ──
await clickSel('#door-exit')
await sleep(1100)                            // walk
await sleep(900)                             // transition
rec('1. clicking the exit door fades to the patio', await screens() === 'screen-patio', await screens())
// Phase 8 replaced the entrance toast with a first-visit narration
rec('1. first visit plays the patio-enter narration',
  await evaluate(`narrationActive`) === true &&
  await evaluate(`document.getElementById('narration-chapter').textContent`) === 'outside')
await skipNarration()
rec('8. G.patioEntered set on first visit', (await G()).patioEntered === true)

// ── 16. inventory synced to the patio ──
rec('16. patio bar mirrors the restaurant bar',
  await evaluate(`document.getElementById('patio-inventory-slots').children.length`) ===
  await evaluate(`document.getElementById('inventory-slots').children.length`) &&
  await evaluate(`[...document.getElementById('patio-inventory-slots').children].map(e => e.dataset.itemId).join(',')`)
    === (await evaluate(`[...inventory]`)).join(','),
  JSON.stringify(await evaluate(`[...document.getElementById('patio-inventory-slots').children].map(e => e.dataset.itemId)`)))

// ── 2. patio player starts by the back door and walks on click ──
rec('2. patio player starts near the back door',
  await evaluate(`patioPlayerPos.x === 100 && patioPlayerPos.y === 340`),
  JSON.stringify(await evaluate(`patioPlayerPos`)))
await clickIn('.patio-scene', 300, 450); await sleep(1000)
rec('2. patio player walks to a clicked floor point',
  await evaluate(`patioPlayerPos.x === 300 && patioPlayerPos.y === 450`),
  JSON.stringify(await evaluate(`patioPlayerPos`)))
await clickIn('.patio-scene', 700, 300); await sleep(300)   // outside xMax 660
rec('2. clicks outside patio bounds are ignored',
  await evaluate(`patioPlayerPos.x === 300 && patioPlayerPos.y === 450`))
await clickIn('.patio-scene', 150, 180); await sleep(300)   // inside table 6 zone
rec('3. clicking occupied table 6 does nothing',
  await evaluate(`patioPlayerPos.x === 300 && patioPlayerPos.y === 450`))
await clickIn('.patio-scene', 590, 180); await sleep(300)   // inside table 8 zone
rec('3. clicking empty table 8 does nothing',
  await evaluate(`patioPlayerPos.x === 300 && patioPlayerPos.y === 450`))

// ── 15. back door returns to the restaurant, and out again ──
await clickSel('#patio-back-door'); await sleep(900)
rec('15. back door returns to the restaurant', await screens() === 'screen-restaurant', await screens())
await clickSel('#door-exit'); await sleep(2000)
rec('15. exit door goes back out to the patio', await screens() === 'screen-patio', await screens())
rec('8. second visit does not replay the narration', await evaluate(`narrationActive`) === false)

// ── 4/5. table 7 opens the phone ──
await clickSel('#patio-table-7'); await sleep(1200)
rec('4. clicking table 7 walks her over and opens the phone',
  await evaluate(`phoneModalOpen`) === true &&
  await evaluate(`patioPlayerPos.x === 520 && patioPlayerPos.y === 320`),
  JSON.stringify(await evaluate(`patioPlayerPos`)))
const phone = await evaluate(`(() => ({
  time: document.getElementById('phone-time').textContent,
  zone: document.querySelector('.phone-zone').textContent,
  apps: [...document.querySelectorAll('.phone-app__label')].map(e => e.textContent),
  locked: [...document.querySelectorAll('.phone-app__icon')].map(e => e.classList.contains('phone-app__icon--locked')),
  cracked: getComputedStyle(document.getElementById('phone-frame'), '::after').transform !== 'none',
}))()`)
rec('5. phone shows Auckland 22:15 and both apps', phone.time === '22:15' && phone.zone === 'Pacific/Auckland' &&
  phone.apps.join(',') === 'note_app,chat_app', JSON.stringify(phone))
rec('5. both apps start locked', phone.locked.every(Boolean), JSON.stringify(phone.locked))
rec('5. cracked-screen detail renders', phone.cracked === true)

// ── 6. receipt added to both bars on opening the phone ──
rec('6. receipt added to inventory on opening the phone', (await evaluate(`[...inventory]`)).includes('receipt'),
  JSON.stringify(await evaluate(`[...inventory]`)))
rec('6. receipt visible in BOTH bars',
  await evaluate(`[...document.getElementById('inventory-slots').children].some(e => e.dataset.itemId === 'receipt')`) &&
  await evaluate(`[...document.getElementById('patio-inventory-slots').children].some(e => e.dataset.itemId === 'receipt')`))

// ── 7/9. locked note_app and gated chat_app ──
await clickSel('#phone-app-notes'); await sleep(200)
rec('7. note_app shows the LOCKED screen before the receipt puzzle',
  /LOCKED/.test(await evaluate(`document.getElementById('phone-screen-content').textContent`)))
await clickSel('#phone-home-btn'); await sleep(200)
await clickSel('#phone-app-chat'); await sleep(300)
rec('9. chat_app before note_app shows a toast and stays on home',
  await evaluate(`phoneScreen`) === 'home' &&
  await evaluate(`document.getElementById('patio-toast').textContent`).then(t => /note_app access required/.test(t)),
  await evaluate(`phoneScreen`))

// ── solve the receipt from the patio bar (item modal must work out here) ──
// the frame covers the backdrop's centre, so click a bare corner of it
await clickIn('.patio-scene', 60, 60); await sleep(400)
rec('7. backdrop closes the phone', await evaluate(`phoneModalOpen`) === false)
await clickSel('#patio-inventory-slots [data-item-id="receipt"]'); await sleep(500)
rec('6. item modal opens from the patio bar (lifted to body)',
  await evaluate(`document.getElementById('item-modal').classList.contains('item-modal--open')`) === true &&
  await evaluate(`getComputedStyle(document.getElementById('item-modal')).opacity`) === '1')
await typeInto('#puzzle-receipt-input', 'ram')
await clickSelInView('#puzzle-receipt-submit'); await sleep(300)
rec('8. receipt puzzle solved from the patio', (await G()).crackedNoteApp === true)
await pressEscapeOnBody(); await sleep(400)

// ── 8. note_app unlocked shows both notes ──
await clickSel('#patio-table-7'); await sleep(1200)
await clickSel('#phone-app-notes'); await sleep(300)
const notes = await evaluate(`document.getElementById('phone-screen-content').textContent`)
rec('8. unlocked note_app shows both notes', /NOTE 1/.test(notes) && /NOTE 2/.test(notes) &&
  /Pacific\/Auckland/.test(notes) && /mk time/.test(notes), notes.slice(0, 120))
let toastText = ''
for (let i = 0; i < 20 && !/time/i.test(toastText); i++) {
  await sleep(200)
  toastText = await evaluate(`document.getElementById('patio-toast').textContent`)
}
rec('8. reading the notes nudges her toward the phone clock', /time/i.test(toastText), toastText)

// ── 10/11/12. PIN keypad ──
await clickSel('#phone-home-btn'); await sleep(200)
await clickSel('#phone-app-chat'); await sleep(300)
rec('10. chat_app now opens the PIN screen', await evaluate(`phoneScreen`) === 'pin', await evaluate(`phoneScreen`))
const tap = async (k) => { await clickSel(`.phone-pin__key[data-key="${k}"]`); await sleep(120) }
await tap('1'); await tap('2')
rec('10. dots fill one per key',
  await evaluate(`document.querySelectorAll('.phone-pin__dot--filled').length`) === 2)
await clickSel('.phone-pin__key--delete'); await sleep(120)
rec('10. backspace removes the last digit',
  await evaluate(`document.querySelectorAll('.phone-pin__dot--filled').length`) === 1)
await tap('9'); await tap('9'); await tap('9')          // completes 1999 -> wrong
await sleep(200)
rec('11. wrong PIN shows feedback',
  /Incorrect PIN/.test(await evaluate(`document.getElementById('pin-feedback').textContent`)))
await sleep(1000)
rec('11. wrong PIN clears the dots after 900ms',
  await evaluate(`document.querySelectorAll('.phone-pin__dot--filled').length`) === 0)
const enterPin = async () => { await tap('1'); await tap('1'); await tap('1'); await tap('5') }
const waitChat = async () => {
  for (let i = 0; i < 12 && await evaluate(`phoneScreen`) !== 'chat'; i++) await sleep(250)
  return evaluate(`phoneScreen`)
}
await enterPin()
let screen = await waitChat()
if (screen !== 'chat') { await enterPin(); screen = await waitChat() }   // one retry for a dropped tap
rec('12. PIN matches the lore: 22:15 Auckland minus 11h is 11:15',
  SRC.includes("pinBuffer === '1115'") &&
  await evaluate(`document.getElementById('phone-time').textContent`) === '22:15')
rec('12. correct PIN 1115 opens the chat app',
  screen === 'chat' && (await G()).crackedChatApp === true, screen)

// ── 13. chat content ──
const chat = await evaluate(`(() => {
  const sb = document.querySelector('.phone-message--sent .phone-message__bubble')
  const rb = document.querySelector('.phone-message--received .phone-message__bubble')
  const cta = document.getElementById('chat-cta')
  return {
    msgs: document.querySelectorAll('.phone-message').length,
    sent: sb ? getComputedStyle(sb).backgroundColor : null,
    recv: rb ? getComputedStyle(rb).backgroundColor : null,
    cta: cta ? cta.textContent.trim() : '',
  }
})()`)
rec('13. three messages with blue sent / grey received bubbles and the CTA',
  chat.msgs === 3 && chat.sent === 'rgb(21, 101, 192)' && chat.recv === 'rgba(255, 255, 255, 0.08)' &&
  /coat rack/.test(chat.cta), JSON.stringify(chat))

// ── 14. final reveal sequence ──
// Phase 8: +800ms reveal beat, +1800ms phone closes, +400ms chat-reveal narration
await sleep(1200)
rec('14. phone still open during the reveal beat', await evaluate(`phoneModalOpen`) === true)
await sleep(2200)
rec('14. phone closes and chat-reveal narration plays',
  await evaluate(`phoneModalOpen`) === false && await evaluate(`narrationActive`) === true,
  `phone=${await evaluate(`phoneModalOpen`)} narr=${await evaluate(`narrationActive`)}`)
rec('14. chat-reveal carries the coat-rack message',
  /coat rack/.test(await evaluate(`NARRATIVES['chat-reveal'].lines.map(l => l.text).join(' ')`)))
await skipNarration()
await sleep(1000)
rec('14. dismissing the reveal shows the final screen', await screens() === 'screen-final', await screens())
const final = await evaluate(`(() => ({
  msg: document.getElementById('final-message').textContent,
  detail: document.querySelector('.final-card__detail').textContent,
}))()`)
rec('14. final card is the quiet landing', /You found him/.test(final.msg), final.msg)
rec('17. location is personalised — no placeholder left',
  !final.detail.includes('_______________') && !SRC.includes('_______________') &&
  /Tomorrow\s*·\s*\d{1,2}:\d{2}\s*·\s*\S+/.test(final.detail),
  final.detail)

// ══════════════════════════════════════════
// source-level: the two replacements + no restructuring
// ══════════════════════════════════════════
rec('R1. revealPatioDoor replaced (clone + patio click handler)',
  /function revealPatioDoor\(\)[\s\S]{0,1400}?replaceWith\(exitDoor\.cloneNode\(true\)\)[\s\S]{0,600}?transitionToPatio\(\)/.test(SRC))
rec('R2. PATIO UNLOCKED console.log is gone', !SRC.includes('PATIO UNLOCKED — Phase 7 shows exit door'))
rec('R. Phase 1-6 internals intact',
  ['const WALKABLE = { xMin: 26, xMax: 908, yMin: 58, yMax: 544 }', 'function isWalkable(x, y)',
   'function renderNode(node, npcId)', 'function addToInventory(itemId)', 'function onSOSSolved()',
   'function showToast(message, duration = 3200)', "document.querySelectorAll('#screen-restaurant .interactable')",
   'const NODES = {'].every((s) => SRC.includes(s)))
rec('R. one script in markup; at runtime only the lifted item modal follows it',
  await evaluate(`document.querySelectorAll('script').length === 9`) &&
  await evaluate(`(() => { const k = [...document.body.children]
    return k.filter(e => e.id === 'item-modal').length === 1 && k[k.length-1].tagName === 'SCRIPT' && document.scripts[document.scripts.length-1].src.endsWith('js/init.js') })()`))
rec('R. three screens exist, restaurant first',
  await evaluate(`[...document.querySelectorAll('.game-screen')].map(e => e.id).join(',')`) ===
  'screen-restaurant,screen-patio,screen-final')

const errs = consoleLogs.filter((l) => l.startsWith('[PAGE EXCEPTION]') || l.startsWith('[error]'))
rec('ERR. no uncaught exceptions or console errors across the whole run', errs.length === 0,
  JSON.stringify(errs.slice(0, 5)))

// helper used above (scroll-then-click for tall modal cards)
async function clickSelInView(sel) {
  await evaluate(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`)
  await sleep(150)
  await clickSel(sel)
}

const shot = await pageSend('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${ROOT}/.qwen/tmp/phase7-final.png`, Buffer.from(shot.data, 'base64'))

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name} :: ${f.info}`)) }

browserWs.close(); chrome.kill()
process.exit(failed.length ? 1 : 0)
