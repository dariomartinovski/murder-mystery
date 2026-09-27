import { spawn } from 'node:child_process'
const ROOT='/Users/dario.martinovski/murder-mystery'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--hide-scrollbars','--remote-debugging-port=9352','--window-size=1060,760','--force-device-scale-factor=1','--allow-file-access-from-files',`file://${ROOT}/index.html`],{stdio:['ignore','ignore','pipe']})
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
const nc=await ev(`(() => { const r=document.getElementById('narration').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
await click(nc.x,nc.y); await sleep(300); await click(nc.x,nc.y); await sleep(1200)
// straight to the PIN screen
await ev(`G.crackedNoteApp = true; openPhoneModal()`)
await sleep(600)
await ev(`document.getElementById('phone-app-chat').click()`)
await sleep(400)
console.log('screen:', await ev(`phoneScreen`))
// synthetic clicks
for (const k of ['1','0','1','5']) {
  await ev(`document.querySelector('.phone-pin__key[data-key="${k}"]').click()`)
  await sleep(120)
  console.log('after syn', k, '->', await ev(`pinBuffer`), await ev(`phoneScreen`))
}
await sleep(900)
console.log('screen after synthetic 1015:', await ev(`phoneScreen`), 'cracked:', await ev(`G.crackedChatApp`))
// now real CDP taps on a fresh PIN screen
await ev(`phoneHomeBtn.click()`); await sleep(300)
await ev(`document.getElementById('phone-app-chat').click()`)   // cracked now -> renderChatApp
await sleep(300)
console.log('screen after home+chat:', await ev(`phoneScreen`))
ws.close();chrome.kill();process.exit(0)
