import {Capacitor,registerPlugin} from '@capacitor/core'
import type {CommunityReminder,CommunityReminderPermission,CommunityReminderPlatform} from './reminderService'

interface LocalNotificationsPlugin {
 checkPermissions():Promise<{display:string}>
 requestPermissions():Promise<{display:string}>
 getPending():Promise<{notifications:Array<{id:number}>}>
 cancel(input:{notifications:Array<{id:number}>}):Promise<void>
 createChannel(input:{id:string;name:string;importance:number;visibility:number;vibration:boolean}):Promise<void>
 schedule(input:{notifications:Array<{id:number;title:string;body:string;channelId:string;isExactNotification:boolean;isExactMandatory:boolean;schedule:{at:Date;allowWhileIdle:boolean};extra:{communityKey:string;taskUid:string;profileId:string}}>}):Promise<unknown>
}
type DesktopInvoke=(command:string,args:Record<string,unknown>)=>Promise<unknown>
type PlatformWindow=Window & {__TAURI_INTERNALS__?:unknown;__TAURI__?:{core?:{invoke?:DesktopInvoke}}}
const permissionValue=(value:string):CommunityReminderPermission=>value==='granted'?'granted':value==='denied'?'denied':'prompt'

/** Android uses the existing public Capacitor OS scheduler, with no server or push token. */
export function createAndroidReminderPlatform(plugin:LocalNotificationsPlugin=registerPlugin<LocalNotificationsPlugin>('LocalNotifications')):CommunityReminderPlatform{
 const channel='note-flow-community-tasks-v1'
 return{
  delivery:'system-scheduled',description:'Android 系统本地提醒；关闭页面后仍可提醒，系统省电可能延迟，强行停止应用后需重新打开。',
  async permission(request){return permissionValue((await(request?plugin.requestPermissions():plugin.checkPermissions())).display)},
  async replace(reminders){
   // This isolated community application owns all notifications in this plugin.
   const pending=await plugin.getPending()
   if(pending.notifications.length)await plugin.cancel({notifications:pending.notifications.map(({id})=>({id}))})
   if(!reminders.length||(await plugin.checkPermissions()).display!=='granted')return
   await plugin.createChannel({id:channel,name:'社区任务提醒',importance:4,visibility:0,vibration:true})
   const notifications=reminders.filter(value=>value.fireAtMs>Date.now()).map((value,index)=>({id:index+1,title:value.title,body:value.body,channelId:channel,isExactNotification:false,isExactMandatory:false,schedule:{at:new Date(value.fireAtMs),allowWhileIdle:true},extra:{communityKey:value.key,taskUid:value.taskUid,profileId:value.profileId}}))
   if(notifications.length)await plugin.schedule({notifications})
  },
  dispose(){},
 }
}

/** A running-page timer also survives desktop minimization; it cannot run after exit. */
export function createRunningReminderPlatform(options:{desktop?:DesktopInvoke;onDue?:(reminder:CommunityReminder)=>void;now?:()=>number;intervalMs?:number}={}):CommunityReminderPlatform{
 let reminders:CommunityReminder[]=[],timer:ReturnType<typeof setInterval>|undefined,disposed=false
 const delivered=new Set<string>(),now=options.now||Date.now
 const tick=()=>{
  if(disposed)return
  const instant=now(),due=reminders.filter(value=>value.fireAtMs<=instant)
  reminders=reminders.filter(value=>value.fireAtMs>instant)
  for(const reminder of due){
   if(delivered.has(reminder.key))continue
   delivered.add(reminder.key)
   options.onDue?.(reminder)
   if(options.desktop){void options.desktop('community_show_reminder',{title:reminder.title,body:reminder.body}).catch(()=>undefined)}
   else if(typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification(reminder.title,{body:reminder.body,tag:reminder.key})
  }
 }
 return{
  delivery:options.desktop?'app-running':'foreground',
  description:options.desktop?'桌面应用运行期间提供系统提醒；最小化可用，退出应用后不提醒。':'浏览器仅在此页面运行时提醒；关闭页面后不提醒，后台标签可能延迟。',
  async permission(request){
   if(options.desktop)return permissionValue(String(await options.desktop('community_reminder_permission',{request})))
   if(typeof Notification==='undefined')return'unavailable'
   return permissionValue(request?await Notification.requestPermission():Notification.permission)
  },
  async replace(values){if(disposed)return;reminders=values.filter(value=>!delivered.has(value.key));if(!timer)timer=setInterval(tick,options.intervalMs||1_000);tick()},
  dispose(){disposed=true;reminders=[];if(timer)clearInterval(timer)},
 }
}
export function createCommunityReminderPlatform(onDue?:(reminder:CommunityReminder)=>void):CommunityReminderPlatform{
 if(Capacitor.isNativePlatform())return createAndroidReminderPlatform()
 const platform=typeof window==='undefined'?undefined:window as PlatformWindow
 const desktop=platform?.__TAURI_INTERNALS__?platform.__TAURI__?.core?.invoke:undefined
 return createRunningReminderPlatform({desktop,onDue})
}
