// Times each step of one Phase 2 section-6 iteration to find the stall.
import { spawn } from 'node:child_process'
const ROOT = '/Users/dario.martinovski/murder-mystery'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=9343', '--window-size=1060,760', '--force-device-scale-factor=1',
  '--allow-file-access-from-files', `file://${ROOT}/index.html`], { stdio: ['ignore', 'ignore', 'pipe'] })
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

const step = async (label, fn) => { const t = Date.now(); const out = await fn(); console.log(`  ${String(Date.now() - t).padStart(7)}ms  ${label}${out !== undefined ? '  -> ' + JSON.stringify(out) : ''}`) }

const mouse = (type, x, y, button = 'left', clickCount = 0) =>
  p('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: type === 'mousePressed' ? 1 : 0 })

console.log('\n--- baseline: open panel, then Escape ---')
await step('openDialogue(table-a)', () => ev(`openDialogue('table-a'), dialogueState.open`))
await step('  panel open?', () => ev(`dialogueState.open`))
await step('dispatchKeyEvent keyDown Escape', () => p('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }))
await step('dispatchKeyEvent keyUp Escape', () => p('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }))
await step('  panel closed?', () => ev(`dialogueState.open`))

console.log('\n--- one real click on table-a, timed per step ---')
await step('getBoundingClientRect', async () => ev(`(() => { const s = document.querySelector('.scene'); const r = s.getBoundingClientRect(); return { cx: r.left + s.clientLeft + 572, cy: r.top + s.clientTop + 176 } })()`))
const { cx, cy } = await ev(`(() => { const s = document.querySelector('.scene'); const r = s.getBoundingClientRect(); return { cx: r.left + s.clientLeft + 572, cy: r.top + s.clientTop + 176 } })()`)
await step('mouseMoved', () => mouse('mouseMoved', cx, cy))
await step('mousePressed', () => mouse('mousePressed', cx, cy, 'left', 1))
await step('mouseReleased', () => mouse('mouseReleased', cx, cy, 'left', 1))
await step('read playerPos', () => ev(`({ x: playerPos.x, y: playerPos.y })`))
await step('sleep 1300 (the walk)', () => sleep(1300))
await step('read panel state', () => ev(`({ open: dialogueState.open, node: dialogueState.currentNodeId })`))
await step('isWalkable evaluate', () => ev(`isWalkable(572, 238)`))

console.log('\n--- second click while the panel is OPEN (Escape first) ---')
await step('  panel open?', () => ev(`dialogueState.open`))
await step('Escape keyDown', () => p('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }))
await step('Escape keyUp', () => p('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }))
await step('  panel closed?', () => ev(`dialogueState.open`))
await step('mouseMoved to table-b', () => mouse('mouseMoved', cx - 390, cy))
await step('mousePressed', () => mouse('mousePressed', cx - 390, cy, 'left', 1))
await step('mouseReleased', () => mouse('mouseReleased', cx - 390, cy, 'left', 1))

console.log('\n--- how long does the longest typewriter take? ---')
await step('longest node text lengths', () => ev(`(() => { const out = {}; for (const [n, ns] of Object.entries(NODES)) for (const [id, node] of Object.entries(ns)) out[id] = node.npcText.length; return Object.entries(out).sort((a,b)=>b[1]-a[1]).slice(0,4) })()`))

ws.close(); chrome.kill(); process.exit(0)
