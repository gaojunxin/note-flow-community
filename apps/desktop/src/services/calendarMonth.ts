import {calendarDate,type LoadedReviewData,type ReviewEvent} from './reviewData'
import {effectiveTaskDate} from '../tasks/taskExperience'
import {chinaHoliday} from './chinaHolidays'
import type {TaskEntity} from './tasks'
export const localDayKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
export function isoWeekNumber(date:Date){
 const thursday=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()))
 thursday.setUTCDate(thursday.getUTCDate()+4-(thursday.getUTCDay()||7))
 const first=new Date(Date.UTC(thursday.getUTCFullYear(),0,1))
 return Math.ceil(((thursday.getTime()-first.getTime())/86400000+1)/7)
}
export function calendarMonthDays(anchor:Date){
 const first=new Date(anchor.getFullYear(),anchor.getMonth(),1),start=new Date(first)
 start.setDate(1-(first.getDay()+6)%7)
 return Array.from({length:42},(_,index)=>{const date=new Date(start);date.setDate(start.getDate()+index);const key=localDayKey(date);return{key,date,current:date.getMonth()===first.getMonth(),holiday:chinaHoliday(key)}})
}
export interface CalendarActivity {tasks:TaskEntity[];events:ReviewEvent[];focusMinutes:number;logs:number}
export function calendarActivities(data:LoadedReviewData,timezone:string,areaUid=''){
 const result=new Map<string,CalendarActivity>()
 const day=(key:string)=>{let row=result.get(key);if(!row){row={tasks:[],events:[],focusMinutes:0,logs:0};result.set(key,row)}return row}
 for(const task of data.tasks||[]){
  if(task.deleted||task.abandonedAt||areaUid&&task.areaUid!==areaUid)continue
  const value=effectiveTaskDate(task),key=value?calendarDate(value,timezone):''
  if(key)day(key).tasks.push(task)
 }
 for(const event of data.events){
  if(event.kind==='note_created')continue
  const key=calendarDate(event.occurredAt,timezone);if(!key)continue
  const row=day(key);row.events.push(event)
  if(event.kind==='focus')row.focusMinutes+=Math.max(0,Number((event.source as {actualSeconds?:number}).actualSeconds)||0)/60
  if(['log_record','periodic_record','project_log'].includes(event.kind))row.logs++
 }
 return result
}
