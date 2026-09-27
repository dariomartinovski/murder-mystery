// Phase 9 — polish. Real input against headless Chrome.
// Usage: node test/phase9-polish.test.mjs
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const PORT = 9340
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

// ══════════════════════════════════════════
// 2. loading screen — dot, then fade, then narration
// ══════════════════════════════════════════
rec('2. loading screen is the first thing in body',
  await evaluate(`document.body.children[0].id === 'loading-screen'`))
rec('2. loading screen shows a single pulsing dot',
  await evaluate(`document.querySelectorAll('.loading-screen__dot').length`) === 1 &&
  await evaluate(`getComputedStyle(document.querySelector('.loading-screen__dot')).animationName`) === 'loadingPulse')

// wait for it to clear
let loadingGone = false
for (let i = 0; i < 60 && !loadingGone; i++) {
  loadingGone = await evaluate(`(() => { const l = document.getElementById('loading-screen')
    return l.classList.contains('loading-screen--hidden') || getComputedStyle(l).display === 'none' })()`)
  if (!loadingGone) await sleep(200)
}
rec('2. loading screen fades out once fonts are ready', loadingGone === true)
rec('2. intro narration is up after loading', await evaluate(`narrationActive`) === true)
await sleep(700)   // the display:none teardown runs 500ms after the fade starts
rec('2. loading screen leaves layout entirely',
  await evaluate(`getComputedStyle(document.getElementById('loading-screen')).display`) === 'none')

// dismiss intro
const clickNarration = async () => {
  const c = await centreOf('#narration')
  await clickClient(c.x, c.y)
}
await clickNarration(); await sleep(250); await clickNarration(); await sleep(1000)
rec('2. restaurant revealed after intro', await evaluate(`narrationActive`) === false &&
  await evaluate(`getComputedStyle(document.getElementById('screen-restaurant')).visibility`) === 'visible')

// ══════════════════════════════════════════
// 1. sound — context created on gesture, toggle works, no walk
// ══════════════════════════════════════════
rec('1. audio context created when the intro was dismissed',
  await evaluate(`audioCtx !== null`) === true && await evaluate(`soundEnabled`) === true)
rec('1. ambient murmur started', await evaluate(`ambientNode !== null`) === true)

const posBefore = await evaluate(`JSON.stringify(playerPos)`)
const tog = await centreOf('#sound-toggle')
await clickClient(tog.x, tog.y); await sleep(300)
rec('1. toggle mutes and swaps glyph',
  await evaluate(`soundEnabled`) === false &&
  await evaluate(`document.getElementById('sound-toggle').textContent`) !== '♪')
rec('1. muting does not walk the player',
  await evaluate(`JSON.stringify(playerPos)`) === posBefore,
  `${posBefore} -> ${await evaluate(`JSON.stringify(playerPos)`)}`)
await clickClient(tog.x, tog.y); await sleep(300)
rec('1. toggle unmutes and restores glyph',
  await evaluate(`soundEnabled`) === true &&
  await evaluate(`document.getElementById('sound-toggle').textContent`) === '♪')
rec('1. sound functions run without throwing',
  await evaluate(`(() => { try { playFootstep(); playChime(); startAmbient(); return true } catch (e) { return false } })()`) === true)
rec('1. ambient is not duplicated by a second start',
  await evaluate(`(() => { const n = ambientNode; startAmbient(); return ambientNode === n })()`) === true)

// ══════════════════════════════════════════
// 1b. typing tick — dialogue per character, narration per line
// ══════════════════════════════════════════
rec('1b. playTypeTick exists and is safe to spam',
  await evaluate(`typeof playTypeTick`) === 'function' &&
  await evaluate(`(() => { try { for (let i = 0; i < 20; i++) playTypeTick(); return true } catch (e) { return false } })()`) === true)
rec('1b. tick is gated on the mute flag in source',
  /function playTypeTick[\s\S]{0,200}?if \(!soundEnabled \|\| !audioCtx\) return/.test(SRC))
