/** Origin-local notifications containing a scope only; never credentials or content. */
export function createScopedChanges(eventName:string,channelName:string){
let channel:BroadcastChannel|undefined
const hasBrowserEvents=()=>typeof window!=='undefined'&&typeof window.addEventListener==='function'&&typeof window.dispatchEvent==='function'
function receive(value:unknown){
 const notice=value as {schema?:number;scope?:unknown}|null
 if(notice?.schema===1&&typeof notice.scope==='string'&&notice.scope.length>0&&notice.scope.length<=512)dispatch(notice.scope)
}
function dispatch(scope:string){window.dispatchEvent(new CustomEvent(eventName,{detail:{scope}}))}
function connect(){
 if(!hasBrowserEvents()||channel||typeof BroadcastChannel==='undefined')return
 try{
  channel=new BroadcastChannel(channelName)
  channel.onmessage=event=>receive(event.data)
 }catch{channel=undefined}
}
connect()
if(hasBrowserEvents()){
 window.addEventListener('storage',event=>{if(event.key===channelName&&event.newValue){try{receive(JSON.parse(event.newValue))}catch{}}})
 window.addEventListener('pagehide',()=>{channel?.close();channel=undefined})
 window.addEventListener('pageshow',connect)
}
return function notify(scope:string){
 if(!hasBrowserEvents())return
 dispatch(scope)
 connect()
 try{
  if(channel)channel.postMessage({schema:1,scope})
  else{localStorage.setItem(channelName,JSON.stringify({schema:1,scope}));localStorage.removeItem(channelName)}
 }catch{/* Local changes do not depend on notification delivery. */}
}

}
