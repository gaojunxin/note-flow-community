import {taskReminderOccurrences,reminderOffsetLabel,type ReminderTask} from '@note-flow/core/reminders'

export interface CommunityReminder {key:string;profileId:string;taskUid:string;title:string;body:string;fireAtMs:number}
export type CommunityReminderPermission='granted'|'denied'|'prompt'|'unavailable'
export interface CommunityReminderPlatform {
 delivery:'foreground'|'app-running'|'system-scheduled'
 description:string
 permission(request:boolean):Promise<CommunityReminderPermission>
 replace(reminders:CommunityReminder[]):Promise<void>
 dispose():void
}
export function communityTaskReminders(profileId:string,tasks:ReminderTask[],now=Date.now()):CommunityReminder[]{
 if(!profileId)throw Error('提醒需要本地空间')
 const values=new Map<string,CommunityReminder>()
 for(const task of tasks){
  if(!task.uid)continue
  for(const occurrence of taskReminderOccurrences(task)){
   const fireAtMs=occurrence.fireAt.getTime()
   if(fireAtMs<now)continue
   const key=JSON.stringify([profileId,task.uid,fireAtMs,occurrence.offsetMinutes])
   values.set(key,{key,profileId,taskUid:task.uid,title:'迹语任务提醒',body:`${task.title||'未命名任务'} · ${reminderOffsetLabel(occurrence.offsetMinutes)}`,fireAtMs})
  }
 }
 return[...values.values()].sort((a,b)=>a.fireAtMs-b.fireAtMs||a.key.localeCompare(b.key))
}
/** All replacements are serialized so a stale profile cannot finish after a newer one. */
export function createCommunityReminderService(platform:CommunityReminderPlatform){
 let pending=Promise.resolve(),disposed=false
 const enqueue=<T>(work:()=>Promise<T>)=>{const next=pending.then(work);pending=next.then(()=>undefined,()=>undefined);return next}
 return{
  delivery:platform.delivery,description:platform.description,
  permission:()=>platform.permission(false),
  enable:()=>platform.permission(true),
  reconcile(profileId:string,tasks:ReminderTask[]){
   const reminders=communityTaskReminders(profileId,tasks)
   return enqueue(async()=>{if(disposed)return;await platform.replace(reminders)})
  },
  clear:()=>enqueue(async()=>{await platform.replace([])}),
  /** Stop the foreground host; Android OS alarms deliberately survive closing the app. */
  dispose(){disposed=true;platform.dispose()},
 }
}
