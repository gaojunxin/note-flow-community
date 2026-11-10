import {accountLifecycleRevision} from '../services/accountStorage'
import {clearWorkspaceDerivedIndexes} from '../services/workspaceDerivedReset'
import {clientOwnerScope} from '../services/clientContext'
import { requestLocalSync } from '../services/syncSignals'
import { defineStore } from 'pinia'
import type { NoteConflict, NoteEntity, SyncPhase } from '@note-flow/core'
import { createPcNotesService, restoreNote, updateNoteState } from '../services/notes'
import { useAuthStore } from './auth'
import { syncAvailable } from '../services/profiles'
import { isDesktopClient } from '../services/serverConfig'
import { runPcSyncGuarded } from '../services/syncResetGuard'
import {shouldSyncWorkspace} from '../services/syncReadiness'
import {trackSync,trackSyncCheck} from '../services/syncActivity'

let refreshPromise: Promise<void> | undefined
let syncPromise: Promise<void> | undefined
let savePromise: Promise<void> | undefined
const pendingSaves = new Map<string, Partial<NoteEntity>>()

export const useNotesStore = defineStore('notes', {
  state: () => ({ notes: [] as NoteEntity[], archived: [] as NoteEntity[], trash: [] as NoteEntity[], conflicts: [] as NoteConflict[], selectedUid: '', loading: false, refreshing: false, saving: false, savingUid: '', loadedAt: 0, loadedRevision: undefined as string|undefined, loadedScope:'', invalidated: false, localMutationRevision:0, error: '', saveError: '', syncError: '', syncPhase: 'idle' as SyncPhase }),
  getters: { selected: state => state.notes.find(note => note.uid === state.selectedUid) || state.archived.find(note => note.uid === state.selectedUid) || state.trash.find(note => note.uid === state.selectedUid) || null },
  actions: {
    syncEnabled() { return syncAvailable() && localStorage.getItem('note-flow-pc-sync-enabled') !== 'false' },
    service() {
      const userId = useAuthStore().user?.userId
      if (!userId) throw new Error('请先登录')
      return createPcNotesService(userId)
    },
    async load() {
      if (this.loadedAt && !this.invalidated && this.notes.length) { void this.refreshInBackground(); return }
      this.loading = true; this.error = ''
      try {
        const mutationRevision=this.localMutationRevision
        const values=await this.service().list()
        if(mutationRevision!==this.localMutationRevision){this.invalidated=true;return}
        this.notes=values
        this.loadedAt = Date.now(); this.invalidated = false
        if (!this.selectedUid || !this.notes.some(note => note.uid === this.selectedUid)) this.selectedUid = this.notes[0]?.uid || ''
      } catch (source) {
        this.error = source instanceof Error ? source.message : '笔记加载失败'
      } finally { this.loading = false; void this.refreshInBackground() }
    },
    invalidate() { this.invalidated = true },
    async reloadLocal() {
      const service=this.service(),mutationRevision=this.localMutationRevision,revision=accountLifecycleRevision(),scope=clientOwnerScope(String(useAuthStore().user?.userId||'local'))
      const change=await service.readRevision?.()
      if(this.loadedAt&&change!==undefined&&change===this.loadedRevision&&scope===this.loadedScope){this.invalidated=false;return}
      // Serialize scopes to avoid three concurrent full-body IPC responses.
      const notes=await service.list(),archived=await service.list('archived'),trash=await service.list('trash')
      if(revision!==accountLifecycleRevision()||scope!==clientOwnerScope(String(useAuthStore().user?.userId||'local')))return
      if(mutationRevision!==this.localMutationRevision){this.invalidated=true;return}
      this.$patch({notes,archived,trash,loadedAt:Date.now(),loadedRevision:change,loadedScope:scope,invalidated:false})
      if(!this.selected)this.selectedUid=notes[0]?.uid||''
    },
    async refreshInBackground() {
      if (!this.syncEnabled() || navigator.onLine === false) return
      if (refreshPromise) return refreshPromise
      this.refreshing = true
      refreshPromise = this.runSync({background:true}).finally(() => { this.refreshing = false; refreshPromise = undefined })
      return refreshPromise
    },
    async loadTrash() {
      try { this.trash = await this.service().list('trash') } catch { this.trash = [] }
    },
    async loadArchived() {
      try { this.archived = await this.service().list('archived') } catch { this.archived = [] }
    },
    select(uid: string) { this.selectedUid = uid },
    async create(scope: Partial<NoteEntity> = {},options:{select?:boolean;sync?:boolean;publish?:boolean}={}) {
      const revision=accountLifecycleRevision(),scopeKey=clientOwnerScope(String(useAuthStore().user?.userId||'local'))
      const note = await this.service().create({ title: '未命名笔记', content: '', organizationStatus: 'pending', captureSource: 'pc_editor', ...scope })
      if(revision!==accountLifecycleRevision()||scopeKey!==clientOwnerScope(String(useAuthStore().user?.userId||'local')))throw Error('账号或空间已切换，笔记已保存到原空间')
      this.localMutationRevision++
      if(options.publish!==false)this.notes.unshift(note)
      if(options.select!==false)this.selectedUid = note.uid
      if(options.sync!==false){requestLocalSync();void this.refreshInBackground()}
      return note
    },
    async save(changes: Partial<NoteEntity>) {
      const note=this.selected
      if (!note || note.deleted) return
      return this.saveNote(note.uid,changes)
    },
    async saveNote(uid:string,changes:Partial<NoteEntity>){
      const note=this.notes.find(item=>item.uid===uid)||this.archived.find(item=>item.uid===uid)||this.trash.find(item=>item.uid===uid)
      if(!note||note.deleted)return
      changes=Object.fromEntries(Object.entries(changes).filter(([key,value])=>key==='content'?String(value??'')!==String(note.content??''):JSON.stringify(value)!==JSON.stringify((note as any)[key]))) as Partial<NoteEntity>
      if(!Object.keys(changes).length&&!pendingSaves.has(uid))return
      const collection=note.status==='archived'?this.archived:this.notes,index=collection.findIndex(item=>item.uid===note.uid)
      if(index>=0)collection[index]={...collection[index],...changes}
      pendingSaves.set(note.uid,{...(pendingSaves.get(note.uid)||{}),...changes})
      if(savePromise)return savePromise
      this.saving=true;this.saveError=''
      savePromise=(async()=>{
        while(pendingSaves.size){
          const [uid,pending]=pendingSaves.entries().next().value as [string,Partial<NoteEntity>]
          pendingSaves.delete(uid);this.savingUid=uid
          const current=this.notes.find(item=>item.uid===uid)||this.archived.find(item=>item.uid===uid)||this.trash.find(item=>item.uid===uid)
          if(!current||current.deleted)continue
          try{const saved=await this.service().update({...current,...pending}),values=saved.status==='archived'?this.archived:this.notes,target=values.findIndex(item=>item.uid===uid);if(target>=0)values[target]={...saved,...(pendingSaves.get(uid)||{})}}
          catch(source){pendingSaves.set(uid,{...pending,...(pendingSaves.get(uid)||{})});this.saveError=source instanceof Error?source.message:'笔记保存失败';break}
        }
      })().finally(()=>{this.saving=false;this.savingUid='';savePromise=undefined;requestLocalSync()})
      return savePromise
    },
    async flushPendingSaves(){
      if(savePromise)await savePromise
      if(pendingSaves.size){const uid=pendingSaves.keys().next().value as string;await this.saveNote(uid,{})}
      if(pendingSaves.size)throw new Error(this.saveError||'本地笔记尚未保存，请重试')
    },
    hasPendingSaves(){return Boolean(savePromise||pendingSaves.size)},
    async updateEntity(note: NoteEntity, changes: Partial<NoteEntity>,options:{publish?:boolean}={}) {
      const saved = await this.service().update({ ...note, ...changes });requestLocalSync()
      if(options.publish===false)return saved
      this.notes=this.notes.filter(item=>item.uid!==saved.uid);this.archived=this.archived.filter(item=>item.uid!==saved.uid);this.trash=this.trash.filter(item=>item.uid!==saved.uid)
      if(saved.deleted)this.trash.unshift(saved);else if(saved.status==='archived')this.archived.unshift(saved);else this.notes.unshift(saved)
      return saved
    },
    async removeEntity(note: NoteEntity) {
      const removed = await this.service().remove(note);requestLocalSync()
      this.notes=this.notes.filter(item=>item.uid!==note.uid);this.archived=this.archived.filter(item=>item.uid!==note.uid);this.trash=this.trash.filter(item=>item.uid!==note.uid)
      this.trash.unshift(removed)
      if(this.selectedUid===note.uid)this.selectedUid=this.notes[0]?.uid||''
      return removed
    },
    async acceptServer(note: NoteEntity) {
      const localChange=isDesktopClient()&&(note.syncStatus==='pending'||note.syncStatus==='conflict')
      if(!localChange)await this.service().acceptServer(note)
      this.notes=this.notes.filter(item=>item.uid!==note.uid);this.archived=this.archived.filter(item=>item.uid!==note.uid);this.trash=this.trash.filter(item=>item.uid!==note.uid)
      const target = note.deleted ? this.trash : note.status==='archived'?this.archived:this.notes
      target.unshift({ ...note, syncStatus: localChange?note.syncStatus:'synced' })
    },
    async togglePinned(note: NoteEntity) {
      this.error = ''
      try { if(isDesktopClient())await this.updateEntity(note,{pinned:!note.pinned});else await this.acceptServer(await updateNoteState(note, { pinned: !note.pinned })) }
      catch (source) { this.error = source instanceof Error ? source.message : '收藏操作失败'; throw source }
    },
    async setOrganizationStatus(note: NoteEntity, organizationStatus: NonNullable<NoteEntity['organizationStatus']>) {
      const organizedAt = organizationStatus === 'organized' ? new Date().toISOString() : null
      if (isDesktopClient()) return this.updateEntity(note, { organizationStatus, organizedAt })
      const saved = await updateNoteState(note, { organizationStatus }); await this.acceptServer(saved); return saved
    },
    async removeSelected() {
      if (!this.selected) return
      await this.removeEntity(this.selected)
      void this.refreshInBackground()
      await this.loadTrash()
    },
    async restoreSelected() {
      if (!this.selected?.deleted) return
      if(isDesktopClient()){
        const restored=await this.service().update({...this.selected,deleted:false,status:'active'})
        this.trash=this.trash.filter(note=>note.uid!==restored.uid)
        this.notes.unshift(restored);this.selectedUid=restored.uid;void this.refreshInBackground();return
      }
      const restored = await restoreNote(this.selected)
      this.trash = this.trash.filter(note => note.uid !== restored.uid)
      await this.acceptServer({ ...restored, deleted: false })
      this.selectedUid = restored.uid
    },
    async restoreArchived(note:NoteEntity){return this.updateEntity(note,{status:'active'})},
    async purge(note:NoteEntity){await (this.service() as ReturnType<typeof this.service>&{purge:(value:NoteEntity)=>Promise<void>}).purge(note);this.trash=this.trash.filter(item=>item.uid!==note.uid);if(this.selectedUid===note.uid)this.selectedUid=this.trash[0]?.uid||''},
    async resetBrowserCache(){const service=this.service(),owner=String(useAuthStore().user?.userId||'local'),revision=accountLifecycleRevision(),assertCurrent=()=>{if(revision!==accountLifecycleRevision())throw Error('账号或空间已切换，已停止本机重建')};await clearWorkspaceDerivedIndexes(clientOwnerScope(owner));assertCurrent();await service.resetLocal();assertCurrent();this.notes=[];this.archived=[];this.trash=[];this.conflicts=[];this.selectedUid='';this.loadedAt=0;this.invalidated=true},
    async runSync(options:{background?:boolean;force?:boolean}={}):Promise<void> {
      if (!this.syncEnabled()) { this.syncPhase = 'idle'; return }
      if(syncPromise){
        const running=syncPromise
        if(!options.force)return running
        const revision=accountLifecycleRevision(),owner=clientOwnerScope(String(useAuthStore().user?.userId||'local'))
        await running
        if(revision!==accountLifecycleRevision()||owner!==clientOwnerScope(String(useAuthStore().user?.userId||'local')))return
        return this.runSync(options)
      }
      const revision=accountLifecycleRevision(),owner=clientOwnerScope(String(useAuthStore().user?.userId||'local'))
      const current=()=>revision===accountLifecycleRevision()&&owner===clientOwnerScope(String(useAuthStore().user?.userId||'local'))
      syncPromise=runPcSyncGuarded(async()=>{
        try {
          // 跳过检查不等于同步成功；旧错误只能由一次实际完成的同步清除。
          if(options.background && !options.force && !await shouldSyncWorkspace(String(useAuthStore().user?.userId||''),true))return
          if(!current())return
          this.syncPhase='syncing'
          let resultPhase:SyncPhase='idle'
          await (options.background?trackSyncCheck:trackSync)('同步笔记',()=>this.service().sync(phase=>{resultPhase=phase}))
          if(!current())return
          // 离线返回没有远端完成证据，不能借此清除上次失败。
          if((resultPhase as SyncPhase)==='offline'){this.syncPhase='offline';return}
          this.syncError=''
          this.syncPhase=resultPhase
        } catch(source) {
          if(current()){this.syncError=source instanceof Error?source.message:'同步暂未完成';this.syncPhase=navigator.onLine?'error':'offline'}
          return
        }
        // 远端同步已完成后的本机读取失败独立显示，不能反过来判定上传失败。
        try{await this.reloadLocal();await this.loadConflicts();if(current()&&this.conflicts.length)this.syncPhase='conflict'}
        catch(source){if(current())this.error=source instanceof Error?source.message:'同步后刷新笔记失败'}
      }).then(()=>undefined).finally(()=>{syncPromise=undefined})
      return syncPromise
    },
    async loadConflicts() {const revision=accountLifecycleRevision(),scope=clientOwnerScope(String(useAuthStore().user?.userId||'local')),rows=await this.service().conflicts();if(revision===accountLifecycleRevision()&&scope===clientOwnerScope(String(useAuthStore().user?.userId||'local')))this.conflicts=rows},
    async resolveConflict(conflictId: string, strategy: 'local' | 'server') {
      await this.service().resolveConflict(conflictId, strategy)
      this.notes = await this.service().list()
      await this.loadConflicts()
      if (strategy === 'local') await this.runSync()
    }
  }
})
