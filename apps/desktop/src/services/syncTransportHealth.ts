export type SyncTransportStage='push'|'pull'|'bootstrap'|'ack'
export interface SyncTransportDay {day:string;stage:SyncTransportStage;requests:number;failed:number;partial:number;conflicts:number;totalMs:number;maxMs:number}
const stages=['push','pull','bootstrap','ack'],fields=['requests','failed','partial','conflicts','totalMs','maxMs'] as const
export function createSyncTransportHealth(storage:{getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void},now=()=>Date.now()){
 const key=(scope:string)=>'note-flow-sync-health:v1:'+scope
 function read(scope:string):SyncTransportDay[]{
  try{const raw=storage.getItem(key(scope));if(!raw||raw.length>64_000)return[];const rows=JSON.parse(raw);if(!Array.isArray(rows))return[];const oldest=new Date(now()-29*86400_000).toISOString().slice(0,10),today=new Date(now()).toISOString().slice(0,10)
   return rows.filter(row=>row&&/^\d{4}-\d{2}-\d{2}$/.test(row.day)&&row.day>=oldest&&row.day<=today&&stages.includes(row.stage)&&fields.every(field=>Number.isSafeInteger(row[field])&&row[field]>=0)).slice(-120).map(row=>({day:row.day,stage:row.stage,...Object.fromEntries(fields.map(field=>[field,row[field]]))}) as SyncTransportDay)
  }catch{return[]}
 }
 return {read,clear:(scope:string)=>{try{storage.removeItem(key(scope))}catch{}},record(scope:string,event:{stage:SyncTransportStage;durationMs:number;outcome:'success'|'failed'|'partial';conflicts?:number}){
  try{if(!scope||!stages.includes(event.stage))return false;const rows=read(scope),day=new Date(now()).toISOString().slice(0,10);let row=rows.find(value=>value.day===day&&value.stage===event.stage);if(!row){row={day,stage:event.stage,requests:0,failed:0,partial:0,conflicts:0,totalMs:0,maxMs:0};rows.push(row)}
   const duration=Number.isFinite(event.durationMs)?Math.round(Math.min(86400_000,Math.max(0,event.durationMs))):0
   row.requests++;if(event.outcome==='failed')row.failed++;if(event.outcome==='partial')row.partial++;row.conflicts+=Number.isSafeInteger(event.conflicts)&&event.conflicts!>0?Math.min(event.conflicts!,10_000):0;row.totalMs+=duration;row.maxMs=Math.max(row.maxMs,duration);storage.setItem(key(scope),JSON.stringify(rows));return true
  }catch{return false}
 }}
}
export const syncTransportHealth=createSyncTransportHealth({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)})
