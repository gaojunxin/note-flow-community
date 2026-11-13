import { defineStore } from 'pinia'
import { tasksService } from '../services/tasks'
import { useAuthStore } from './auth'
import {accountLifecycleRevision} from '../services/accountStorage'
import { activeProfileId,syncAvailable } from '../services/profiles'
import api from '../services/api'
import { getDesktopServerUrl, isDesktopClient } from '../services/serverConfig'
import { createNotificationClient, type NotificationRecord } from '../../../../packages/core/src/notifications/client.js'

import {createNotificationCacheStorage} from '../services/notificationCacheStorage'
import {notificationStorageKey, legacyNotificationStorageKey, type PcNotification} from '../services/notificationPersistence'
export type {NotificationTarget, PcNotification} from '../services/notificationPersistence'

// v2 缓存身份隔离重置前的历史提醒，远端请求同时绑定账号生命周期。
const storageKey = () => notificationStorageKey(getDesktopServerUrl() || location.origin, activeProfileId(useAuthStore().user?.userId || 'anonymous'))
const captureNotificationContext=()=>{const key=storageKey(),revision=accountLifecycleRevision();return()=>key===storageKey()&&revision===accountLifecycleRevision()}
const remoteEnabled = () => Boolean(useAuthStore().user && syncAvailable() && import.meta.env.VITE_NOTE_FLOW_EDITION !== 'community')
const cache=createNotificationCacheStorage(()=>String(useAuthStore().user?.userId||'anonymous'))
const remoteKey=()=>`note-flow-notification-center-v1:${getDesktopServerUrl() || location.origin}:${storageKey()}`
const center = createNotificationClient({storage:cache,scope:()=>`${getDesktopServerUrl() || location.origin}:${storageKey()}`,api,enabled:remoteEnabled})
const asPc = (item:NotificationRecord):PcNotification => ({id:item.id,kind:item.kind as PcNotification['kind'],title:item.title,message:item.message,createdAt:item.createdAt,read:Boolean(item.readAt),target:'/tasks',query:{task:item.targetUid || ''},dedupeKey:item.eventKey,archivedAt:item.archivedAt,targetState:item.targetState})
export const notificationEventWasRead=(key:string)=>center.load().some(item=>item.eventKey===key&&(item.readAt||item.targetState&&item.targetState!=='active'))
const parseDate = (value?: string | null) => value ? new Date(value.replace(' ', 'T')) : null

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({ items: [] as PcNotification[], remoteUnread:0,loading: false,refreshing:false,refreshSequence:0,loadedContext:'',error:'',errorAction:'retry' as 'retry'|'settings'|'offline',nextBefore:'',filter:'all' as 'all'|'unread'|'task'|'notice'|'archive' }),
  getters: { unread: state => state.remoteUnread+state.items.filter(item => !/^\d+$/.test(item.id)&&!item.read&&!item.archivedAt).length,visible:state=>state.items.filter(item=>state.filter==='archive'?item.archivedAt:!item.archivedAt&&(state.filter==='all'||state.filter==='unread'&&!item.read||item.kind===state.filter)) },
  actions: {
    async load() {
      const context=`${storageKey()}:${accountLifecycleRevision()}`,own=storageKey()
      if(this.loadedContext!==context){this.refreshSequence++;this.refreshing=false;this.error='';this.remoteUnread=0;this.nextBefore='';this.items=[];this.loadedContext=context}
      await cache.prepare([own,remoteKey()])
      if(context!==`${storageKey()}:${accountLifecycleRevision()}`)return
      const legacy=legacyNotificationStorageKey(activeProfileId(useAuthStore().user?.userId || 'anonymous'))
      const raw=cache.getItem(own)||localStorage.getItem(legacy)||'[]'
      let parsed:unknown;try{parsed=JSON.parse(raw)}catch{throw Object.assign(Error('本机消息历史格式无效，原副本已保留'),{code:'NOTIFICATION_CACHE_READ'})}
      if(!Array.isArray(parsed))throw Object.assign(Error('本机消息历史格式无效，原副本已保留'),{code:'NOTIFICATION_CACHE_READ'})
      this.items=parsed
      if(!cache.getItem(own)&&localStorage.getItem(legacy)){await this.persist();if(localStorage.getItem(legacy)===raw)localStorage.removeItem(legacy)}
      // 从已提交快照重载；本机变更入口先使在途界面刷新失效，不能把失败的内存写入当作持久状态。
      await this.mergeRemote(center.reload())
    },
    async mergeRemote(rows:NotificationRecord[]) {
      this.remoteUnread=center.unread()
      const local=this.items.filter(item=>!/^\d+$/.test(item.id));this.items=[...rows.map(asPc),...local].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));await this.persist()
    },
    async refreshRemote(before?:string) {
      if(this.refreshing)return
      const initialization=this.load()
      // 本机空间和社区版没有远端消息服务，不把跳过请求显示为同步失败。
      const scope=storageKey(),lifecycle=accountLifecycleRevision(),sequence=++this.refreshSequence
      const current=()=>scope===storageKey()&&lifecycle===accountLifecycleRevision()&&sequence===this.refreshSequence
      this.refreshing=true;this.error='';this.errorAction='retry'
      try{
        await initialization
        if(!current())return
        if(!remoteEnabled()){this.error='';this.nextBefore='';return}
        const previous=JSON.stringify(center.load().map(item=>[item.id,item.readAt,item.targetState]))
        if(navigator.onLine===false)throw Error('NOTIFICATION_OFFLINE')
        const rows=await center.refresh(before?{before}:undefined)
        if(!current())return
        await this.mergeRemote(rows);this.nextBefore=center.nextBefore()
        if(isDesktopClient()&&previous!==JSON.stringify(rows.map(item=>[item.id,item.readAt,item.targetState])))void tasksService.list().catch(()=>{})
      }catch(source){
        if(!current())return
        const failure=source as {status?:number;code?:string;message?:string;name?:string;notificationStage?:string;cacheErrorName?:string;response?:{status?:number}}
        const http=Number(failure.status||failure.response?.status),business=Number(failure.code),status=http>=400?http:business
        if(failure.code==='NOTIFICATION_CACHE_READ')this.error='本机消息缓存读取或迁移失败，旧数据已保留；请检查客户端存储后重试'
        else if(failure.code==='NOTIFICATION_CACHE_WRITE'||failure.name==='QuotaExceededError'){
          const name=failure.cacheErrorName||failure.name
          this.error=name==='QuotaExceededError'?'客户端本机缓存配额已满（QuotaExceededError）；这不等同磁盘空间不足，请检查客户端存储'
            :name==='SecurityError'?'系统拒绝访问本机消息缓存（SecurityError），请检查客户端存储权限'
            :'本机消息缓存写入失败'+(name&&/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name)?`（${name}）`:'')+'；现有缓存保留，请检查客户端日志'
        }
        else if(failure.code==='NOTIFICATION_CACHE_SERIALIZE'){this.error='客户端无法序列化消息缓存；现有缓存保留，请检查客户端日志'}
        else if(failure.code==='NATIVE_RESPONSE_INVALID'||failure.code==='NATIVE_RESPONSE_BODY_FAILED'){this.error=`消息服务已响应（HTTP ${http||'未知'}），但客户端${failure.code==='NATIVE_RESPONSE_INVALID'?'无法解析消息数据':'读取响应正文失败'}，请重试或检查客户端日志`}
        else if(failure.code==='NOTIFICATION_RESPONSE_INVALID'){this.error='消息接口返回的数据格式不正确，请检查服务器版本与连接地址';this.errorAction='settings'}
        else if(status===401||failure.code==='AUTH_REQUIRED'){this.error='登录已失效，请重新连接账号后获取消息';this.errorAction='settings'}
        else if(status===403){this.error='当前账号无权访问消息中心，请检查账号权限';this.errorAction='settings'}
        else if(status===404){this.error='服务器未提供消息接口，请检查服务器版本与连接地址';this.errorAction='settings'}
        else if(navigator.onLine===false){this.error='当前离线，已保留本机消息；联网后会重试';this.errorAction='offline'}
        else if(failure.code==='ECONNABORTED'||failure.code==='ETIMEDOUT')this.error='消息请求超时，请稍后重试'
        else if(status>=400)this.error=`消息服务返回错误（${http>=400?'HTTP':'业务码'} ${status}）${failure.message?'：'+failure.message.slice(0,180):'，请稍后重试'}`
        else if(failure.notificationStage==='read-ack')this.error='消息已读状态提交失败，本机已读记录仍保留，请重试'
        else if(failure.name==='TypeError'||failure.name==='SyntaxError')this.error='消息响应处理失败，请检查客户端与服务器版本'
        else this.error='未能连接消息服务，请检查服务器连接后重试'
      }finally{if(current())this.refreshing=false}
    },
    async loadMore(){if(this.nextBefore)await this.refreshRemote(this.nextBefore)},
    async archive(id:string){const current=captureNotificationContext();try{this.refreshSequence++;this.refreshing=false;await this.load();if(!current())return;if(/^\d+$/.test(id)){await center.archive([id]);if(!current())return;await this.mergeRemote(center.load())}else{const item=this.items.find(item=>item.id===id);if(item)item.archivedAt=new Date().toISOString();await this.persist()}}catch{if(current())this.error='归档失败，请重试'}},
    async persist() { await cache.setItem(storageKey(), JSON.stringify(this.items.slice(0, 100))) },
    async clear() { const current=captureNotificationContext();await this.load();if(!current())return;this.refreshSequence++;this.refreshing=false;this.loading=false;await center.clear();if(!current())return;this.items=[];this.remoteUnread=0;this.nextBefore='';await this.persist();this.error='' },
    async add(input: Omit<PcNotification, 'id' | 'createdAt' | 'read'>) {
      const current=captureNotificationContext();try{this.refreshSequence++;this.refreshing=false;await this.load();if(!current())return;if(input.dedupeKey&&this.items.some(item=>item.dedupeKey===input.dedupeKey))return
       this.items.unshift({...input,id:crypto.randomUUID(),createdAt:new Date().toISOString(),read:false});await this.persist()
      }catch{if(current())this.error='本机消息保存失败，请检查客户端存储'}
    },
    async markRead(id:string){const current=captureNotificationContext();try{this.refreshSequence++;this.refreshing=false;await this.load();if(!current())return;if(/^\d+$/.test(id))await center.markRead([id]);if(!current())return;this.remoteUnread=center.unread();const item=this.items.find(item=>item.id===id);if(item)item.read=true;await this.persist()}catch{if(current())this.error='本机已读状态保存失败，请重试'}},
    async markAllRead(){const current=captureNotificationContext();try{this.refreshSequence++;this.refreshing=false;await this.load();if(!current())return;await center.markRead(this.items.filter(item=>/^\d+$/.test(item.id)&&!item.read&&!item.archivedAt).map(item=>item.id));if(!current())return;this.remoteUnread=center.unread();this.items.filter(item=>!item.archivedAt).forEach(item=>{item.read=true});await this.persist()}catch{if(current())this.error='本机已读状态保存失败，请重试'}},
    async refreshTaskAlerts() {
      this.loading = true
      try {
        const now = new Date(), tomorrow = new Date(now.getTime() + 86_400_000)
        for (const task of await tasksService.list()) {
          const due = parseDate(task.dueAt)
          if (task.completed || task.abandonedAt || !due) continue
          if(remoteEnabled()){if(due<=tomorrow)await api.post('/notifications/task',{targetUid:task.uid,phase:due<now?'overdue':'due'});continue}
          if (due < now) await this.add({ kind: 'task', title: '任务已逾期', message: task.title, target: '/tasks', query: { filter: 'overdue' }, dedupeKey: `overdue:${task.uid}:${task.dueAt}` })
          else if (due <= tomorrow) await this.add({ kind: 'task', title: '任务即将到期', message: `${task.title} · ${due.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`, target: '/tasks', query: { task: task.uid }, dedupeKey: `due:${task.uid}:${task.dueAt}` })
        }
      } catch { /* 任务页面会呈现连接错误，通知中心不重复报错 */ }
      finally { await this.refreshRemote();this.loading = false }
    }
  }
})
