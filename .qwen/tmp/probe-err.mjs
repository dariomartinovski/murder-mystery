import { spawn } from 'node:child_process'
const ROOT='/Users/dario.martinovski/murder-mystery'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--remote-debugging-port=9344','--window-size=1060,760','--allow-file-access-from-files',`file://${ROOT}/index.html`],{stdio:['ignore','ignore','pipe']})
let buf='';chrome.stderr.on('data',d=>{buf+=d.toString()})
let wsUrl;for(let i=0;i<100&&!wsUrl;i++){wsUrl=(buf.match(/DevTools listening on (ws:\/\/\S+)/)||[])[1];if(!wsUrl)await sleep(100)}
const ws=new WebSocket(wsUrl);await new Promise(r=>{ws.onopen=r})
let id=0;const wait=new Map()
ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){const{res,rej}=wait.get(m.id);wait.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}
  else if(m.method==='Runtime.consoleAPICalled')console.log('CONSOLE['+m.params.type+']',m.params.args.map(a=>a.value??a.description).join(' '))
  else if(m.method==='Runtime.exceptionThrown')console.log('EXCEPTION:',m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)
  else if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')console.log('LOGERR:',m.params.entry.text,m.params.entry.url||'')}
const send=(m,p={},s)=>new Promise((res,rej)=>{const i=++id;wait.set(i,{res,rej});ws.send(JSON.stringify(s?{sessionId:s,id:i,method:m,params:p}:{id:i,method:m,params:p}))})
const {targetId}=await send('Target.createTarget',{url:`file://${ROOT}/index.html`})
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
await send('Runtime.enable',{},sessionId);await send('Log.enable',{},sessionId);await send('Network.enable',{},sessionId)
await sleep(4000)
console.log('scripts loaded:', JSON.stringify(await send('Runtime.evaluate',{expression:`[...document.scripts].map(s=>({src:s.src.split('/').pop(), ok:!s.src||!!s}))`,returnByValue:true},sessionId)).slice(0,400))
console.log('globals:', JSON.stringify(await send('Runtime.evaluate',{expression:`({hasG:typeof G, hasNODES:typeof NODES, hasShowNarration:typeof showNarration, hasMoveTo:typeof moveTo, hasInit:typeof initGame, narrActive:typeof narrationActive!=='undefined'?narrationActive:'undef'})`,returnByValue:true},sessionId)))
ws.close();chrome.kill();process.exit(0)
