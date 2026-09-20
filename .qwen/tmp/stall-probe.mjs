import { spawn } from 'node:child_process'
const ROOT='/Users/dario.martinovski/murder-mystery'
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--hide-scrollbars','--remote-debugging-port=9365','--window-size=1060,760','--allow-file-access-from-files',`file://${ROOT}/index.html`],{stdio:['ignore','ignore','pipe']})
let buf='';chrome.stderr.on('data',d=>{buf+=d.toString()})
let wsUrl;for(let i=0;i<100&&!wsUrl;i++){wsUrl=(buf.match(/DevTools listening on (ws:\/\/\S+)/)||[])[1];if(!wsUrl)await sleep(100)}
const ws=new WebSocket(wsUrl);await new Promise(r=>{ws.onopen=r})
let id=0;const wait=new Map()
ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){const{res,rej}=wait.get(m.id);wait.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}}
const send=(m,p={},s)=>new Promise((res,rej)=>{const i=++id;wait.set(i,{res,rej});ws.send(JSON.stringify(s?{sessionId:s,id:i,method:m,params:p}:{id:i,method:m,params:p}))
  setTimeout(()=>{if(wait.has(i)){wait.delete(i);rej(new Error('TIMEOUT 8s: '+m))}},8000)})
const {targetId}=await send('Target.createTarget',{url:`file://${ROOT}/index.html`})
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
const p=(m,pr={})=>send(m,pr,sessionId)
const step=async(label,expr)=>{const t=Date.now();try{const v=await p('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});console.log(`${String(Date.now()-t).padStart(6)}ms  ${label}  -> ${JSON.stringify(v&&v.value!==undefined?v.value:v).slice(0,80)}`)}catch(e){console.log(`${String(Date.now()-t).padStart(6)}ms  ${label}  -> ${e.message}`)}}
await p('Page.enable');await p('Runtime.enable');await sleep(1200)
const fps=`(() => new Promise(res => { let n=0,run=true; const t=()=>{n++;if(run)requestAnimationFrame(t)}; requestAnimationFrame(t); setTimeout(()=>{run=false;res(Math.round(n/1.5))},1500) }))()`
await step('baseline fps', fps)
await step('add note', `addToInventory('note'), inventory.length`)
await step('fps with slot', fps)
await step('open modal', `openItemModal('note'), document.getElementById('item-modal').classList.contains('item-modal--open')`)
await step('fps modal open', fps)
await step('close modal (escape on body)', `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})), document.getElementById('item-modal').classList.contains('item-modal--open')`)
await step('fps after close', fps)
await step('trivial evaluate', `1+1`)
await step('open dialogue too', `openDialogue('table-a'), dialogueState.open`)
await step('fps dialogue open', fps)
await step('close modal again w/ dialogue open', `openItemModal('note'), document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})), 'modal='+document.getElementById('item-modal').classList.contains('item-modal--open')+' dlg='+dialogueState.open`)
await step('fps after that', fps)
await step('trivial evaluate 2', `2+2`)
ws.close();chrome.kill();process.exit(0)
