import {afterEach,describe,it,expect,vi} from 'vitest'
import {communityTaskReminders,createCommunityReminderService} from '../src/community/reminderService'
import {createAndroidReminderPlatform,createRunningReminderPlatform} from '../src/community/platformReminders'
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
describe('community basic reminders',()=>{
 it('uses public wall-time/all-day rules and excludes resolved/deleted tasks',()=>{
  const task={uid:'one',title:'测试',dueAt:'2030-01-02',allDay:true,timezone:'Asia/Shanghai',reminderOffsetsMinutes:[0,10]}
  const now=Date.parse('2030-01-01T00:00:00Z')
  const reminders=communityTaskReminders('local',[task,{...task,uid:'done',completed:true},{...task,uid:'deleted',deleted:true}],now)
  expect(reminders.map(value=>value.fireAtMs)).toEqual([Date.parse('2030-01-02T00:50:00Z'),Date.parse('2030-01-02T01:00:00Z')]);expect(reminders.every(value=>value.profileId==='local'&&value.taskUid==='one')).toBe(true)
  expect(communityTaskReminders('local',[task,task],now)).toHaveLength(2)
 })
 it('delivers once while running, cancels replaced reminders and stops after disposal',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
  vi.stubGlobal('Notification',undefined)
  const due=vi.fn(),platform=createRunningReminderPlatform({onDue:due}),service=createCommunityReminderService(platform)
  const task={uid:'one',dueAt:'2030-01-01T00:00:02Z'}
  await service.reconcile('old',[task]);await service.reconcile('new',[]);await vi.advanceTimersByTimeAsync(3000);expect(due).not.toHaveBeenCalled()
  await service.reconcile('new',[{...task,dueAt:'2030-01-01T00:00:05Z'}]);await vi.advanceTimersByTimeAsync(2000);expect(due).toHaveBeenCalledTimes(1)
  await platform.replace([due.mock.calls[0][0]]);await vi.advanceTimersByTimeAsync(2000);expect(due).toHaveBeenCalledTimes(1)
  service.dispose();expect(vi.getTimerCount()).toBe(0);expect(platform.delivery).toBe('foreground')
 })
 it('replaces Android OS notifications without exact-alarm permission and retains alarms on close',async()=>{
  const plugin={checkPermissions:vi.fn(async()=>({display:'granted'})),requestPermissions:vi.fn(async()=>({display:'granted'})),getPending:vi.fn(async()=>({notifications:[{id:90}]})),cancel:vi.fn(async()=>{}),createChannel:vi.fn(async()=>{}),schedule:vi.fn(async()=>{})}
  const platform=createAndroidReminderPlatform(plugin),service=createCommunityReminderService(platform)
  expect(await service.enable()).toBe('granted')
  await service.reconcile('profile',[{uid:'task',dueAt:new Date(Date.now()+60000).toISOString()}])
  expect(plugin.cancel).toHaveBeenCalledWith({notifications:[{id:90}]})
  expect(plugin.schedule.mock.calls[0][0].notifications[0]).toMatchObject({isExactNotification:false,isExactMandatory:false,schedule:{allowWhileIdle:true},extra:{profileId:'profile',taskUid:'task'}})
  service.dispose();expect(plugin.cancel).toHaveBeenCalledTimes(1);expect(platform.delivery).toBe('system-scheduled')
 })
 it('cancels Android pending work even when permission is denied',async()=>{
  const plugin={checkPermissions:vi.fn(async()=>({display:'denied'})),requestPermissions:vi.fn(async()=>({display:'denied'})),getPending:vi.fn(async()=>({notifications:[{id:1}]})),cancel:vi.fn(async()=>{}),createChannel:vi.fn(async()=>{}),schedule:vi.fn(async()=>{})}
  const platform=createAndroidReminderPlatform(plugin)
  await platform.replace([{key:'one',profileId:'p',taskUid:'t',title:'任务',body:'任务',fireAtMs:Date.now()+60000}])
  expect(plugin.cancel).toHaveBeenCalledTimes(1);expect(plugin.schedule).not.toHaveBeenCalled();expect(await platform.permission(false)).toBe('denied');expect(plugin.requestPermissions).not.toHaveBeenCalled()
 })
 it('serializes native replacements so the latest profile wins',async()=>{
  let release!:()=>void
  const applied:string[]=[]
  const service=createCommunityReminderService({delivery:'system-scheduled',description:'test',permission:async()=> 'granted',dispose(){},async replace(values){if(values[0]?.profileId==='old')await new Promise<void>(resolve=>{release=resolve});applied.push(values[0]?.profileId||'empty')}})
  const old=service.reconcile('old',[{uid:'task',dueAt:'2099-01-01T00:00:00Z'}]);await Promise.resolve();const latest=service.reconcile('new',[]);release();await Promise.all([old,latest]);expect(applied).toEqual(['old','empty'])
 })
})
