import { spawn } from 'node:child_process'
const ROOT='/Users/dario.martinovski/murder-mystery'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--hide-scrollbars','--remote-debugging-port=9353','--window-size=1060,760','--force-device-scale-factor=1','--allow-file-access-from-files',`file://${ROOT}/index.html`],{stdio:['ignore','ignore','pipe']})
let buf='';chrome.stderr.on('data',d=>{buf+=d.toString()})
let wsUrl;for(let i=0;i<100&&!wsUrl;i++){wsUrl=(buf.match(/DevTools listening on (ws:\/\/\S+)/)||[])[1];if(!wsUrl)await sleep(100)}
const ws=new WebSocket(wsUrl);await new Promise(r=>{ws.onopen=r})
let id=0;const wait=new Map()
ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){const{res,rej}=wait.get(m.id);wait.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}
  else if(m.method==='Runtime.exceptionThrown')console.log('PAGE EXC:',m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)}
const send=(m,p={},s)=>new Promise((res,rej)=>{const i=++id;wait.set(i,{res,rej});ws.send(JSON.stringify(s?{sessionId:s,id:i,method:m,params:p}:{id:i,method:m,params:p}))})
const {targetId}=await send('Target.createTarget',{url:`file://${ROOT}/index.html`})
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},sessionId)).result.value
await send('Runtime.enable',{},sessionId)
await sleep(2500)
await ev(`(() => { const el = document.getElementById('narration'); el.click(); el.click() })()`)
await sleep(1200)
await ev(`G.crackedNoteApp = true; openPhoneModal()`)
await sleep(500)
await ev(`document.getElementById('phone-app-chat').click()`)
await sleep(300)
console.log('spy install:', await ev(`(() => { window.__cp = []; const orig = checkPin;
  window.checkPin = function () { try { const r = orig(); window.__cp.push('ok:' + pinBuffer) ; return r } catch (e) { window.__cp.push('threw:' + e.message) } };
  return typeof checkPin })()`))
for (const k of ['1','0','1','5']) { await ev(`document.querySelector('.phone-pin__key[data-key="${k}"]').click()`); await sleep(100) }
await sleep(800)
console.log('calls:', await ev(`window.__cp`), 'buffer:', await ev(`pinBuffer`), 'screen:', await ev(`phoneScreen`), 'cracked:', await ev(`G.crackedChatApp`))
console.log('direct checkPin:', await ev(`(function(){ try { checkPin(); return 'ran, cracked=' + G.crackedChatApp } catch(e){ return 'threw: ' + e.message } })()`))
ws.close();chrome.kill();process.exit(0)
