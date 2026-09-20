// Phase 5 — inventory + item modal. Real clicks against headless Chrome.
// Usage: node test/phase5-inventory.test.mjs
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const PORT = 9336
const ROOT = '/Users/dario.martinovski/murder-mystery'
const FILE = `file://${ROOT}/index.html`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SRC = readFileSync(`${ROOT}/index.html`, 'utf8')

const results = []
const rec = (name, pass, info = '') => {
  results.push({ name, pass, info: String(info) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${!pass ? '  :: ' + info : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// never die silently: dump what passed and what killed the run
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
  // watchdog: a stalled renderer must produce a named failure, not a silent hang
  setTimeout(() => {
    if (waiting.has(id)) { waiting.delete(id); rej(new Error(`CDP TIMEOUT (12s): ${method}`)) }
  }, 12000)
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
const hoverSel = async (sel) => {
  const c = await centreOf(sel)
  await mouse('mouseMoved', c.x, c.y)
  await sleep(300)
}
const pressEscape = async () => {
  const k = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }
  await pageSend('Input.dispatchKeyEvent', { type: 'keyDown', ...k })
  await pageSend('Input.dispatchKeyEvent', { type: 'keyUp', ...k })
  await sleep(120)
}
// Headless Chrome's real key-input pipeline stalls here if another CDP call
// follows a dispatchKeyEvent. A KeyboardEvent on document.body targets the same
// node a real keypress would when nothing is focused, so the capture/bubble
// ordering under test is exercised identically. Section 10 keeps one real
// dispatchKeyEvent to prove the genuine key path works.
const pressEscapeOnBody = () => evaluate(
  `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
const clickScene = async (x, y) => {
  const { cx, cy } = await evaluate(`(() => { const s = document.querySelector('.scene'); const r = s.getBoundingClientRect()
    return { cx: r.left + s.clientLeft + ${x}, cy: r.top + s.clientTop + ${y} } })()`)
  await clickClient(cx, cy)
}
const state = () => evaluate(`(() => {
  const bar = document.getElementById('inventory')
  const br = bar.getBoundingClientRect()
  const sr = document.querySelector('.scene').getBoundingClientRect()
  const sc = document.querySelector('.scene')
  const modal = document.getElementById('item-modal')
  return {
    inventory: [...inventory],
    slots: [...document.querySelectorAll('#inventory-slots .inventory__item')].map(s => ({
      id: s.dataset.itemId, icon: s.textContent, label: s.dataset.label,
      isNew: s.classList.contains('inventory__item--new'),
      aria: s.getAttribute('aria-label'), role: s.getAttribute('role') })),
    barRect: { topInScene: br.top - sr.top - sc.clientTop, height: br.height, width: br.width },
    barZ: getComputedStyle(bar).zIndex,
    modalOpen: modal.classList.contains('item-modal--open'),
    modalAria: modal.getAttribute('aria-hidden'),
    modalZ: getComputedStyle(modal).zIndex,
    modalTitle: document.getElementById('item-modal-title').textContent,
    modalHTML: document.getElementById('item-modal-content').innerHTML,
    dialogueOpen: dialogueState.open,
    player: { x: playerPos.x, y: playerPos.y },
    G: JSON.parse(JSON.stringify(G)),
  }
})()`)
const resetG = () => evaluate(`Object.keys(G).forEach(k => { G[k] = false })`)
const clearInv = () => evaluate(`inventory.length = 0; renderInventory()`)
const clickOption = async (i) => {
  const c = await evaluate(`(() => { const b = document.querySelectorAll('.dialogue__option')[${i}]
    if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 } })()`)
  if (!c) throw new Error('no option ' + i)
  await clickClient(c.x, c.y)
  await sleep(700)
}

// ══════════════════════════════════════════
// 1. bar visible at the bottom, empty on load
// ══════════════════════════════════════════
let s = await state()
rec('1. inventory bar present and pinned to the scene bottom',
  s.barRect.height === 64 && s.barRect.width === 942 && s.barRect.topInScene === 622 - 64,
  JSON.stringify(s.barRect))
rec('1. bar sits above the vignette', Number(s.barZ) === 80, s.barZ)
rec('1. empty on load', s.inventory.length === 0 && s.slots.length === 0, JSON.stringify(s.slots))
rec('1. ITEMS defines all three items up front',
  await evaluate(`['note','binaryNote','receipt'].every(k => k in ITEMS && ITEMS[k].icon && ITEMS[k].label)`))

// ══════════════════════════════════════════
// 2/3. Table A pickup -> slot appears with pop-in, tooltip on hover
// ══════════════════════════════════════════
await resetG(); await clearInv()
await evaluate(`openDialogue('table-a')`); await sleep(800)
{
  // click the option that grants the note, then poll inside the 0.5s
  // animation window — checking after it ends would only ever see the
  // class already removed by animationend.
  const c = await evaluate(`(() => { const b = document.querySelectorAll('.dialogue__option')[0]
    const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await clickClient(c.x, c.y)
  let sawNew = false
  for (let i = 0; i < 14 && !sawNew; i++) {
    await sleep(50)
    sawNew = await evaluate(`!!document.querySelector('.inventory__item--new')`)
  }
  rec('2. pop-in class applied on arrival', sawNew === true)
  await sleep(800)
}
s = await state()
rec('2. note lands in inventory via the dialogue onEnter',
  s.inventory.length === 1 && s.inventory[0] === 'note', JSON.stringify(s.inventory))
rec('2. slot shows the 📄 icon with label + a11y attrs',
  s.slots[0].icon === '📄' && s.slots[0].label === 'Folded Note' &&
  s.slots[0].role === 'button' && s.slots[0].aria === 'Examine Folded Note', JSON.stringify(s.slots[0]))
await sleep(900)
s = await state()
rec('2. pop-in class clears after the animation', s.slots[0].isNew === false, JSON.stringify(s.slots[0].isNew))

await hoverSel('.inventory__item')
const tip = await evaluate(`(() => {
  const el = document.querySelector('.inventory__item')
  const a = getComputedStyle(el, '::after')
  return { opacity: a.opacity, content: a.content }
})()`)
rec('3. hover reveals the tooltip with the item label',
  tip.opacity === '1' && /Folded Note/.test(tip.content), JSON.stringify(tip))
await mouse('mouseMoved', 300, 300); await sleep(300)
const tipOff = await evaluate(`getComputedStyle(document.querySelector('.inventory__item'), '::after').opacity`)
rec('3. tooltip hides when not hovering', tipOff === '0', tipOff)

// ══════════════════════════════════════════
// 4/5/6. modal opens with title + note front
// ══════════════════════════════════════════
await clickSel('.inventory__item')
await sleep(500)
s = await state()
rec('4. clicking the slot opens the modal with the right title',
  s.modalOpen === true && s.modalAria === 'false' && s.modalTitle === 'Folded Note',
  `open=${s.modalOpen} title="${s.modalTitle}"`)
rec('4. modal is the topmost layer', Number(s.modalZ) === 200, s.modalZ)
rec('4. card pop-in animation is live while open',
  await evaluate(`getComputedStyle(document.getElementById('item-modal-card')).animationName`) === 'modalIn')
rec('5. front shows 16 — 8 — 16', /16 — 8 — 16/.test(s.modalHTML.replace(/&mdash;/g, '—')), '')
rec('5. front shows the signature — D', /— D/.test(s.modalHTML), '')
rec('5. back is hidden until flipped',
  await evaluate(`getComputedStyle(document.getElementById('note-back')).display`) === 'none')
rec('6. SOS input and Decode button present and visible',
  await evaluate(`(() => {
    const i = document.getElementById('puzzle-sos-input'), b = document.getElementById('puzzle-sos-submit')
    const iv = i && getComputedStyle(i), bv = b && getComputedStyle(b)
    return !!i && !!b && iv.display !== 'none' && bv.display !== 'none' && b.textContent.trim() === 'Decode'
  })()`))

// ══════════════════════════════════════════
// 7. submitting handles input without crashing
// (Phase 6 owns correct-solve coverage; here we use a WRONG answer so this
//  suite never mutates puzzle state, and assert the nudge path responds.)
// ══════════════════════════════════════════
consoleLogs.length = 0
await evaluate(`document.getElementById('puzzle-sos-input').value = 'help'`)
await clickSel('#puzzle-sos-submit')
await sleep(300)
rec('7. a wrong submit answers with a nudge and does not crash',
  await evaluate(`document.getElementById('puzzle-sos-feedback').className`) === 'puzzle-feedback puzzle-feedback--wrong' &&
  !consoleLogs.some((l) => l.startsWith('[PAGE EXCEPTION]')), JSON.stringify(consoleLogs))
rec('7. a wrong submit does not solve the puzzle',
  await evaluate(`G.decodedSOS`) === false &&
  await evaluate(`!document.getElementById('puzzle-sos-input').disabled`))
rec('7. modal still open after a submit', (await state()).modalOpen === true)
// Enter in the input also submits
consoleLogs.length = 0
await evaluate(`(() => { const i = document.getElementById('puzzle-sos-input')
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`)
await sleep(200)
rec('7. Enter in the input triggers submit',
  await evaluate(`document.getElementById('puzzle-sos-feedback').textContent.length`) > 0,
  JSON.stringify(consoleLogs))

// ══════════════════════════════════════════
// 8/9. flip mechanic
// ══════════════════════════════════════════
await clickSel('#note-flip-btn')
await sleep(200)
s = await state()
rec('8. "Turn over" reveals the back',
  await evaluate(`getComputedStyle(document.getElementById('note-back')).display`) === 'block')
rec('8. back carries the periodic-table grid', /He/.test(s.modalHTML) && /Ar/.test(s.modalHTML) &&
  await evaluate(`document.querySelectorAll('#note-back div[style*="border:1px"]').length`) >= 18)
rec('8. back carries the T7 pattern', /k9m2r5t7x1p4w8n3q6b4/.test(s.modalHTML) && /w8t7p4n1x5m3k7r2t7h4/.test(s.modalHTML))
rec('8. flip button label swapped', (await centreOf('#note-flip-btn')) !== null &&
  await evaluate(`document.getElementById('note-flip-btn').textContent.includes('Turn back')`))
await clickSel('#note-flip-btn')
await sleep(200)
rec('9. "Turn back" hides the back again',
  await evaluate(`getComputedStyle(document.getElementById('note-back')).display`) === 'none')
rec('9. flip button label restored',
  await evaluate(`document.getElementById('note-flip-btn').textContent.includes('Turn over')`))

// ══════════════════════════════════════════
// 10. three ways to close
// ══════════════════════════════════════════
await clickSel('#item-modal-close'); await sleep(400)
rec('10. close button closes the modal', (await state()).modalOpen === false)
await clickSel('.inventory__item'); await sleep(400)
// the card covers the backdrop's centre, so click a corner that is bare backdrop
await clickScene(60, 60); await sleep(400)
rec('10. backdrop click closes the modal', (await state()).modalOpen === false)
await clickSel('.inventory__item'); await sleep(400)
await pressEscape(); await sleep(400)
rec('10. Escape closes the modal', (await state()).modalOpen === false)

// Escape layering: modal over dialogue peels one layer at a time
await resetG()
await evaluate(`openDialogue('table-a')`); await sleep(600)
await clickSel('.inventory__item'); await sleep(400)
s = await state()
rec('16. modal and dialogue coexist', s.modalOpen === true && s.dialogueOpen === true,
  `modal=${s.modalOpen} dialogue=${s.dialogueOpen}`)
rec('16. modal paints above the dialogue panel', Number(s.modalZ) > 100, `${s.modalZ} vs 100`)
rec('16. hit-testing at centre lands in the modal',
  await evaluate(`(() => { const r = document.getElementById('item-modal-card').getBoundingClientRect()
    return document.elementFromPoint(r.left + r.width/2, r.top + 20).closest('#item-modal') !== null })()`))
await pressEscapeOnBody(); await sleep(300)
s = await state()
rec('16. first Escape closes only the modal', s.modalOpen === false && s.dialogueOpen === true,
  `modal=${s.modalOpen} dialogue=${s.dialogueOpen}`)
await pressEscapeOnBody(); await sleep(300)
s = await state()
rec('16. second Escape then closes the dialogue', s.modalOpen === false && s.dialogueOpen === false,
  `modal=${s.modalOpen} dialogue=${s.dialogueOpen}`)

// ══════════════════════════════════════════
// 15. floor clicks are inert while the modal is open
// ══════════════════════════════════════════
await evaluate(`closeDialogue()`)
await clickSel('.inventory__item'); await sleep(400)
{
  const before = (await state()).player
  await clickScene(300, 300)
  await sleep(250)
  const after = (await state()).player
  rec('15. floor click while modal open does not move her',
    before.x === after.x && before.y === after.y, `(${before.x},${before.y}) -> (${after.x},${after.y})`)
  rec('15. that click did not close the modal either', (await state()).modalOpen === true)
}
await pressEscapeOnBody(); await sleep(400)
{
  await clickScene(300, 300); await sleep(200)
  const after = (await state()).player
  rec('15. floor click works again once closed', after.x === 300 && after.y === 300, JSON.stringify(after))
}
await sleep(900)

// she must never be able to walk behind the permanent bar
{
  await clickScene(400, 590); await sleep(200)
  const blocked = (await state()).player
  rec('15. she cannot walk behind the inventory bar',
    blocked.y !== 590 && await evaluate(`!isWalkable(400, 590) && isWalkable(400, 540)`),
    JSON.stringify(blocked))
}

// ══════════════════════════════════════════
// 11/12/13. binary note
// ══════════════════════════════════════════
await resetG(); await clearInv()
await evaluate(`Object.assign(G, { decodedSOS: true })`)
consoleLogs.length = 0
await evaluate(`openDialogue('table-b')`); await sleep(900)
s = await state()
rec('11. b_unlocked onEnter adds the binary note',
  s.inventory.includes('binaryNote'), JSON.stringify(s.inventory))
rec('11. no inventory log left behind (placeholder replaced)',
  !consoleLogs.some((l) => l.includes('INVENTORY:')), JSON.stringify(consoleLogs))
rec('11. two slots now, in pickup order',
  s.slots.length === 1 && s.slots[0].id === 'binaryNote', JSON.stringify(s.slots.map(x => x.id)))

// note first, then binary — order preserved across pickups
await evaluate(`addToInventory('note')`); await sleep(100)
s = await state()
rec('11. pickup order preserved', s.slots.map(x => x.id).join(',') === 'binaryNote,note',
  s.slots.map(x => x.id).join(','))

await evaluate(`openItemModal('binaryNote')`); await sleep(400)
s = await state()
rec('12. binary modal title is Torn Paper', s.modalTitle === 'Torn Paper', s.modalTitle)
rec('12. shows the 8-bit sequence', /0 0 0 1 0 1 1 1/.test(s.modalHTML), '')
rec('12. has its own submit input',
  await evaluate(`!!document.getElementById('puzzle-binary-input') && !!document.getElementById('puzzle-binary-submit')`))
consoleLogs.length = 0
// wrong answer on purpose: Phase 6 owns correct-solve coverage, and solving
// here would leak G.solvedBinary + hint pulses into the rest of this suite
await evaluate(`document.getElementById('puzzle-binary-input').value = '99'`)
await clickSel('#puzzle-binary-submit'); await sleep(300)
rec('13. binary Submit answers a wrong guess with a nudge, no crash',
  await evaluate(`document.getElementById('puzzle-binary-feedback').className`) === 'puzzle-feedback puzzle-feedback--wrong' &&
  await evaluate(`G.solvedBinary`) === false &&
  !consoleLogs.some((l) => l.startsWith('[PAGE EXCEPTION]')), JSON.stringify(consoleLogs))
await pressEscapeOnBody(); await sleep(300)

// switching items re-renders content cleanly (no stale ids)
await evaluate(`openItemModal('note')`); await sleep(300)
rec('13. switching items swaps content ids cleanly',
  await evaluate(`!!document.getElementById('puzzle-sos-input') && !document.getElementById('puzzle-binary-input')`))
await pressEscapeOnBody(); await sleep(300)

// ══════════════════════════════════════════
// 14. receipt defined but not addable; unknown ids are safe
// ══════════════════════════════════════════
rec('14. receipt is defined with a builder',
  await evaluate(`'receipt' in ITEMS && typeof buildReceipt === 'function'`))
rec('14. only the Phase 7 phone adds the receipt, from openPhoneModal',
  (SRC.match(/addToInventory\('receipt'\)/g) || []).length === 1 &&
  /function openPhoneModal\(\)[\s\S]{0,300}?addToInventory\('receipt'\)/.test(SRC))
consoleLogs.length = 0
await evaluate(`openItemModal('receipt')`); await sleep(300)
s = await state()
rec('14. opening the receipt directly renders without error',
  s.modalOpen === true && /AMIGOS RESTAURANT/.test(s.modalHTML) && /430den/.test(s.modalHTML), '')
consoleLogs.length = 0
await evaluate(`addToInventory('receipt')`); await sleep(150)
rec('14. receipt can be added without error when asked',
  (await state()).inventory.includes('receipt') &&
  !consoleLogs.some((l) => l.startsWith('[PAGE EXCEPTION]')), JSON.stringify(consoleLogs))
await pressEscapeOnBody(); await sleep(200)
consoleLogs.length = 0
await evaluate(`addToInventory('doesNotExist')`); await sleep(150)
rec('14. unknown item id warns and does not crash',
  consoleLogs.some((l) => l.includes('Unknown item')) &&
  !consoleLogs.some((l) => l.startsWith('[PAGE EXCEPTION]')), JSON.stringify(consoleLogs))
await clearInv()

// duplicates never stack
await evaluate(`addToInventory('note'); addToInventory('note'); addToInventory('note')`); await sleep(150)
rec('14. duplicate adds collapse to one slot', (await state()).slots.length === 1,
  JSON.stringify((await state()).slots.map(x => x.id)))
await clearInv()

// ══════════════════════════════════════════
// 17. nothing restructured
// ══════════════════════════════════════════
{
  rec('17. the two Phase 4 placeholders are gone',
    !SRC.includes("console.log('INVENTORY: note added") && !SRC.includes("console.log('INVENTORY: binaryNote added"),
    'placeholder console.log still present')
  rec('17. both onEnter hooks call addToInventory',
    /G\.foundNote = true\s+addToInventory\('note'\)/.test(SRC) && /addToInventory\('binaryNote'\)/.test(SRC))
  rec('17. Phase 1-4 internals intact',
    ['--floor-dark: #2C1810;', 'const WALKABLE = { xMin: 26, xMax: 908, yMin: 58, yMax: 544 }',
     'function isWalkable(x, y)', 'function renderNode(node, npcId)', 'function handleOption(option)',
     'const NODES = {', 'function revealPatioDoor()', 'dialogue__options--pending',
     'if (dialogueState.open) return'].every((t) => SRC.includes(t)))
  rec('17. still one script, last child of body',
    await evaluate(`document.querySelectorAll('script').length === 1 &&
      (() => { const k = [...document.body.children]; return k[k.length-1].id === 'item-modal' && k[k.length-2].tagName === 'SCRIPT' })()`))
  rec('17. scene still exactly 960x640',
    await evaluate(`(() => { const s = document.querySelector('.scene'); return s.offsetWidth === 960 && s.offsetHeight === 640 })()`))
  rec('17. scene tail is inventory then toast (item modal lifted to body in Phase 7)',
    await evaluate(`(() => { const k = [...document.querySelector('.scene').children].map(e => e.id)
      return k.slice(-3).join(',') === 'inventory,toast,sound-toggle' })()`))
}

// no page errors anywhere in the run
const errs = consoleLogs.filter((l) => l.startsWith('[PAGE EXCEPTION]') || l.startsWith('[error]'))
rec('ERR. no uncaught exceptions or console errors', errs.length === 0, JSON.stringify(errs.slice(0, 5)))

// ── screenshot with two items in the bar and the note open ──
await resetG(); await clearInv()
await evaluate(`addToInventory('note'); addToInventory('binaryNote')`)
await sleep(700)
await evaluate(`openItemModal('note')`)
await sleep(600)
const shot = await pageSend('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${ROOT}/.qwen/tmp/phase5-modal.png`, Buffer.from(shot.data, 'base64'))
await pressEscapeOnBody(); await sleep(300)
const shot2 = await pageSend('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${ROOT}/.qwen/tmp/phase5-bar.png`, Buffer.from(shot2.data, 'base64'))

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name} :: ${f.info}`)) }

browserWs.close(); chrome.kill()
process.exit(failed.length ? 1 : 0)
