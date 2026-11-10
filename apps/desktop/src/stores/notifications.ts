import { defineStore } from 'pinia'
import { tasksService } from '../services/tasks'
import { useAuthStore } from './auth'
import { activeProfileId } from '../services/profiles'
import api from '../services/api'
import { getDesktopServerUrl, isDesktopClient } from '../services/serverConfig'
import { createNotificationClient, type NotificationRecord } from '../../../../packages/core/src/notifications/client.js'

import {notificationStorageKey, legacyNotificationStorageKey, type PcNotification} from '../services/notificationPersistence'
export type {NotificationTarget, PcNotification} from '../services/notificationPersistence'

// v2 intentionally invalidates legacy reminders that survived account data reset.
const storageKey = () => notificationStorageKey(getDesktopServerUrl() || location.origin, activeProfileId(useAuthStore().user?.userId || 'anonymous'))
const remoteEnabled = () => Boolean(useAuthStore().user && import.meta.env.VITE_NOTE_FLOW_EDITION !== 'community')
const center = createNotificationClient({storage:localStorage,scope:()=>`${getDesktopServerUrl() || location.origin}:${storageKey()}`,api,enabled:remoteEnabled})
const asPc = (item:NotificationRecord):PcNotification => ({id:item.id,kind:item.kind as PcNotification['kind'],title:item.title,message:item.message,createdAt:item.createdAt,read:Boolean(item.readAt),target:'/tasks',query:{task:item.targetUid || ''},dedupeKey:item.eventKey,archivedAt:item.archivedAt,targetState:item.targetState})
export const notificationEventWasRead=(key:string)=>center.load().some(item=>item.eventKey===key&&(item.readAt||item.targetState&&item.targetState!=='active'))
const parseDate = (value?: string | null) => value ? new Date(value.replace(' ', 'T')) : null

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({ items: [] as PcNotification[], remoteUnread:0,loading: false,error:'',nextBefore:'',filter:'all' as 'all'|'unread'|'task'|'notice'|'archive' }),
  getters: { unread: state => state.remoteUnread+state.items.filter(item => !/^\d+$/.test(item.id)&&!item.read&&!item.archivedAt).length,visible:state=>state.items.filter(item=>state.filter==='archive'?item.archivedAt:!item.archivedAt&&(state.filter==='all'||state.filter==='unread'&&!item.read||item.kind===state.filter)) },
  actions: {
    load() {
      try { const legacy=legacyNotificationStorageKey(activeProfileId(useAuthStore().user?.userId || 'anonymous'));const raw=localStorage.getItem(storageKey())||localStorage.getItem(legacy)||'[]';const parsed=JSON.parse(raw);this.items=Array.isArray(parsed)?parsed:[];if(!localStorage.getItem(storageKey())&&localStorage.getItem(legacy)){this.persist();localStorage.removeItem(legacy)} }
      catch { this.items = [] }
      this.mergeRemote(center.load())
    },
    mergeRemote(rows:NotificationRecord[]) {
      this.remoteUnread=center.unread()
      const local=this.items.filter(item=>!/^\d+$/.test(item.id));this.items=[...rows.map(asPc),...local].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));this.persist()
    },
    async refreshRemote() { const scope=storageKey(),before=JSON.stringify(center.load().map(item=>[item.id,item.readAt,item.targetState]));try { const rows=await center.refresh();if(scope===storageKey()){this.mergeRemote(rows);this.nextBefore=center.nextBefore();this.error='';if(isDesktopClient()&&before!==JSON.stringify(rows.map(item=>[item.id,item.readAt,item.targetState])))void tasksService.list().catch(()=>{})} } catch { this.error='消息暂未同步，联网后会重试' } },
    async loadMore(){try{this.mergeRemote(await center.refresh({before:this.nextBefore}));this.nextBefore=center.nextBefore()}catch{this.error='历史消息加载失败'}},
    async archive(id:string){try{if(/^\d+$/.test(id)){await center.archive([id]);this.mergeRemote(center.load())}else{const item=this.items.find(item=>item.id===id);if(item)item.archivedAt=new Date().toISOString();this.persist()}}catch{this.error='归档失败，请重试'}},
    persist() { localStorage.setItem(storageKey(), JSON.stringify(this.items.slice(0, 100))) },
    clear() { center.clear();this.items = [];this.remoteUnread=0;this.nextBefore='';localStorage.removeItem(storageKey()) },
    add(input: Omit<PcNotification, 'id' | 'createdAt' | 'read'>) {
      if (input.dedupeKey && this.items.some(item => item.dedupeKey === input.dedupeKey)) return
      this.items.unshift({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), read: false });this.items=this.items.slice(0,100)
      this.persist()
    },
    markRead(id: string) { if(/^\d+$/.test(id))center.markRead([id]);this.remoteUnread=center.unread();const item = this.items.find(value => value.id === id); if (item) item.read = true; this.persist() },
    markAllRead() { center.markRead(this.items.filter(item=>/^\d+$/.test(item.id)&&!item.read&&!item.archivedAt).map(item=>item.id));this.remoteUnread=center.unread();this.items.filter(item=>!item.archivedAt).forEach(item => { item.read = true }); this.persist() },
    async refreshTaskAlerts() {
      this.loading = true
      try {
        const now = new Date(), tomorrow = new Date(now.getTime() + 86_400_000)
        for (const task of await tasksService.list()) {
          const due = parseDate(task.dueAt)
          if (task.completed || task.abandonedAt || !due) continue
          if(remoteEnabled()){if(due<=tomorrow)await api.post('/notifications/task',{targetUid:task.uid,phase:due<now?'overdue':'due'});continue}
          if (due < now) this.add({ kind: 'task', title: '任务已逾期', message: task.title, target: '/tasks', query: { filter: 'overdue' }, dedupeKey: `overdue:${task.uid}:${task.dueAt}` })
          else if (due <= tomorrow) this.add({ kind: 'task', title: '任务即将到期', message: `${task.title} · ${due.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`, target: '/tasks', query: { task: task.uid }, dedupeKey: `due:${task.uid}:${task.dueAt}` })
        }
      } catch { /* 任务页面会呈现连接错误，通知中心不重复报错 */ }
      finally { await this.refreshRemote();this.loading = false }
    }
  }
})
