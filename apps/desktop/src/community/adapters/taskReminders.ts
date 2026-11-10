import {reactive} from 'vue'
import type {TaskEntity} from '@note-flow/core/contracts'
import {createCommunityReminderService,communityTaskReminders} from '../reminderService'
import {createCommunityReminderPlatform} from '../platformReminders'
import {communityProfileId} from '../runtime'
import {useNotificationsStore} from '../../stores/notifications'
export const communityReminderStatus=reactive({error:'',description:'',permission:'prompt'})
let service:ReturnType<typeof createCommunityReminderService>|undefined
function notify(title:string,message:string,key:string,taskUid?:string){
 // The original App mounts Pinia before it requests its first local task list.
 useNotificationsStore().add({kind:'task',title,message,target:'/tasks',query:taskUid?{task:taskUid}:undefined,dedupeKey:key})
}
export function reportCommunityReminderFailure(source:unknown){const message=source instanceof Error?source.message:'本地提醒设置失败';communityReminderStatus.error=message;try{notify('任务已保存，提醒需要处理',message,`community-reminder-error:${communityProfileId()}:${message}`)}catch{/* Status remains available even if the notification store itself cannot persist. */}}
const report=reportCommunityReminderFailure
function reminders(){if(!service){const platform=createCommunityReminderPlatform(value=>notify('任务时间已到',value.body,`community-reminder:${value.key}`,value.taskUid));service=createCommunityReminderService(platform);communityReminderStatus.description=service.description}return service}
export async function clearDesktopTaskReminders(_owner=communityProfileId()){try{await reminders().clear();communityReminderStatus.error=''}catch(error){report(error)}}
export async function ensureDesktopReminderPermission(){try{const value=await reminders().enable();communityReminderStatus.permission=value;if(value!=='granted'){report(Error(`系统提醒权限未开启。${reminders().description}`));return false}communityReminderStatus.error='';return true}catch(error){report(error);return false}}
/** Reminder failures are visible side effects and never change the result of a committed local task write. */
export async function reconcileDesktopTaskReminders(tasks:TaskEntity[],profileOrOptions:string|{requestPermission?:boolean}=communityProfileId()){
 const profileId=typeof profileOrOptions==='string'?profileOrOptions:communityProfileId()
 if(profileId!==communityProfileId())return
 if(typeof profileOrOptions==='object'&&profileOrOptions.requestPermission)await ensureDesktopReminderPermission()
 if(profileId!==communityProfileId())return
 try{
  const current=reminders(),permission=await current.permission();communityReminderStatus.permission=permission
  if(profileId!==communityProfileId())return
  await current.reconcile(profileId,tasks)
  if(communityTaskReminders(profileId,tasks).length&&permission!=='granted')report(Error(`系统提醒权限未开启。${current.description}`))
  else communityReminderStatus.error=''
 }catch(error){report(error)}
}
export function disposeCommunityTaskReminders(){service?.dispose();service=undefined}
