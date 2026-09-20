// fps with the permanent inventory-bar backdrop-filter on vs off.
import { spawn } from 'node:child_process'
const ROOT = '/Users/dario.martinovski/murder-mystery'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(port) {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, '--window-size=1060,760', '--force-device-scale-factor=1',
    '--allow-file-access-from-files', `file://${ROOT}/index.html`], { stdio: ['ignore', 'ignore', 'pipe'] })
  let buf = ''; chrome.stderr.on('data', (d) => { buf += d.toString() })
  let wsUrl
  for (let i = 0; i < 100 && !wsUrl; i++) { wsUrl = (buf.match(/DevTools listening on (ws:\/\/\S+)/) || [])[1]; if (!wsUrl) await sleep(100) }
  const ws = new WebSocket(wsUrl); await new Promise((r) => { ws.onopen = r })
  let id = 0; const wait = new Map()
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && wait.has(m.id)) { const { res, rej } = wait.get(m.id); wait.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } }
  const send = (m, p = {}, s) => new Promise((res, rej) => { const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify(s ? { sessionId: s, id: i, method: m, params: p } : { id: i, method: m, params: p })) })
  const { targetId } = await send('Target.createTarget', { url: `file://${ROOT}/index.html` })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const p = (m, pr = {}) => send(m, pr, sessionId)
  const ev = async (e) => { const r = await p('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }
  await p('Page.enable'); await p('Runtime.enable'); await sleep(1200)

  // force continuous repaint (a walking player) and count frames for 2s
  const fps = (blur) => ev(`(async () => {
    document.getElementById('inventory').style.backdropFilter = ${blur === 'none' ? "'none'" : "''"}
    document.querySelector('.dialogue').style.backdropFilter = ${blur === 'none' ? "'none'" : "''"}
    // keep the scene repainting: nudge the player back and forth
    let frames = 0, run = true
    const tick = () => { frames++; if (run) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    const t0 = performance.now()
    let i = 0
    while (performance.now() - t0 < 2000) {
      player.style.transitionDuration = '200ms'
      player.style.left = (164 + (i++ % 2) * 200) + 'px'
      await new Promise(r => setTimeout(r, 210))
    }
    run = false
    const ms = performance.now() - t0
    return Math.round(frames / (ms / 1000))
  })()`)

  const on = await fps('blur')
  const off = await fps('none')
  ws.close(); chrome.kill()
  return { on, off }
}
const r = await run(9357)
console.log(`\n--disable-gpu, scene repainting continuously for 2s:`)
console.log(`  inventory+dialogue backdrop-filter ON : ${r.on} fps`)
console.log(`  backdrop-filter OFF                   : ${r.off} fps`)
process.exit(0)
