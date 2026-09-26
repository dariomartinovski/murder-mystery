// throwaway: screenshot the Table B binary note modal
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PORT = 9350
const ROOT = '/Users/dario.martinovski/murder-mystery'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--window-size=1060,760', '--force-device-scale-factor=2',
  '--allow-file-access-from-files', `file://${ROOT}/index.html`], { stdio: ['ignore', 'ignore', 'pipe'] })
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
browserWs.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && waiting.has(m.id)) {
    const { res, rej } = waiting.get(m.id); waiting.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
}
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++msgId; waiting.set(id, { res, rej })
  browserWs.send(JSON.stringify(sessionId ? { sessionId, id, method, params } : { id, method, params }))
  setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); rej(new Error(`CDP TIMEOUT: ${method}`)) } }, 15000)
})
const { targetId } = await send('Target.createTarget', { url: `file://${ROOT}/index.html` })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const pageSend = (m, p = {}) => send(m, p, sessionId)
const evaluate = async (expression) => {
  const r = await pageSend('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
await pageSend('Page.enable'); await pageSend('Runtime.enable')
await sleep(1500)

for (let i = 0; i < 60; i++) {
  const gone = await evaluate(`(() => { const l = document.getElementById('loading-screen')
    return !l || l.classList.contains('loading-screen--hidden') || getComputedStyle(l).display === 'none' })()`)
  if (gone) break
  await sleep(200)
}
const click = async () => {
  const c = await evaluate(`(() => { const r = document.getElementById('narration').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await pageSend('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'left', clickCount: 0, buttons: 0 })
  await sleep(25)
  await pageSend('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1, buttons: 1 })
  await pageSend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1, buttons: 0 })
}
await click(); await sleep(250)
await click(); await sleep(950)

await evaluate(`addToInventory('binaryNote'); openItemModal('binaryNote')`)
await sleep(700)

console.log('right edges of each value cell (should be identical):')
console.log(await evaluate(`JSON.stringify([...document.querySelectorAll('.binary-sum__row')].map(r => {
  const v = r.querySelector('.binary-sum__val')
  const b = v.getBoundingClientRect()
  return { text: v.textContent.trim().padEnd(9), right: +b.right.toFixed(2), width: +b.width.toFixed(2) }
}), null, 1)`))
console.log('sum box:', await evaluate(`(() => { const b = document.querySelector('.binary-sum').getBoundingClientRect()
  return JSON.stringify({ w: +b.width.toFixed(1), h: +b.height.toFixed(1) }) })()`))
console.log('rule left inset vs first digit row left:', await evaluate(`JSON.stringify({
  rule: +document.querySelector('.binary-sum__rule').getBoundingClientRect().left.toFixed(2),
  row:  +document.querySelector('.binary-sum__row').getBoundingClientRect().left.toFixed(2) })`))

const el = await evaluate(`(() => { const m = document.querySelector('.item-modal')
  const r = m.getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }) })()`)
console.log('modal box:', el)

console.log('card overflow:', await evaluate(`(() => {
  const card = document.querySelector('.item-modal__card')
  const btn  = document.getElementById('puzzle-binary-submit')
  const cb = card.getBoundingClientRect(), bb = btn.getBoundingClientRect()
  return JSON.stringify({
    clientH: card.clientHeight, scrollH: card.scrollHeight,
    scrolls: card.scrollHeight > card.clientHeight,
    btnVisibleInCard: bb.bottom <= cb.bottom + 0.5 && bb.top >= cb.top - 0.5,
    btnBottomMinusCardBottom: +(bb.bottom - cb.bottom).toFixed(1)
  }) })()`))
console.log('rendered note text:', await evaluate(
  `document.querySelector('.binary-sum').innerText.replace(/\\n/g, ' | ')`))

const shot = await pageSend("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
writeFileSync(`${ROOT}/.qwen/tmp/binary-note.png`, Buffer.from(shot.data, 'base64'))
console.log('wrote .qwen/tmp/binary-note.png')

try { chrome.kill() } catch {}
process.exit(0)
