// Phase 4 — game state + dialogue trees. Real clicks against headless Chrome.
// Usage: node test/phase4-narrative.test.mjs
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const PORT = 9335
const ROOT = '/Users/dario.martinovski/murder-mystery'
const FILE = `file://${ROOT}/index.html`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// source of truth is now spread across index.html + css/ + js/
const SRC = [`${ROOT}/index.html`,
  ...readdirSync(`${ROOT}/css`).sort().map(f => `${ROOT}/css/${f}`),
  ...readdirSync(`${ROOT}/js`).sort().map(f => `${ROOT}/js/${f}`),
].map(p => readFileSync(p, 'utf8')).join('\n')

const results = []
const rec = (name, pass, info = '') => results.push({ name, pass, info: String(info) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1060,760', '--force-device-scale-factor=1',
  '--allow-file-access-from-files', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

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
})
const { targetId } = await send('Target.createTarget', { url: FILE })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const pageSend = (m, p = {}) => send(m, p, sessionId)
const evaluate = async (expression) => {
  const r = await pageSend('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
await pageSend('Page.enable')
await pageSend('Runtime.enable')
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

const panel = () => evaluate(`(() => {
  const p = document.getElementById('dialogue')
  return {
    open: dialogueState.open, npc: dialogueState.currentNpcId, nodeId: dialogueState.currentNodeId,
    name: document.getElementById('dialogue-npc-name').textContent,
    text: document.getElementById('dialogue-text').textContent,
    options: [...document.querySelectorAll('.dialogue__option')].map(o => o.textContent),
    G: JSON.parse(JSON.stringify(G)),
  }
})()`)

const resetG = () => evaluate(`Object.keys(G).forEach(k => { G[k] = false })`)
const setG = (o) => evaluate(`Object.assign(G, ${JSON.stringify(o)})`)

// open an NPC and wait only long enough for the options to be revealed
const openNpc = async (id) => {
  await evaluate(`closeDialogue()`); await sleep(420)
  await evaluate(`openDialogue('${id}')`)
  await sleep(700)
  return panel()
}
const clickOption = async (i) => {
  const box = await evaluate(`(() => {
    const b = document.querySelectorAll('.dialogue__option')[${i}]
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!box) throw new Error(`no rendered option at index ${i}`)
  await clickClient(box.x, box.y)
  await sleep(700)
  return panel()
}
// wait for the typewriter to finish the current node
// Poll until the typewriter finishes rather than sleeping a guessed duration:
// the 22ms/char interval drifts under load, and long nodes (w_hint, 561 chars)
// outran a fixed sleep once the page grew in Phase 7.
const waitTyped = async () => {
  for (let i = 0; i < 100; i++) {
    const done = await evaluate(`(() => {
      const n = NODES[dialogueState.currentNpcId][dialogueState.currentNodeId]
      return document.getElementById('dialogue-text').textContent === n.npcText
    })()`)
    if (done) return
    await sleep(250)
  }
  throw new Error('typewriter never completed')
}

// ══════════════════════════════════════════
// 13. graph integrity — every referenced node exists
// ══════════════════════════════════════════
const graph = await evaluate(`(() => {
  const problems = [], orphans = []
  const referenced = new Set()

  for (const [npcId, nodes] of Object.entries(NODES)) {
    if (!NPCS[npcId]) problems.push('NODES entry with no NPCS entry: ' + npcId)
    for (const [nid, node] of Object.entries(nodes)) {
      if (node.id !== nid) problems.push('node.id mismatch: ' + npcId + '.' + nid + ' says ' + node.id)
      if (typeof node.npcText !== 'string' || !node.npcText.trim()) problems.push('empty npcText: ' + npcId + '.' + nid)
      if (!Array.isArray(node.options) || !node.options.length) problems.push('no options: ' + npcId + '.' + nid)
      for (const o of (node.options || [])) {
        if (!o.text || !o.text.trim()) problems.push('option without text: ' + npcId + '.' + nid)
        if (!('next' in o)) problems.push('option without next: ' + npcId + '.' + nid)
        if (o.next === undefined) problems.push('next undefined: ' + npcId + '.' + nid)
        if (o.next !== null && o.next !== undefined && !nodes[o.next])
          problems.push('DANGLING next: ' + npcId + '.' + nid + ' -> ' + o.next)
        if (o.next) referenced.add(npcId + '.' + o.next)
        if (o.condition && typeof o.condition !== 'function') problems.push('bad condition: ' + npcId + '.' + nid)
        if (o.action && typeof o.action !== 'function') problems.push('bad action: ' + npcId + '.' + nid)
      }
      if (node.condition && typeof node.condition !== 'function') problems.push('bad node condition: ' + npcId + '.' + nid)
      if (node.onEnter && typeof node.onEnter !== 'function') problems.push('bad onEnter: ' + npcId + '.' + nid)
    }
  }

  // every entryNode() result must resolve, across ALL flag combinations
  const flags = Object.keys(G)
  const entryIds = new Set()
  for (let mask = 0; mask < (1 << flags.length); mask++) {
    const fake = {}
    flags.forEach((f, i) => { fake[f] = !!(mask & (1 << i)) })
    for (const [npcId, npc] of Object.entries(NPCS)) {
      let id
      try { id = npc.entryNode(fake) } catch (e) { problems.push('entryNode threw for ' + npcId + ': ' + e.message); continue }
      if (!NODES[npcId] || !NODES[npcId][id]) problems.push('entryNode -> missing node: ' + npcId + ' -> ' + id + ' (mask ' + mask + ')')
      else entryIds.add(npcId + '.' + id)
    }
  }

  // orphans: neither an entry node nor referenced by any option
  for (const [npcId, nodes] of Object.entries(NODES))
    for (const nid of Object.keys(nodes)) {
      const key = npcId + '.' + nid
      if (!referenced.has(key) && !entryIds.has(key)) orphans.push(key)
    }

  const counts = {}
  for (const [npcId, nodes] of Object.entries(NODES)) counts[npcId] = Object.keys(nodes).length
  return { problems, orphans, counts, npcCount: Object.keys(NPCS).length,
           totalNodes: Object.values(NODES).reduce((n, x) => n + Object.keys(x).length, 0) }
})()`)

rec('13. no dangling / malformed node references', graph.problems.length === 0, JSON.stringify(graph.problems.slice(0, 8)))
rec('13. no orphaned unreachable nodes', graph.orphans.length === 0, JSON.stringify(graph.orphans))
rec('13. entryNode resolves under every flag combination',
  !graph.problems.some((p) => p.includes('entryNode')), JSON.stringify(graph.problems.filter((p) => p.includes('entryNode')).slice(0, 5)))
rec('13. seven NPCs, full trees present',
  graph.npcCount === 7 && graph.totalNodes === 38, JSON.stringify(graph.counts))
rec('13. door-exit now has its locked-door entry',
  await evaluate(`('door-exit' in NPCS) && ('door-exit' in NODES)`))

// ══════════════════════════════════════════
// 1. Toilet door — first vs second visit
// ══════════════════════════════════════════
await resetG()
let p = await openNpc('door-wc')
rec('1. toilet first visit opens wc_intro', p.nodeId === 'wc_intro', p.nodeId)
rec('1. wc_intro onEnter sets G.visitedToilet', p.G.visitedToilet === true, JSON.stringify(p.G.visitedToilet))
await waitTyped()
const wcFirst = (await panel()).text
rec('1. first visit describes the scene', /men's toilet/.test(wcFirst) && /Dario/.test(wcFirst), wcFirst.slice(0, 70))
rec('1. first visit offers exactly one way in', (await panel()).options.length === 1, JSON.stringify((await panel()).options))

p = await clickOption(0)
rec('1. going inside advances to wc_inside', p.nodeId === 'wc_inside', p.nodeId)
await waitTyped()
rec('1. inside is empty + cigarette smoke near the window',
  /Empty/.test((await panel()).text) && /cigarette smoke/.test((await panel()).text), (await panel()).text.slice(0, 80))

p = await openNpc('door-wc')
rec('1. second visit opens wc_revisit', p.nodeId === 'wc_revisit', p.nodeId)
await waitTyped()
const wcSecond = (await panel()).text
rec('1. revisit text is shorter than the first', wcSecond.length < wcFirst.length,
  `${wcSecond.length} vs ${wcFirst.length}`)

// ══════════════════════════════════════════
// 2. Table A — gives her the note
// ══════════════════════════════════════════
await resetG()
p = await openNpc('table-a')
rec('2. table-a opens on a_intro', p.nodeId === 'a_intro', p.nodeId)
rec('2. note not found before the conversation', p.G.foundNote === false)
consoleLogs.length = 0
p = await clickOption(0)
rec('2. asking about her friend advances to a_seen', p.nodeId === 'a_seen', p.nodeId)
rec('2. a_seen onEnter sets G.foundNote', p.G.foundNote === true, JSON.stringify(p.G.foundNote))
// Phase 5 replaced the placeholder log with a real pickup
rec('2. a_seen onEnter adds the note to the inventory',
  await evaluate(`inventory.includes('note')`) === true, JSON.stringify(await evaluate(`[...inventory]`)))
await waitTyped()
rec('2. he hands over a folded note found near the toilet',
  /found this on the floor near the toilet/.test((await panel()).text), (await panel()).text.slice(0, 80))
p = await clickOption(0)
rec('2. asking what it says advances to a_note', p.nodeId === 'a_note', p.nodeId)
await waitTyped()
rec('2. a_note describes numbers on one side and a grid on the other',
  /numbers on one side/.test((await panel()).text) && /grid of some sort/.test((await panel()).text))
p = await clickOption(0)
rec('2. a_note closes the panel', p.open === false, `open=${p.open}`)

// "Sorry to bother you." is a clean exit that gives nothing
await resetG()
p = await openNpc('table-a')
p = await clickOption(1)
rec('2. declining closes without giving the note', p.open === false && p.G.foundNote === false, JSON.stringify(p.G))

// ══════════════════════════════════════════
// 3/4/5. Table B — gated by decodedSOS then solvedBinary
// ══════════════════════════════════════════
await resetG()
p = await openNpc('table-b')
rec('3. table-b first visit opens b_intro', p.nodeId === 'b_intro', p.nodeId)
consoleLogs.length = 0
p = await clickOption(0)
rec('3. asking him lands on the b_nothing dead end', p.nodeId === 'b_nothing', p.nodeId)
await waitTyped()
rec('3. dead end reads as a dead end', /didn't notice anything/.test((await panel()).text), (await panel()).text.slice(0, 70))
rec('3. dead end offers only a way out', (await panel()).options.length === 1, JSON.stringify((await panel()).options))
p = await clickOption(0)
rec('3. dead end closes the panel', p.open === false)
rec('3. no binary note given before the SOS is decoded',
  !consoleLogs.some((l) => l.includes('binaryNote')), JSON.stringify(consoleLogs))

await resetG(); await setG({ decodedSOS: true })
// b_unlocked's onEnter runs during openDialogue itself, so any state it sets
// must be read after opening, not from a log buffer cleared beforehand.
p = await openNpc('table-b')
rec('4. after decodedSOS, entry node is b_unlocked', p.nodeId === 'b_unlocked', p.nodeId)
// Phase 5 replaced the placeholder log with a real pickup
rec('4. b_unlocked onEnter adds the binary note to the inventory',
  await evaluate(`inventory.includes('binaryNote')`) === true, JSON.stringify(await evaluate(`[...inventory]`)))
await waitTyped()
rec('4. he describes the dark-jacket man and writes it in binary',
  /dark jacket/.test((await panel()).text) && /binary/.test((await panel()).text), (await panel()).text.slice(0, 80))
p = await clickOption(0)
rec('4. asking for help decoding advances to b_hint', p.nodeId === 'b_hint', p.nodeId)
await waitTyped()
rec('4. b_hint teaches the column method and no longer names the answer',
  /column/.test((await panel()).text) &&
  /convert it to decimal/.test((await panel()).text) &&
  !/00010111/.test((await panel()).text) && !/twenty-three/i.test((await panel()).text),
  (await panel()).text.slice(0, 90))

await resetG(); await setG({ decodedSOS: true, solvedBinary: true })
p = await openNpc('table-b')
rec('5. after solvedBinary, entry node is b_done', p.nodeId === 'b_done', p.nodeId)
await waitTyped()
rec('5. b_done is a short closing beat',
  (await panel()).text.length < 120 && /Did you work it out/.test((await panel()).text), `${(await panel()).text.length} chars`)
rec('5. b_done offers two exits, both closing', (await panel()).options.length === 2, JSON.stringify((await panel()).options))

// ══════════════════════════════════════════
// 6/14. Table C — lost phone, garden tables, revisit conditionals
// ══════════════════════════════════════════
await resetG()
p = await openNpc('table-c')
rec('6. table-c first visit opens c_intro', p.nodeId === 'c_intro', p.nodeId)
rec('6. c_intro offers three options', p.options.length === 3, JSON.stringify(p.options))
p = await clickOption(0)
rec('6. asking about the night advances to c_nothing', p.nodeId === 'c_nothing', p.nodeId)
rec('6. c_nothing onEnter sets G.tableCVisited', p.G.tableCVisited === true, JSON.stringify(p.G.tableCVisited))
p = await clickOption(0)
rec('6. she asks where he last had it, and he answers', p.nodeId === 'c_where', p.nodeId)
await waitTyped()
const cWhere = (await panel()).text
rec('6. c_where names the garden tables on the FIRST visit',
  /seven or eight/.test(cWhere) && /garden side/.test(cWhere), cWhere.slice(0, 120))
rec('6. c_where describes the phone', /Black case/.test(cWhere) && /Cracked screen/.test(cWhere), cWhere.slice(0, 160))
p = await clickOption(1)
rec('6. pressing about the lock reaches c_locked', p.nodeId === 'c_locked', p.nodeId)
await waitTyped()
rec('6. c_locked teases without explaining',
  /particular about my passcode/.test((await panel()).text) &&
  !/Macedonian|1430|timezone/i.test((await panel()).text), (await panel()).text.slice(0, 120))
p = await clickOption(0)
rec('6. c_locked leads on to c_thanks', p.nodeId === 'c_thanks', p.nodeId)

// the PIN lore left Simon entirely: nothing in his tree mentions it,
// and the phone notes still carry it
rec('6. no node in table-c mentions the PIN mechanics',
  await evaluate(`Object.values(NODES['table-c']).every(n => !/Macedonian|1430|timezone|PIN/i.test(n.npcText))`))
rec('6. the lore lives in the phone notes instead',
  SRC.includes('Chat password in mk time hh:mm') && SRC.includes('Pacific/Auckland'))

// the alternate route through c_phone reaches the same place
await resetG()
p = await openNpc('table-c')
p = await clickOption(1)
rec('6. "Are you alright?" routes to c_phone', p.nodeId === 'c_phone', p.nodeId)
rec('6. c_phone also sets G.tableCVisited', p.G.tableCVisited === true)
p = await clickOption(0)
rec('6. c_phone also reaches c_where', p.nodeId === 'c_where', p.nodeId)

// revisit conditionals — exactly one option per state
const cRevisitCases = [
  [{ foundPhone: false, crackedChatApp: false }, 'Not yet — still looking.', 'c_revisit_no'],
  [{ foundPhone: true,  crackedChatApp: false }, "I found it — I'll bring it back shortly.", 'c_revisit_found'],
  [{ foundPhone: true,  crackedChatApp: true  }, 'I found what I needed. Thank you.', null],
]
for (const [flags, wantText, wantNext] of cRevisitCases) {
  await resetG(); await setG({ tableCVisited: true, ...flags })
  p = await openNpc('table-c')
  rec(`14. c_revisit with ${JSON.stringify(flags)} opens c_revisit`, p.nodeId === 'c_revisit', p.nodeId)
  rec(`14. c_revisit shows exactly the right option`,
    p.options.length === 1 && p.options[0] === wantText, JSON.stringify(p.options))
  const after = await clickOption(0)
  rec(`14. that option goes to ${wantNext === null ? 'close' : wantNext}`,
    wantNext === null ? after.open === false : after.nodeId === wantNext,
    `open=${after.open} node=${after.nodeId}`)
}
// c_revisit_no repeats the table location
await resetG(); await setG({ tableCVisited: true })
p = await openNpc('table-c'); p = await clickOption(0)
await waitTyped()
rec('6. c_revisit_no repeats where the phone was left',
  /six, seven/.test((await panel()).text) && /garden side/.test((await panel()).text),
  (await panel()).text.slice(0, 120))

// ══════════════════════════════════════════
// 7/8. Table D — close-mouthed until she has the number
// ══════════════════════════════════════════
await resetG()
p = await openNpc('table-d')
rec('7. table-d first visit opens d_intro', p.nodeId === 'd_intro', p.nodeId)
await waitTyped()
rec('7. d_intro reads as a man just back from outside',
  /Just arrived/.test((await panel()).text) && /wash my hands/.test((await panel()).text))
p = await clickOption(0)
rec('7. pre-binary, asking about the toilet advances to d_vague', p.nodeId === 'd_vague', p.nodeId)
await waitTyped()
rec('7. pre-binary he volunteers nothing — no coat, no number',
  !/coat|jacket|Twenty-three|\b23\b/i.test((await panel()).text) && /Nobody/.test((await panel()).text),
  (await panel()).text.slice(0, 120))
rec('7. pre-binary conversation leaves G.tableDConfirmed false', p.G.tableDConfirmed === false)
rec('7. no pre-binary node mentions the coat or the number',
  await evaluate(`['d_intro','d_vague'].every(id => !/coat|jacket|Twenty-three|\\b23\\b/i.test(NODES['table-d'][id].npcText))`))

// after the binary puzzle she can ask the right question, and he confirms
await resetG(); await setG({ solvedBinary: true })
p = await openNpc('table-d')
rec('8. solvedBinary + unconfirmed opens d_ready', p.nodeId === 'd_ready', p.nodeId)
rec('8. d_ready offers the numbered-shirt question',
  p.options.some((o) => /number on his shirt/.test(o)), JSON.stringify(p.options))
p = await clickOption(0)
rec('8. asking about the numbered shirt reaches d_number', p.nodeId === 'd_number', p.nodeId)
await waitTyped()
rec('8. d_number confirms the dark coat and the 23',
  /dark coat/.test((await panel()).text) && /Twenty-three/.test((await panel()).text),
  (await panel()).text.slice(0, 160))
rec('8. d_number onEnter sets G.tableDConfirmed', p.G.tableDConfirmed === true, JSON.stringify(p.G.tableDConfirmed))
p = await clickOption(0)
rec('8. asking which way he went reaches d_direction', p.nodeId === 'd_direction', p.nodeId)
await waitTyped()
rec('8. d_direction points at the back door and the patio',
  /door back there/.test((await panel()).text) && /patio/.test((await panel()).text),
  (await panel()).text.slice(0, 140))

// fully confirmed: d_done, and it wins over d_ready
await resetG(); await setG({ tableDConfirmed: true })
p = await openNpc('table-d')
rec('8. tableDConfirmed opens d_done', p.nodeId === 'd_done', p.nodeId)
await resetG(); await setG({ solvedBinary: true, tableDConfirmed: true })
p = await openNpc('table-d')
rec('8. d_done takes precedence over d_ready', p.nodeId === 'd_done', p.nodeId)

// 9/10/11. Marko — dead end first, hint last
// ══════════════════════════════════════════
await resetG()
p = await openNpc('bar')
rec('9. waiter first visit opens w_intro', p.nodeId === 'w_intro', p.nodeId)
rec('9. w_intro onEnter sets G.waiterFirstVisit', p.G.waiterFirstVisit === true, JSON.stringify(p.G.waiterFirstVisit))
rec('9. w_intro offers three options', p.options.length === 3, JSON.stringify(p.options))
rec('9. patio still locked on first visit', p.G.patioUnlocked === false && p.G.waiterHintGiven === false)

// cameras branch is a dead end
p = await clickOption(2)
rec('9. cameras option advances to w_cameras', p.nodeId === 'w_cameras', p.nodeId)
await waitTyped()
rec('9. cameras are broken — a real dead end',
  /haven't worked since October/.test((await panel()).text), (await panel()).text.slice(0, 80))
rec('9. w_cameras offers only a way out', (await panel()).options.length === 1, JSON.stringify((await panel()).options))
p = await clickOption(0)
rec('9. camera dead end closes the panel', p.open === false)

// w_missing routes onward rather than dead-ending
await resetG()
p = await openNpc('bar')
p = await clickOption(0)
rec('9. missing-friend option advances to w_missing', p.nodeId === 'w_missing', p.nodeId)
rec('9. w_missing keeps two ways forward', (await panel()).options.length === 2, JSON.stringify((await panel()).options))

// the hint, once every gate is satisfied
await resetG()
await setG({ solvedBinary: true, tableDConfirmed: true, tableCVisited: true })
consoleLogs.length = 0
p = await openNpc('bar')
rec('10. all gates met -> entry node is the short approach beat', p.nodeId === 'w_hint', p.nodeId)
await waitTyped()
rec('10. the approach beat asks if she is still looking, and unlocks nothing',
  p.options.length === 2 && /still looking/.test((await panel()).text) &&
  p.G.waiterHintGiven === false && p.G.patioUnlocked === false &&
  await evaluate(`document.getElementById('door-exit').classList.contains('door--active')`) === false,
  JSON.stringify(p.options))
p = await clickOption(1)
rec('10. showing him the number reaches the payoff beat', p.nodeId === 'w_hint_number', p.nodeId)
rec('10. the payoff onEnter sets waiterHintGiven + patioUnlocked',
  p.G.waiterHintGiven === true && p.G.patioUnlocked === true, JSON.stringify(p.G))
// Phase 6 replaced the PATIO log with pulse cleanup + revealPatioDoor()
rec('10. the payoff onEnter clears every hint pulse',
  await evaluate(`document.querySelectorAll('.npc--hint-pulse').length`) === 0)
rec('10. PATIO placeholder log is gone from source', !SRC.includes('PATIO UNLOCKED — Phase 7 shows exit door'))
await waitTyped()
const wHint = (await panel()).text
rec('10. w_hint explains the bolt and the wind',
  /bolted/.test(wHint) && /Wind's been slamming it/.test(wHint) && /draws the bolt/.test(wHint),
  wHint.slice(-220))
rec('10. w_hint connects 23 to a numbered shirt on the patio',
  /numbered shirt/.test(wHint) && /patio/.test(wHint), wHint.slice(0, 200))
rec('10. w_hint names tables six, seven, eight',
  /Tables six, seven, eight/.test(wHint), wHint.slice(0, 400))
rec('10. w_hint places the dark-jacket man smoking out there',
  /Having a smoke/.test(wHint) && /Dark jacket/.test(wHint))
rec('10. the payoff offers the single patio option', (await panel()).options.length === 1, JSON.stringify((await panel()).options))

// the no-luck branch routes into the same payoff
await resetG()
await setG({ solvedBinary: true, tableDConfirmed: true, tableCVisited: true })
p = await openNpc('bar')
p = await clickOption(0)
rec('10. "No luck yet." lands on its own beat', p.nodeId === 'w_hint_noluck', p.nodeId)
rec('10. the no-luck beat still offers the number',
  p.options.some((o) => /number 23/.test(o)), JSON.stringify(p.options))
rec('10. no-luck alone unlocks nothing', p.G.patioUnlocked === false)
p = await clickOption(0)
rec('10. showing the number from no-luck reaches the payoff', p.nodeId === 'w_hint_number', p.nodeId)
// left open on purpose: the next section's clickOption(0) walks w_hint_number -> w_patio

// the exit door cue
const door = await evaluate(`(() => {
  const d = document.getElementById('door-exit')
  const cs = getComputedStyle(d)
  const cue = d.querySelector('.door__patio-cue')
  const ccs = cue ? getComputedStyle(cue) : null
  const handle = getComputedStyle(d, '::after')
  const cr = cue ? cue.getBoundingClientRect() : null
  const dr = d.getBoundingClientRect()
  return {
    active: d.classList.contains('door--active'),
    shadow: cs.boxShadow, cursor: cs.cursor,
    cueText: cue ? cue.textContent : null, cueDisplay: ccs ? ccs.display : null,
    cueColor: ccs ? ccs.color : null,
    cueBelowDoor: cr ? cr.top >= dr.bottom - 2 : false,
    handleIntact: handle.width === '4px' && handle.height === '4px' && handle.borderRadius === '50%',
  }
})()`)
rec('10. exit door gains .door--active', door.active === true, JSON.stringify(door.active))
rec('10. exit door gains the amber glow', /244, 168, 67/.test(door.shadow), door.shadow)
rec('10. exit door keeps its Phase 1 frame shading', /0px 4px 12px/.test(door.shadow), door.shadow)
rec('10. PATIO cue is visible below the door',
  door.cueText === 'PATIO →' && door.cueDisplay === 'block' && door.cueBelowDoor === true, JSON.stringify(door))
rec('10. door handle survived the cue (not a ::after collision)', door.handleIntact === true, JSON.stringify(door.handleIntact))

p = await clickOption(0)
rec('10. patio option advances to w_patio', p.nodeId === 'w_patio', p.nodeId)
await waitTyped()
rec('10. w_patio tells her where the door is',
  /just past the toilet corridor/.test((await panel()).text), (await panel()).text.slice(0, 80))

// close the w_patio panel, then prove the cloned door transitions not talks
await evaluate(`closeDialogue()`); await sleep(400)
// post-unlock the door element is cloned: its click must transition, not talk
await evaluate(`document.getElementById('door-exit').click()`)
await sleep(2000)
rec('10. after the hint, clicking the door transitions without a panel',
  await evaluate(`dialogueState.open`) === false &&
  await evaluate(`document.getElementById('screen-patio').classList.contains('game-screen--active')`) === true,
  `open=${await evaluate(`dialogueState.open`)}`)
await evaluate(`transitionToRestaurant()`); await sleep(900)
if (await evaluate(`narrationActive`)) {
  await evaluate(`(() => { const el = document.getElementById('narration')
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })()`)
  await sleep(1000)
}
await evaluate(`G.patioEntered = false`)

// hint already given -> w_done
p = await openNpc('bar')
rec('11. after the hint, entry node is w_done', p.nodeId === 'w_done', p.nodeId)
await waitTyped()
rec('11. w_done is a short acknowledgment',
  (await panel()).text.length < 130 && /Patio's still open/.test((await panel()).text), `${(await panel()).text.length} chars`)
rec('11. w_done offers a single exit', (await panel()).options.length === 1, JSON.stringify((await panel()).options))

// partial gates must NOT unlock the hint
for (const gates of [
  { solvedBinary: true, tableDConfirmed: true },
  { solvedBinary: true, tableCVisited: true },
  { tableDConfirmed: true, tableCVisited: true },
]) {
  await resetG(); await setG(gates)
  const q = await openNpc('bar')
  rec(`11. incomplete gates ${JSON.stringify(gates)} stay on w_intro`, q.nodeId === 'w_intro', q.nodeId)
  rec(`11. incomplete gates ${JSON.stringify(gates)} leave the patio locked`,
    q.G.patioUnlocked === false && q.G.waiterHintGiven === false)
}

// the door cue must not appear before the unlock
await evaluate(`document.getElementById('door-exit').classList.remove('door--active')`)
await resetG()
p = await openNpc('bar')
await clickOption(2); await clickOption(0)
rec('11. a dead-end first visit never reveals the patio cue',
  await evaluate(`!document.getElementById('door-exit').classList.contains('door--active')`) === true)

// ══════════════════════════════════════════
// full critical path, played by clicking only
// ══════════════════════════════════════════
await resetG()
await evaluate(`document.getElementById('door-exit').classList.remove('door--active')`)
const path = []
p = await openNpc('door-wc');            path.push(p.nodeId); await clickOption(0); path.push((await panel()).nodeId)

p = await openNpc('table-a');            await clickOption(0); path.push('note:' + (await panel()).G.foundNote)
p = await openNpc('table-c');            await clickOption(0); await clickOption(0); await clickOption(0); path.push('C:' + (await panel()).nodeId)
await setG({ decodedSOS: true, solvedBinary: true })   // Phase 6 puzzles
p = await openNpc('table-b');            path.push('B:' + p.nodeId); await clickOption(0); path.push('Bhint:' + (await panel()).nodeId)
p = await openNpc('table-d');            path.push('D:' + p.nodeId); await clickOption(0); path.push('Dnum:' + (await panel()).G.tableDConfirmed)
p = await openNpc('bar');                path.push('W:' + p.nodeId); await clickOption(1)
const endState = await evaluate(`({ patio: G.patioUnlocked, hint: G.waiterHintGiven,
  note: G.foundNote, dConf: G.tableDConfirmed, cVis: G.tableCVisited, wc: G.visitedToilet,
  door: document.getElementById('door-exit').classList.contains('door--active') })`)
rec('PATH. clicking through the story reaches the patio unlock',
  endState.patio && endState.hint && endState.note && endState.dConf && endState.cVis && endState.wc && endState.door,
  JSON.stringify(endState) + ' | ' + path.join(' -> '))
rec('PATH. the run produced no missing-node or condition warnings',
  consoleLogs.filter((l) => l.includes('Missing node') || l.includes('condition not met') || l.includes('No entry node')).length === 0,
  JSON.stringify(consoleLogs.filter((l) => l.includes('Missing node') || l.includes('condition not met'))))

// ══════════════════════════════════════════
// 12. nothing from Phases 1-3 was restructured
// ══════════════════════════════════════════
{
  rec('12. Phase 1 palette + layout intact',
    ['--floor-dark: #2C1810;', '--amber: #F4A843;', '--sage: #6B7B5E;',
     'width: 960px;', 'height: 640px;', '.table-group--ours', 'npc--hint-pulse'].every((s) => SRC.includes(s)))
  rec('12. Phase 2 movement internals intact',
    ['const WALKABLE = { xMin: 26, xMax: 908, yMin: 58, yMax: 544 }', 'function isWalkable(x, y)',
     'function scenePoint(e)', 'function renderPlayer()', 'let playerPos = { x: 178, y: 354 }',
     'if (dialogueState.open) return',
     "if (itemModal.classList.contains('item-modal--open')) return",
     'openDialogue(el.id)'].every((s) => SRC.includes(s)))
  rec('12. Phase 3 panel mechanics intact',
    ['function typeText(text, element, speed = 22)', 'function stopDialogueTimers()',
     'function closeDialogue()', 'dialogue__options--pending', 'const dialogueState = {',
     "console.warn('No dialogue defined for:', npcId)"].every((s) => SRC.includes(s)))
  rec('12. replacement 1 — placeholder NPCS fully removed',
    !SRC.includes('greeting:') && !SRC.includes('placeholder_a1'), 'placeholder NPCS still present')
  rec('12. replacement 2 — Phase 3 handleOption body fully removed',
    !SRC.includes("console.log('Option selected:'"), 'old handleOption body still present')
  // one declaration + exactly two call sites (handleOption, openDialogue)
  const renderNodeHits = (SRC.match(/renderNode\(node, npcId\)/g) || []).length
  rec('12. renderNode added and used by both entry points',
    SRC.includes('function renderNode(node, npcId)') && renderNodeHits - 1 === 2,
    `${renderNodeHits} total occurrences, ${renderNodeHits - 1} call sites`)
  rec('12. renderNode uses the tracked optionsTimer, not a bare setTimeout',
    /optionsTimer = setTimeout\(\(\) => \{[\s\S]{0,300}?renderOptions\(visibleOptions\)/.test(SRC) &&
    !/renderNode[\s\S]{0,700}?(?<!optionsTimer = )setTimeout\(/.test(SRC.split('function renderNode')[1].split('function openDialogue')[0]))
  rec('12. still one script, last child of body',
    await evaluate(`document.querySelectorAll('script').length === 9 &&
      (() => { const k = [...document.body.children]; return k.filter(e => e.id === 'item-modal').length === 1 && k[k.length-1].tagName === 'SCRIPT' && document.scripts[document.scripts.length-1].src.endsWith('js/init.js') })()`))
  rec('12. scene still exactly 960x640, all ids present',
    await evaluate(`(() => { const s = document.querySelector('.scene')
      return s.offsetWidth === 960 && s.offsetHeight === 640 &&
        ['table-a','table-b','table-c','table-d','table-ours','table-quiet','bar','bartender',
         'door-wc','door-exit','player','dialogue'].every(i => !!document.getElementById(i)) })()`))
  rec('12. G holds exactly the specified flags',
    await evaluate(`JSON.stringify(Object.keys(G))`) === JSON.stringify([
      'visitedToilet', 'foundNote', 'decodedSOS', 'tableBUnlocked', 'solvedBinary',
      'tableDConfirmed', 'waiterFirstVisit', 'waiterHintGiven', 'tableCVisited',
      'patioUnlocked', 'patioEntered', 'foundPhone', 'crackedNoteApp', 'crackedChatApp']))
}

// ══════════════════════════════════════════
// no page errors anywhere in the run
// ══════════════════════════════════════════
const errs = consoleLogs.filter((l) => l.startsWith('[PAGE EXCEPTION]') || l.startsWith('[error]'))
rec('ERR. no uncaught exceptions or console errors', errs.length === 0, JSON.stringify(errs.slice(0, 5)))
const warns = consoleLogs.filter((l) => l.startsWith('[warning]'))
rec('ERR. only the expected door-exit warning was emitted',
  warns.every((l) => l.includes('No dialogue defined for: door-exit')), JSON.stringify(warns.slice(0, 5)))

// ── report ──
await resetG()
await setG({ solvedBinary: true, tableDConfirmed: true, tableCVisited: true })
await evaluate(`openDialogue('bar')`)
await sleep(2500)
const shot = await pageSend('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${ROOT}/.qwen/tmp/phase4-hint.png`, Buffer.from(shot.data, 'base64'))

const failed = results.filter((r) => !r.pass)
console.log('\n' + results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${!r.pass ? '  :: ' + r.info : ''}`).join('\n'))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name} :: ${f.info}`)) }

browserWs.close()
chrome.kill()
process.exit(failed.length ? 1 : 0)
