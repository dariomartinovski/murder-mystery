// Isolates the cost of the dialogue panel's backdrop-filter during the
// typewriter, with and without GPU, to explain the Phase 2 suite slowdown.
import { spawn } from 'node:child_process'
const ROOT = '/Users/dario.martinovski/murder-mystery'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(port, useGpu) {
  const args = ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`,
    '--window-size=1060,760', '--force-device-scale-factor=1', '--allow-file-access-from-files']
  if (!useGpu) args.push('--disable-gpu')
  args.push(`file://${ROOT}/index.html`)
  const chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let buf = ''
  chrome.stderr.on('data', (d) => { buf += d.toString() })
  let wsUrl
  for (let i = 0; i < 100 && !wsUrl; i++) {
    wsUrl = (buf.match(/DevTools listening on (ws:\/\/\S+)/) || [])[1]
    if (!wsUrl) await sleep(100)
  }
  const ws = new WebSocket(wsUrl)
  await new Promise((r) => { ws.onopen = r })
  let id = 0
  const wait = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && wait.has(m.id)) { const { res, rej } = wait.get(m.id); wait.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) }
  }
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; wait.set(i, { res, rej })
    ws.send(JSON.stringify(sessionId ? { sessionId, id: i, method, params } : { id: i, method, params }))
  })
  const { targetId } = await send('Target.createTarget', { url: `file://${ROOT}/index.html` })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const p = (m, pr = {}) => send(m, pr, sessionId)
  const ev = async (expression) => {
    const r = await p('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  await p('Page.enable'); await p('Runtime.enable'); await sleep(1500)

  // type a long node with the panel open; report wall time + frames rendered
  const measure = (backdrop) => ev(`(async () => {
    const panel = document.getElementById('dialogue')
    const el = document.getElementById('dialogue-text')
    panel.style.backdropFilter = ${backdrop === 'none' ? "'none'" : "''"}
    const long = NODES['table-c']['c_it'].npcText
    closeDialogue(); await new Promise(r => setTimeout(r, 450))
    openDialogue('table-c'); await new Promise(r => setTimeout(r, 450))
    let frames = 0
    let raf = true
    const tick = () => { frames++; if (raf) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    const t0 = performance.now()
    typeText(long, el)
    while (el.textContent.length < long.length) await new Promise(r => setTimeout(r, 16))
    const ms = performance.now() - t0
    raf = false
    return { chars: long.length, expectedMs: long.length * 22, ms: Math.round(ms), frames }
  })()`)

  const withBlur = await measure('blur')
  const noBlur = await measure('none')
  const closed = await ev(`(async () => {
    const el = document.getElementById('dialogue-text')
    const long = NODES['table-c']['c_it'].npcText
    closeDialogue(); await new Promise(r => setTimeout(r, 450))
    const t0 = performance.now()
    typeText(long, el)
    while (el.textContent.length < long.length) await new Promise(r => setTimeout(r, 16))
    return { ms: Math.round(performance.now() - t0) }
  })()`)

  ws.close(); chrome.kill()
  return { withBlur, noBlur, closed }
}

const fmt = (r) => `typed ${r.chars} chars: ideal ${r.expectedMs}ms | actual ${r.ms}ms (${(r.ms / r.expectedMs).toFixed(1)}x) | ${r.frames} frames`
const a = await run(9341, false)
console.log(`\n=== --disable-gpu (what the test suites use) ===`)
console.log('  panel OPEN, backdrop-filter blur(4px): ' + fmt(a.withBlur))
console.log('  panel OPEN, backdrop-filter none     : ' + fmt(a.noBlur))
console.log('  panel CLOSED (clipped, no paint)     : ' + a.closed.ms + 'ms')

const b = await run(9342, true)
console.log(`\n=== GPU enabled ===`)
console.log('  panel OPEN, backdrop-filter blur(4px): ' + fmt(b.withBlur))
console.log('  panel OPEN, backdrop-filter none     : ' + fmt(b.noBlur))
process.exit(0)
