// Measures the panel's slide-in/out wall time with and without backdrop-filter.
// The earlier probe only measured the typewriter with the panel STATIC.
import { spawn } from 'node:child_process'
const ROOT = '/Users/dario.martinovski/murder-mystery'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(port, useGpu) {
  const args = ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`,
    '--window-size=1060,760', '--force-device-scale-factor=1', '--allow-file-access-from-files']
  if (!useGpu) args.push('--disable-gpu')
  const chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let buf = ''
  chrome.stderr.on('data', (d) => { buf += d.toString() })
  let wsUrl
  for (let i = 0; i < 100 && !wsUrl; i++) { wsUrl = (buf.match(/DevTools listening on (ws:\/\/\S+)/) || [])[1]; if (!wsUrl) await sleep(100) }
  const ws = new WebSocket(wsUrl)
  await new Promise((r) => { ws.onopen = r })
  let id = 0
  const wait = new Map()
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && wait.has(m.id)) { const { res, rej } = wait.get(m.id); wait.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } }
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify(sessionId ? { sessionId, id: i, method, params } : { id, method, params })) })
  const { targetId } = await send('Target.createTarget', { url: `file://${ROOT}/index.html` })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const p = (m, pr = {}) => send(m, pr, sessionId)
  const ev = async (e) => { const r = await p('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }
  await p('Page.enable'); await p('Runtime.enable'); await sleep(1500)

  // wall time for one open->close cycle, measured by transitionend on the panel
  const cycle = (backdrop) => ev(`(async () => {
    const panel = document.getElementById('dialogue')
    panel.style.backdropFilter = ${backdrop === 'none' ? "'none'" : "''"}
    closeDialogue(); await new Promise(r => setTimeout(r, 600))
    const t0 = performance.now()
    openDialogue('table-c')                       // slide IN
    await new Promise(r => new Promise(res => {
      const h = (e) => { if (e.propertyName === 'transform') { panel.removeEventListener('transitionend', h); res() } }
      panel.addEventListener('transitionend', h)
      setTimeout(res, 8000)
    }))
    const inMs = performance.now() - t0
    const t1 = performance.now()
    closeDialogue()                               // slide OUT
    await new Promise(r => new Promise(res => {
      const h = (e) => { if (e.propertyName === 'transform') { panel.removeEventListener('transitionend', h); res() } }
      panel.addEventListener('transitionend', h)
      setTimeout(res, 8000)
    }))
    const outMs = performance.now() - t1
    return { inMs: Math.round(inMs), outMs: Math.round(outMs) }
  })()`)

  // and: how long does a trivial evaluate take WHILE the panel is sliding out?
  const blockedEval = (backdrop) => ev(`(async () => {
    const panel = document.getElementById('dialogue')
    panel.style.backdropFilter = ${backdrop === 'none' ? "'none'" : "''"}
    closeDialogue(); await new Promise(r => setTimeout(r, 600))
    openDialogue('table-c'); await new Promise(r => setTimeout(r, 700))
    const t0 = performance.now()
    closeDialogue()
    const t1 = performance.now()          // sync work only
    return { closeCallMs: Math.round((t1 - t0) * 100) / 100 }
  })()`)

  const blur = await cycle('blur')
  const none = await cycle('none')
  ws.close(); chrome.kill()
  return { blur, none }
}

for (const [label, gpu] of [['--disable-gpu', false], ['GPU enabled', true]]) {
  const r = await run(gpu ? 9351 : 9350, gpu)
  console.log(`\n=== ${label} ===  (a 0.3s transition should cost ~300ms)`)
  console.log(`  backdrop-filter blur(4px):  slide-in ${String(r.blur.inMs).padStart(5)}ms   slide-out ${String(r.blur.outMs).padStart(5)}ms`)
  console.log(`  backdrop-filter none     :  slide-in ${String(r.none.inMs).padStart(5)}ms   slide-out ${String(r.none.outMs).padStart(5)}ms`)
}
process.exit(0)
