import { spawn } from 'node:child_process'
const ROOT='/Users/dario.martinovski/murder-mystery'
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--hide-scrollbars','--remote-debugging-port=9363','--window-size=1060,760','--allow-file-access-from-files',`file://${ROOT}/index.html`],{stdio:['ignore','ignore','pipe']})
let buf='';chrome.stderr.on('data',d=>{buf+=d.toString()})
let wsUrl;for(let i=0;i<100&&!wsUrl;i++){wsUrl=(buf.match(/DevTools listening on (ws:\/\/\S+)/)||[])[1];if(!wsUrl)await sleep(100)}
const ws=new WebSocket(wsUrl);await new Promise(r=>{ws.onopen=r})
let id=0;const wait=new Map()
ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){const{res,rej}=wait.get(m.id);wait.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}}
const send=(m,p={},s)=>new Promise((res,rej)=>{const i=++id;wait.set(i,{res,rej});ws.send(JSON.stringify(s?{sessionId:s,id:i,method:m,params:p}:{id:i,method:m,params:p}))})
const {targetId}=await send('Target.createTarget',{url:`file://${ROOT}/index.html`})
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
const p=(m,pr={})=>send(m,pr,sessionId)
const ev=async e=>{const r=await p('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
await p('Page.enable');await p('Runtime.enable');await sleep(1200)

const measure = (label, setup) => ev(`(async () => {
  ${setup}
  let frames = 0, run = true
  const tick = () => { frames++; if (run) requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const t0 = performance.now()
  await new Promise(r => setTimeout(r, 2000))
  run = false
  return Math.round(frames / 2)
})()`)

console.log('panel CLOSED, nothing animating      :', await measure('a', `closeDialogue(); document.getElementById('player').classList.remove('player--moving')`), 'fps')
console.log('panel CLOSED, player bobbing         :', await measure('b', `document.getElementById('player').classList.add('player--moving')`), 'fps')
console.log('panel OPEN,   nothing animating      :', await measure('c', `document.getElementById('player').classList.remove('player--moving'); openDialogue('table-a')`), 'fps')
console.log('panel OPEN,   player bobbing (blur)  :', await measure('d', `document.getElementById('player').classList.add('player--moving')`), 'fps')
console.log('panel OPEN,   bobbing, blur DISABLED :', await measure('e', `document.querySelector('.dialogue').style.backdropFilter='none'; document.getElementById('inventory').style.backdropFilter='none'`), 'fps')
ws.close();chrome.kill();process.exit(0)