rec('1b. tick is throttled in source', /lastTypeTick < 0\.03/.test(SRC))
rec('1b. dialogue typewriter ticks per character in source',
  /typeTimer = setInterval\(\(\) => \{[\s\S]{0,80}?playTypeTick\(\)/.test(SRC))
rec('1b. narration ticks once per revealed line in source',
  /narrationLines\.appendChild\(lineEl\)[\s\S]{0,300}?playTypeTick\(1\.6\)/.test(SRC))
rec('1b. the skip-to-end path does not tick',
  !/remaining\.forEach[\s\S]{0,700}?playTypeTick/.test(SRC))

// behavioural: wrap the global and count calls
await evaluate(`window.__ticks = 0; window.__origTick = playTypeTick;
  window.playTypeTick = function (s) { window.__ticks++; return window.__origTick(s) }`)

await evaluate(`openDialogue('table-a')`); await sleep(1600)
const dlgTicks = await evaluate(`window.__ticks`)
rec('1b. dialogue typing actually fires ticks', dlgTicks > 5, `ticks=${dlgTicks}`)
await evaluate(`closeDialogue()`); await sleep(400)

await evaluate(`window.__ticks = 0`)
await evaluate(`showNarration('sos-beat')`); await sleep(2600)
const narrTicks = await evaluate(`window.__ticks`)
const narrLines = await evaluate(`document.querySelectorAll('.narration__line').length`)
rec('1b. narration fires one tick per landed line', narrTicks >= 2 && narrTicks <= narrLines,
  `ticks=${narrTicks} lines=${narrLines}`)

// skipping must not machine-gun: lines jump by many, ticks by at most one
await evaluate(`window.__ticks = 0`)
const beforeLines = narrLines
const nc = await centreOf('#narration')
await clickClient(nc.x, nc.y); await sleep(400)
const afterLines = await evaluate(`document.querySelectorAll('.narration__line').length`)
const skipTicks = await evaluate(`window.__ticks`)
rec('1b. skipping to the end reveals lines without a tick burst',
  afterLines > beforeLines && skipTicks <= 1, `lines ${beforeLines}->${afterLines} ticks=${skipTicks}`)
await clickClient(nc.x, nc.y); await sleep(1000)
rec('1b. narration dismissed cleanly after the tick test', await evaluate(`narrationActive`) === false)

await evaluate(`window.playTypeTick = window.__origTick; delete window.__origTick; delete window.__ticks`)

// ══════════════════════════════════════════
// 3. custom cursor
// ══════════════════════════════════════════
await mouse('mouseMoved', 500, 400); await sleep(120)
rec('3. cursor follows the mouse',
  await evaluate(`document.getElementById('custom-cursor').style.left`) === '500px' &&
  await evaluate(`document.getElementById('custom-cursor').style.top`) === '400px')
rec('3. cursor becomes visible on first move',
  await evaluate(`document.getElementById('custom-cursor').style.opacity`) === '1')
rec('3. system cursor hidden over the scene',
  await evaluate(`getComputedStyle(document.querySelector('.scene')).cursor`) === 'none')

const ta = await centreOf('#table-a')
await mouse('mouseMoved', ta.x, ta.y); await sleep(150)
rec('3. ring expands over interactables',
  await evaluate(`document.getElementById('custom-cursor').classList.contains('custom-cursor--hover')`) === true)
await mouse('mouseMoved', 300, 500); await sleep(150)
rec('3. ring relaxes over plain floor',
  await evaluate(`document.getElementById('custom-cursor').classList.contains('custom-cursor--hover')`) === false)
await mouse('mousePressed', 300, 500, 'left', 1); await sleep(80)
rec('3. ring compresses on mousedown',
  await evaluate(`document.getElementById('custom-cursor').classList.contains('custom-cursor--click')`) === true)
await mouse('mouseReleased', 300, 500, 'left', 1); await sleep(80)
rec('3. ring releases on mouseup',
  await evaluate(`document.getElementById('custom-cursor').classList.contains('custom-cursor--click')`) === false)
await sleep(900)
// the click above reached the scene floor and moved her — proof the cursor
// element (pointer-events: none) did not swallow it
rec('3. cursor never intercepts clicks',
  await evaluate(`getComputedStyle(document.getElementById('custom-cursor')).pointerEvents`) === 'none' &&
  await evaluate(`playerPos.x !== 178 || playerPos.y !== 354`),
  `pointerEvents=${await evaluate(`getComputedStyle(document.getElementById('custom-cursor')).pointerEvents`)} pos=${JSON.stringify(await evaluate(`playerPos`))}`)

// ══════════════════════════════════════════
// 4. micro-animations
// ══════════════════════════════════════════
rec('4. candle flickers on Our Table',
  await evaluate(`getComputedStyle(document.querySelector('.table--our-table')).animationName`) === 'candleFlicker')
const breath = await evaluate(`(() => {
  const ids = ['npc-a','npc-b','npc-c','npc-d','bartender']
  return ids.map(id => { const el = document.getElementById(id)
    return { name: getComputedStyle(el).animationName, delay: getComputedStyle(el).animationDelay } })
})()`)
rec('4. every NPC breathes', breath.every(b => b.name.includes('npcBreath')), JSON.stringify(breath))
rec('4. breathing is staggered, not in sync',
  new Set(breath.map(b => b.delay)).size === breath.length, JSON.stringify(breath.map(b => b.delay)))
rec('4. bar backlight flickers',
  await evaluate(`getComputedStyle(document.querySelector('.bar-counter')).animationName`) === 'barGlow')
rec('4. hint pulse survives the breath animation',
  await evaluate(`(() => { const el = document.getElementById('npc-b')
    el.classList.add('npc--hint-pulse')
    const n = getComputedStyle(el).animationName
    el.classList.remove('npc--hint-pulse')
    return n })()`).then((n) => n.includes('hintPulse') && n.includes('npcBreath')))
rec('4. phone glow still pulses on the patio',
  await evaluate(`getComputedStyle(document.querySelector('.phone-glow')).animationName`) === 'phonePulse')

// ══════════════════════════════════════════
// 5. mobile guard
// ══════════════════════════════════════════
rec('5. guard hidden on a laptop-width screen',
  await evaluate(`getComputedStyle(document.getElementById('mobile-guard')).display`) === 'none')
await pageSend('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 2, mobile: true })
await sleep(300)
rec('5. guard shows on a phone-width screen',
  await evaluate(`getComputedStyle(document.getElementById('mobile-guard')).display`) === 'flex')
rec('5. game screens hidden on mobile',
  await evaluate(`['screen-restaurant','screen-patio','screen-final','loading-screen']
    .every(id => getComputedStyle(document.getElementById(id)).display === 'none')`) === true)
rec('5. guard message names the fix',
  /Open on a laptop/.test(await evaluate(`document.querySelector('.mobile-guard__title').textContent`)))
await pageSend('Emulation.clearDeviceMetricsOverride')
await sleep(300)
rec('5. guard disappears again on a wide screen',
  await evaluate(`getComputedStyle(document.getElementById('mobile-guard')).display`) === 'none')

// ══════════════════════════════════════════
// 6. personalisation placeholders present and findable
// ══════════════════════════════════════════
rec('6. final-screen location is personalised (no placeholder left)',
  !SRC.includes('_______________') &&
  /Tomorrow\s*·\s*\d{1,2}:\d{2}\s*·\s*\S+/.test(
    await evaluate(`document.querySelector('.final-card__detail').textContent`)),
  await evaluate(`document.querySelector('.final-card__detail').textContent`))
rec('6. intro personalisation anchors present',
  SRC.includes("It's a Wednesday on the last day of Spring.") &&
  SRC.includes("You're coming back from lectures.") &&
  SRC.includes("You and your friend are waiting at the bus stop."))
rec('6. chat dessert line present for personalising',
  SRC.includes('Is the special dessert ready?'))

// ══════════════════════════════════════════
// 7. no console errors across the polish run
// ══════════════════════════════════════════
const errs = consoleLogs.filter((l) => l.startsWith('[PAGE EXCEPTION]') || l.startsWith('[error]'))
rec('7. no uncaught exceptions or console errors', errs.length === 0, JSON.stringify(errs.slice(0, 5)))

const shot = await pageSend('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${ROOT}/.qwen/tmp/phase9-polish.png`, Buffer.from(shot.data, 'base64'))

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name} :: ${f.info}`)) }

browserWs.close(); chrome.kill()
process.exit(failed.length ? 1 : 0)
