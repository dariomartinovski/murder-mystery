// Phase 8 — narrative panels. Real clicks/keys against headless Chrome.
// Usage: node test/phase8-narrative.test.mjs
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const PORT = 9339
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
await sleep(1200)
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


// ── helpers ──
const mouse = (type, x, y, button = 'left', clickCount = 0) =>
  pageSend('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: type === 'mousePressed' ? 1 : 0 })
const clickClient = async (cx, cy) => {
  await mouse('mouseMoved', cx, cy); await sleep(25)
  await mouse('mousePressed', cx, cy, 'left', 1); await mouse('mouseReleased', cx, cy, 'left', 1)
}
const narr = () => evaluate(`(() => {
  const el = document.getElementById('narration')
  const lines = [...document.querySelectorAll('.narration__line')]
  return {
    active: narrationActive,
    hidden: el.classList.contains('narration--hidden'),
    gone: el.classList.contains('narration--gone'),
    chapter: document.getElementById('narration-chapter').textContent,
    total: lines.length,
    visible: lines.filter(l => l.classList.contains('narration__line--visible')).length,
    highlights: lines.filter(l => l.classList.contains('narration__line--highlight')).length,
    italics: lines.filter(l => l.classList.contains('narration__line--italic')).length,
    empties: lines.filter(l => l.classList.contains('narration__line--empty')).length,
    continueVisible: document.getElementById('narration-continue').classList.contains('narration__continue--visible'),
    idx: narrationLineIdx,
    expected: narrationData ? narrationData.lines.length : -1,
  }
})()`)
const clickNarration = async () => {
  const c = await evaluate(`(() => { const r = document.getElementById('narration').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await clickClient(c.x, c.y)
}
const key = async (k, code, vk) => {
  await pageSend('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await pageSend('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await sleep(150)
}
const clickIn = async (sceneSel, x, y) => {
  const c = await evaluate(`(() => { const s = document.querySelector(${JSON.stringify(sceneSel)})
    const r = s.getBoundingClientRect()
    return { cx: r.left + s.clientLeft + ${x}, cy: r.top + s.clientTop + ${y} } })()`)
  await clickClient(c.cx, c.cy)
}
const pick = async (i) => {
  const c = await evaluate(`(() => { const b = document.querySelectorAll('.dialogue__option')[${i}]
    if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 } })()`)
  if (!c) throw new Error('no dialogue option ' + i)
  await clickClient(c.x, c.y)
  await sleep(700)
}

// ══════════════════════════════════════════
// 1. page load — restaurant hidden, intro up
// ══════════════════════════════════════════
let n = await narr()
rec('1. intro narration is up on load', n.active === true && n.hidden === false && n.gone === false, JSON.stringify(n))
rec('1. restaurant hidden behind it',
  await evaluate(`getComputedStyle(document.getElementById('screen-restaurant')).visibility`) === 'hidden')
rec('1. chapter label is "earlier that evening"', n.chapter === 'earlier that evening', n.chapter)
rec('1. narration sits above every game layer',
  Number(await evaluate(`getComputedStyle(document.getElementById('narration')).zIndex`)) === 1000)

// ══════════════════════════════════════════
// 2. lines appear one by one
// ══════════════════════════════════════════
await sleep(2500)
n = await narr()
rec('2. lines reveal progressively, not all at once',
  n.total > 3 && n.total < n.expected && n.continueVisible === false, JSON.stringify(n))
rec('2. revealed lines are marked visible', n.visible > 0 && n.visible <= n.total, JSON.stringify(n))
await sleep(1500)
const n2 = await narr()
rec('2. more lines appear over time', n2.total > n.total, `${n.total} -> ${n2.total}`)

// ══════════════════════════════════════════
// 3. first click skips to the end
// ══════════════════════════════════════════
await clickNarration(); await sleep(300)
n = await narr()
rec('3. first click reveals every remaining line', n.total === n.expected && n.idx === n.expected, JSON.stringify(n))
rec('3. continue prompt appears', n.continueVisible === true)
rec('3. line-type classes survive the skip',
  n.highlights > 0 && n.italics > 0 && n.empties > 0, JSON.stringify(n))

// ══════════════════════════════════════════
// 4. second click dismisses and starts the game
// ══════════════════════════════════════════
await clickNarration(); await sleep(300)
n = await narr()
rec('4. second click begins the fade-out', n.active === false && n.hidden === true, JSON.stringify(n))
await sleep(900)
n = await narr()
rec('4. panel leaves layout entirely', n.gone === true)
rec('4. restaurant revealed and playable',
  await evaluate(`getComputedStyle(document.getElementById('screen-restaurant')).visibility`) === 'visible')
await clickIn('.scene', 300, 300); await sleep(1100)
rec('4. clicks reach the scene after dismissal',
  await evaluate(`playerPos.x === 300 && playerPos.y === 300`), JSON.stringify(await evaluate(`playerPos`)))

// ══════════════════════════════════════════
// 5. space and enter both work, with preventDefault
// ══════════════════════════════════════════
await evaluate(`showNarration('sos-beat')`); await sleep(400)
await key(' ', 'Space', 32)                       // skip to end
n = await narr()
rec('5. Space skips to the end', n.active === true && n.idx === n.expected && n.continueVisible === true, JSON.stringify(n))
rec('5. Space does not scroll the page', await evaluate(`window.scrollY`) === 0)
await key(' ', 'Space', 32)                       // dismiss
await sleep(900)
rec('5. Space dismisses', (await narr()).gone === true)

await evaluate(`showNarration('sos-beat')`); await sleep(400)
await key('Enter', 'Enter', 13)
n = await narr()
rec('5. Enter skips to the end', n.idx === n.expected && n.continueVisible === true, JSON.stringify(n))
await key('Enter', 'Enter', 13)
await sleep(900)
rec('5. Enter dismisses', (await narr()).gone === true)

// ══════════════════════════════════════════
// 11. Escape does not touch game UI while narration is up
// ══════════════════════════════════════════
await evaluate(`openDialogue('table-a')`); await sleep(500)
await evaluate(`showNarration('toilet-beat')`); await sleep(400)
await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
await sleep(300)
rec('11. Escape closes nothing while narration is active',
  await evaluate(`dialogueState.open`) === true && (await narr()).active === true,
  `dlg=${await evaluate(`dialogueState.open`)} narr=${(await narr()).active}`)
await clickNarration(); await sleep(200); await clickNarration(); await sleep(900)   // dismiss narration
await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
await sleep(400)
rec('11. Escape works again once narration is gone', await evaluate(`dialogueState.open`) === false)

// ══════════════════════════════════════════
// 12. no built-in dedup — caller decides replays
// ══════════════════════════════════════════
await evaluate(`showNarration('sos-beat')`); await sleep(300)
await clickNarration(); await sleep(200); await clickNarration(); await sleep(900)
await evaluate(`showNarration('sos-beat')`); await sleep(400)
rec('12. the same panel can be shown again by a caller', (await narr()).active === true)
await clickNarration(); await sleep(200); await clickNarration(); await sleep(900)

// unknown panel warns and still runs the callback
consoleLogs.length = 0
await evaluate(`new Promise(res => { window.__cbRan = false; showNarration('nope', () => { window.__cbRan = true; res() }) })`)
rec('12. unknown panel warns and fires onComplete',
  await evaluate(`window.__cbRRan || window.__cbRan`) === true &&
  consoleLogs.some((l) => l.includes('No narrative panel')), JSON.stringify(consoleLogs))

// ══════════════════════════════════════════
// 6. toilet beat fires from the wc_inside option
// ══════════════════════════════════════════
await clickIn('.scene', 82, 26); await sleep(1300)     // walk to WC, dialogue opens
rec('6. toilet dialogue opens', await evaluate(`dialogueState.currentNodeId`) === 'wc_intro')
await pick(0)                                          // -> wc_inside
rec('6. inside the toilet', await evaluate(`dialogueState.currentNodeId`) === 'wc_inside')
await pick(0)                                          // "Go back to the restaurant"
await sleep(700)                                       // 400ms delay + reveal
n = await narr()
rec('6. toilet-beat narration plays after the dialogue closes',
  n.active === true && n.chapter === 'ten minutes later', JSON.stringify(n))
rec('6. dialogue closed before the beat', await evaluate(`dialogueState.open`) === false)
await clickNarration(); await sleep(200); await clickNarration(); await sleep(900)
rec('6. dismissing returns her to the restaurant, free to play',
  (await narr()).gone === true &&
  await evaluate(`getComputedStyle(document.getElementById('screen-restaurant')).visibility`) === 'visible')

// ══════════════════════════════════════════
// 13. tone — second person, present tense, all five panels
// ══════════════════════════════════════════
const tone = await evaluate(`(() => {
  const out = {}
  for (const [id, p] of Object.entries(NARRATIVES)) {
    const words = p.lines.filter(l => l.text).map(l => l.text)
    out[id] = {
      lines: words.length,
      secondPerson: words.filter(w => /\\bYou\\b|\\bYour\\b|\\byou\\b|\\byour\\b/.test(w)).length,
      chapters: p.chapter,
    }
  }
  return out
})()`)
rec('13. five panels defined', Object.keys(tone).length === 5, JSON.stringify(Object.keys(tone)))
// The voice is second-person framed; sos-beat and chat-reveal legitimately
// describe him in third person inside that frame, so require every panel to
// address her directly and the voice-setting intro to lean on it heavily.
rec('13. every panel addresses her in second person',
  Object.values(tone).every(t => t.secondPerson >= 1), JSON.stringify(tone))
rec('13. the intro leans on second person', tone['intro'].secondPerson >= Math.floor(tone['intro'].lines * 0.4),
  JSON.stringify(tone['intro']))
rec('13. chapter labels match the spec',
  tone['intro'].chapters === 'earlier that evening' && tone['toilet-beat'].chapters === 'ten minutes later' &&
  tone['sos-beat'].chapters === '' && tone['patio-enter'].chapters === 'outside' && tone['chat-reveal'].chapters === 'oh.',
  JSON.stringify(Object.values(tone).map(t => t.chapters)))
rec('13. sentences stay short (no line over 90 chars)',
  await evaluate(`Object.values(NARRATIVES).every(p => p.lines.every(l => l.text.length <= 90))`))

// ══════════════════════════════════════════
// source-level: replacements + flag
// ══════════════════════════════════════════
rec('R. G.patioEntered added to the game state object', /patioEntered: false,/.test(SRC))
rec('R. wc_inside option carries the toilet-beat action',
  /'wc_inside'[\s\S]{0,600}?showNarration\('toilet-beat'/.test(SRC))
rec('R. onSOSSolved now closes the modal and narrates instead of toasting',
  /function onSOSSolved\(\)\s*\{[\s\S]{0,200}?closeItemModal\(\)[\s\S]{0,200}?showNarration\('sos-beat'/.test(SRC) &&
  !/function onSOSSolved\(\)[\s\S]{0,400}?showToast\(/.test(SRC))
rec('R. transitionToPatio gates the patio narration on first visit',
  /if \(!G\.patioEntered\) \{[\s\S]{0,120}?showNarration\('patio-enter'/.test(SRC))
rec('R. onChatRevealed narrates instead of auto-closing to the final screen',
  /function onChatRevealed\(\)[\s\S]{0,400}?showNarration\('chat-reveal', \(\) => \{[\s\S]{0,80}?showFinalScreen\(\)/.test(SRC))
rec('R. both Escape handlers guard on narrationActive',
  (SRC.match(/if \(narrationActive\) return/g) || []).length === 2)
rec('R. final card is the quiet landing',
  /<div class="final-card__message" id="final-message">\s*You found him\.\s*<\/div>/.test(SRC))
rec('R. game init hides the restaurant until the intro is dismissed',
  /document\.getElementById\('screen-restaurant'\)\.style\.visibility = 'hidden'[\s\S]{0,200}?showNarration\('intro'/.test(SRC))
rec('R. body order is loading screen, mobile guard, then narration',
  await evaluate(`[...document.body.children].slice(0, 3).map(e => e.id).join(',')`) ===
  'loading-screen,mobile-guard,narration')

const errs = consoleLogs.filter((l) => l.startsWith('[PAGE EXCEPTION]') || l.startsWith('[error]'))
  .filter((l) => !l.includes('No narrative panel'))
rec('ERR. no uncaught exceptions or console errors', errs.length === 0, JSON.stringify(errs.slice(0, 5)))

const shot = await pageSend('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${ROOT}/.qwen/tmp/phase8-narration.png`, Buffer.from(shot.data, 'base64'))

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name} :: ${f.info}`)) }

browserWs.close(); chrome.kill()
process.exit(failed.length ? 1 : 0)
