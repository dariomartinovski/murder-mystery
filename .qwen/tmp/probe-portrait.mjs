import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const ROOT='/Users/dario.martinovski/murder-mystery'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--hide-scrollbars','--remote-debugging-port=9347','--window-size=1060,760','--force-device-scale-factor=1','--allow-file-access-from-files',`file://${ROOT}/index.html`],{stdio:['ignore','ignore','pipe']})
let buf='';chrome.stderr.on('data',d=>{buf+=d.toString()})
let wsUrl;for(let i=0;i<100&&!wsUrl;i++){wsUrl=(buf.match(/DevTools listening on (ws:\/\/\S+)/)||[])[1];if(!wsUrl)await sleep(100)}
const ws=new WebSocket(wsUrl);await new Promise(r=>{ws.onopen=r})
let id=0;const wait=new Map()
ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){const{res,rej}=wait.get(m.id);wait.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}}
const send=(m,p={},s)=>new Promise((res,rej)=>{const i=++id;wait.set(i,{res,rej});ws.send(JSON.stringify(s?{sessionId:s,id:i,method:m,params:p}:{id:i,method:m,params:p}))})
const {targetId}=await send('Target.createTarget',{url:`file://${ROOT}/index.html`})
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},sessionId)).result.value
const mouse=(t,x,y,b='left',cc=0)=>send('Input.dispatchMouseEvent',{type:t,x,y,button:b,clickCount:cc,buttons:t==='mousePressed'?1:0},sessionId)
const click=async(x,y)=>{await mouse('mouseMoved',x,y);await sleep(25);await mouse('mousePressed',x,y,'left',1);await mouse('mouseReleased',x,y,'left',1)}
await send('Runtime.enable',{},sessionId)
await sleep(2500)
// dismiss intro
const nc=await ev(`(() => { const r=document.getElementById('narration').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
await click(nc.x,nc.y); await sleep(300); await click(nc.x,nc.y); await sleep(1200)
// open Goran's dialogue
await ev(`openDialogue('table-a')`)
await sleep(3000)
const shot1=await send('Page.captureScreenshot',{format:'png'},sessionId)
writeFileSync(`${ROOT}/.qwen/tmp/portrait-dialogue.png`,Buffer.from(shot1.data,'base64'))
// expand the portrait
const ac=await ev(`(() => { const r=document.getElementById('dialogue-avatar').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
await click(ac.x,ac.y); await sleep(1500)
const shot2=await send('Page.captureScreenshot',{format:'png'},sessionId)
writeFileSync(`${ROOT}/.qwen/tmp/portrait-lightbox.png`,Buffer.from(shot2.data,'base64'))
console.log('lightbox open:', await ev(`document.getElementById('portrait-lightbox').classList.contains('portrait-lightbox--open')`))
ws.close();chrome.kill();process.exit(0)
