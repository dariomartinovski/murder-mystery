import { spawn } from 'node:child_process'
const ROOT='/Users/dario.martinovski/murder-mystery'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--remote-debugging-port=9345','--window-size=1060,760','--allow-file-access-from-files',`file://${ROOT}/index.html`],{stdio:['ignore','ignore','pipe']})
let buf='';chrome.stderr.on('data',d=>{buf+=d.toString()})
let wsUrl;for(let i=0;i<100&&!wsUrl;i++){wsUrl=(buf.match(/DevTools listening on (ws:\/\/\S+)/)||[])[1];if(!wsUrl)await sleep(100)}
const ws=new WebSocket(wsUrl);await new Promise(r=>{ws.onopen=r})
let id=0;const wait=new Map()
ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){const{res,rej}=wait.get(m.id);wait.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}
  else if(m.method==='Runtime.exceptionThrown')console.log('EXCEPTION:',m.params.exceptionDetails.exception?.description)}
const send=(m,p={},s)=>new Promise((res,rej)=>{const i=++id;wait.set(i,{res,rej});ws.send(JSON.stringify(s?{sessionId:s,id:i,method:m,params:p}:{id:i,method:m,params:p}))})
const {targetId}=await send('Target.createTarget',{url:`file://${ROOT}/index.html`})
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},sessionId)).result.value
await send('Runtime.enable',{},sessionId)
await sleep(2500)
console.log('loading:', await ev(`(() => { const l = document.getElementById('loading-screen')
  return { hidden: l.classList.contains('loading-screen--hidden'), display: getComputedStyle(l).display, pe: getComputedStyle(l).pointerEvents } })()`))
console.log('narration lines before click:', await ev(`document.querySelectorAll('.narration__line').length`))
const c = await ev(`(() => { const r = document.getElementById('narration').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 } })()`)
console.log('click at', c)
console.log('elementFromPoint:', await ev(`(() => { const el = document.elementFromPoint(${c.x}, ${c.y}); return el ? (el.id || el.className) : 'none' })()`))
const mouse=(t,x,y,b='left',cc=0)=>send('Input.dispatchMouseEvent',{type:t,x,y,button:b,clickCount:cc,buttons:t==='mousePressed'?1:0},sessionId)
await mouse('mouseMoved',c.x,c.y); await sleep(30); await mouse('mousePressed',c.x,c.y,'left',1); await mouse('mouseReleased',c.x,c.y,'left',1)
await sleep(400)
console.log('lines after 1st click:', await ev(`document.querySelectorAll('.narration__line').length`), 'idx:', await ev(`narrationLineIdx`))
await mouse('mousePressed',c.x,c.y,'left',1); await mouse('mouseReleased',c.x,c.y,'left',1)
await sleep(1200)
console.log('narrationActive after 2nd click:', await ev(`narrationActive`), 'gone:', await ev(`document.getElementById('narration').classList.contains('narration--gone')`))
console.log('restaurant visibility:', await ev(`getComputedStyle(document.getElementById('screen-restaurant')).visibility`))
console.log('audioCtx:', await ev(`audioCtx !== null`))
ws.close();chrome.kill();process.exit(0)
