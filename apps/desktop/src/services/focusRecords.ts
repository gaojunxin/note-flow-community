import {uniqueFocusRecords} from '@note-flow/core/focus-records'
import type {FocusSession} from './localPersonal'
export type FocusRecord=FocusSession&{deleted?:boolean;version?:number;updatedAt?:string;overlapped?:boolean}
export function focusDay(value:Date){return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`}
export function focusRange(from:string,to:string){
 const start=new Date(`${from}T00:00:00`),end=new Date(`${to}T00:00:00`)
 if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||focusDay(start)!==from||focusDay(end)!==to||start>end)throw Error('请选择有效的起止日期')
 end.setDate(end.getDate()+1)
 return{from:start.toISOString(),to:end.toISOString()}
}
export function filterFocusRecords(rows:FocusRecord[],range:{from:string;to:string},taskUid='',noteUid=''){
 const from=Date.parse(range.from),to=Date.parse(range.to),seen=new Set<string>()
 return uniqueFocusRecords(rows).filter(row=>{const started=Date.parse(row.startedAt);if(row.deleted||!row.uid||seen.has(row.uid)||!Number.isFinite(started)||started<from||started>=to||taskUid&&row.taskUid!==taskUid||noteUid&&row.noteUid!==noteUid)return false;seen.add(row.uid);return true}).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))
}
export function focusRecordSummary(rows:FocusRecord[]){
 const completed=uniqueFocusRecords(rows).filter(row=>row.sessionType==='focus'&&row.status==='completed'&&!row.deleted&&Number.isFinite(Date.parse(row.startedAt)))
 const totalSeconds=completed.reduce((sum,row)=>sum+(Number.isFinite(Number(row.actualSeconds))?Math.max(0,Number(row.actualSeconds)):0),0)
 return{totalSeconds,sessionCount:completed.length,activeDays:new Set(completed.map(row=>focusDay(new Date(row.startedAt)))).size}
}
export function focusDuration(seconds:number){const value=Number.isFinite(Number(seconds))?Math.max(0,Math.floor(Number(seconds))):0;if(value<60)return `${value} 秒`;const minutes=Math.floor(value/60);return minutes>=60?`${Math.floor(minutes/60)} 小时 ${minutes%60} 分`:`${minutes} 分 ${value%60?`${value%60} 秒`:''}`.trim()}
