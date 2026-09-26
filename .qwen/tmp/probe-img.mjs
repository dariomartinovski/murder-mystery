import { spawn } from 'node:child_process'
const ROOT='/Users/dario.martinovski/murder-mystery'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--remote-debugging-port=9348','--window-size=1060,760','--allow-file-access-from-files',`file://${ROOT}/index.html`],{stdio:['ignore','ignore','pipe']})
let buf='';chrome.stderr.on('data',d=>{buf+=d.toString()})
let wsUrl;for(let i=0;i<100&&!wsUrl;i++){wsUrl=(buf.match(/DevTools listening on (ws:\/\/\S+)/)||[])[1];if(!wsUrl)await sleep(100)}
const ws=new WebSocket(wsUrl);await new Promise(r=>{ws.onopen=r})
let id=0;const wait=new Map()
ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&wait.has(m.id)){const{res,rej}=wait.get(m.id);wait.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}}
const send=(m,p={},s)=>new Promise((res,rej)=>{const i=++id;wait.set(i,{res,rej});ws.send(JSON.stringify(s?{sessionId:s,id:i,method:m,params:p}:{id:i,method:m,params:p}))})
const {targetId}=await send('Target.createTarget',{url:`file://${ROOT}/index.html`})
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},sessionId)).result.value
await send('Runtime.enable',{},sessionId)
await send('Network.enable',{},sessionId)
await sleep(2000)
console.log(await ev(`(async () => {
  const out = {}
  out.base = document.baseURI
  out.resolved = new URL('assets/images/TableA.png', document.baseURI).href
  out.imgState = await new Promise(res => {
    const im = new Image()
    im.onload = () => res({ ok: true, w: im.naturalWidth, h: im.naturalHeight })
    im.onerror = (e) => res({ ok: false, err: 'error event' })
    im.src = 'assets/images/TableA.png'
    setTimeout(() => res({ ok: 'timeout' }), 5000)
  })
  out.resources = performance.getEntriesByType('resource').filter(r => r.name.includes('assets')).map(r => ({ n: r.name.split('/').pop(), size: r.transferSize, dur: Math.round(r.duration) }))
  return out
})()`))
ws.close();chrome.kill();process.exit(0)
