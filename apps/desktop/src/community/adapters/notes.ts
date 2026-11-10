import {toRaw} from 'vue'
import {createNoteHistory} from '../../services/noteHistory'
import {COMMUNITY_PROFILE_KEY} from '../workspace'
import type {NoteEntity, NoteScope, NoteListItem, NoteConflict, SyncPhase, LocalNoteSearchPage} from '@note-flow/core'
import type {LocalEntity, LocalRecord} from '@note-flow/core/community'
import {getCommunityWorkspace, ENTITY_REVISION,entityRevision} from '../runtime'
export {getCommunityWorkspace} from '../runtime'

const revision = ENTITY_REVISION
type LocalNote = NoteEntity

function plain<T>(value: T): T {
  if (!value || typeof value !== 'object' || value instanceof Blob || value instanceof Date) return value
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map(plain) as T
  if (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null) return raw
  return Object.fromEntries(Object.entries(raw).map(([key, item]) => [key, plain(item)])) as T
}
function expose(row: LocalRecord<LocalEntity>): LocalNote {
  return {...row.entity, deleted: row.deleted, [revision]: row.revision} as unknown as LocalNote
}
const unavailable = (message: string): never => {throw new Error(message)}

/** The original notes UI service contract backed only by community local storage. */
export function createPcNotesService(_userId?: string) {
  async function list(scope: NoteScope = 'active') {
    const workspace = await getCommunityWorkspace(), rows: LocalRecord<LocalEntity>[] = []
    let afterKey: string | undefined
    do {const page = await workspace.notes.list({includeDeleted: true, limit: 200, afterKey}); rows.push(...page.items); afterKey = page.nextKey} while (afterKey)
    return rows.filter(row => scope === 'trash' ? row.deleted : !row.deleted && (scope === 'archived' ? row.entity.status === 'archived' || row.entity.archived === true : row.entity.status !== 'archived' && row.entity.archived !== true))
      .map(expose).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  }
  async function expected(note: LocalNote) {
    const value=entityRevision(note)
    if (!value) throw new Error('笔记缺少本地修订，请重新加载后操作')
    return value
  }
  async function update(note: LocalNote,options?:unknown) {
    if(options)throw Error('社区版不提供AI工作区批量修改')
    const workspace = await getCommunityWorkspace(), value = plain(note) as unknown as LocalEntity
    const current = await workspace.notes.get(note.uid, true)
    if (!current) throw new Error('笔记不存在，请重新加载')
    const prior = await expected(note)
    value.version = Number(current.entity.version || 0) + 1
    if (current.revision !== prior) throw new Error('笔记已变化，请重新加载后操作')
    const assertCurrent = () => {if (localStorage.getItem(COMMUNITY_PROFILE_KEY) !== workspace.context.profileId) throw new Error('空间已切换，已停止笔记修改')}
    assertCurrent()
    await createNoteHistory(`community-${workspace.context.profileId}`).beforeChange(expose(current), note, current.deleted && note.deleted === false ? 'restore' : 'edit')
    assertCurrent()
    if (current.deleted && note.deleted === false) {
      // Restore and changes must be one CAS write, without a partial intermediate restore.
      return workspace.host.transaction(workspace.context, async tx => {
        const ref = {entityType: 'note', entityUid: note.uid}, now = new Date().toISOString()
        const entity = {...current.entity, ...value, deleted: false, updatedAt: now}
        const saved = await tx.put(ref, entity, prior)
        await tx.appendChange({...ref, profileId: workspace.context.profileId, changeId: crypto.randomUUID(), action: 'create', beforeRevision: prior, afterRevision: saved.revision, createdAt: now})
        return expose({entity, deleted: false, revision: saved.revision})
      })
    }
    return expose(await workspace.notes.update({...current.entity, ...value}, prior))
  }
  async function get(uid:string) {const row = await (await getCommunityWorkspace()).notes.get(uid, true); return row ? expose(row) : undefined}
  return {
    list,
    async readRevision():Promise<string|undefined>{return undefined},
    get,
    getForMutation:get,
    async failedSyncOperations():Promise<import('./failedSyncOperations').FailedSyncOperation[]>{return []},
    async retryFailedSyncOperation(_id:string):Promise<void>{throw Error('社区版不提供云端重试')},
    async workspaceUpdate(..._args:unknown[]):Promise<NoteEntity>{throw Error('社区版不提供AI工作区批量修改')},
    async listItems(scope: NoteScope = 'active', page = 1, size = 50): Promise<NoteListItem[]> {
      const limit = Math.max(1, Math.min(200, size)), offset = (Math.max(1, page) - 1) * limit
      return (await list(scope)).slice(offset, offset + limit).map(({content, ...note}) => ({...note, excerpt: String(note.summary || content || '').replace(/\s+/g, ' ').slice(0, 180)}))
    },
    async search(query: string, page = 1, size = 20): Promise<LocalNoteSearchPage> {
      const term = query.trim().toLocaleLowerCase(), current = Math.max(1, page), limit = Math.max(1, Math.min(200, size)), offset = (current - 1) * limit
      const matches = term ? (await list()).filter(note => `${note.title}\n${note.content}`.toLocaleLowerCase().includes(term)) : []
      return {items: matches.slice(offset, offset + limit).map(note => ({uid: note.uid, title: note.title, summary: note.content.slice(0, 240), updatedAt: note.updatedAt})), total: matches.length, page: current, size: limit, hasMore: offset + limit < matches.length}
    },
    async create(input: Partial<NoteEntity> & {title: string; content: string},_options?:{ifAbsent?:boolean}) {
      if(_options?.ifAbsent)throw Error('社区版不提供AI工作区幂等写入')
      return expose(await (await getCommunityWorkspace()).notes.create({status: 'active', version: 0, ...plain(input), deleted: false}))
    },
    update,
    async remove(note: LocalNote) {
      const workspace = await getCommunityWorkspace(), prior = await expected(note), current = await workspace.notes.get(note.uid, true)
      if (!current || current.revision !== prior) throw new Error('笔记已变化，请重新加载后操作')
      const assertCurrent = () => {if (localStorage.getItem(COMMUNITY_PROFILE_KEY) !== workspace.context.profileId) throw new Error('空间已切换，已停止笔记删除')}
      assertCurrent()
      await createNoteHistory(`community-${workspace.context.profileId}`).capture(expose(current), 'delete')
      assertCurrent()
      return expose(await workspace.notes.remove(plain(note) as unknown as LocalEntity, prior))
    },
    async refresh(scope: NoteScope = 'active') {return list(scope)},
    async acceptServer(note: NoteEntity): Promise<void> {
      // Original UI republishes the result of local folder/tag operations through this method.
      // Accept only an already committed local revision; never ingest a remote snapshot.
      const expectedRevision = entityRevision(note)
      const row = await (await getCommunityWorkspace()).notes.get(note.uid, true)
      if (!expectedRevision || row?.revision !== expectedRevision) unavailable('社区本地模式只接受已提交的本地修订，请重新加载')
    },
    async purge(_note: NoteEntity,_confirmServerDelete?:boolean): Promise<void> {unavailable('当前社区存储尚不支持永久删除，请保留回收站记录')},
    async resetLocal(): Promise<void> {unavailable('当前社区空间不能作为可丢弃缓存重置，请使用完整备份和空间切换')},
    async sync(_phase?: (phase: SyncPhase) => void): Promise<void> {unavailable('社区本地模式不提供同步')},
    async conflicts(): Promise<NoteConflict[]> {return []},
    async resolveConflict(_id: string, _strategy: 'local' | 'server',_stamp?:unknown): Promise<void> {unavailable('社区本地模式不提供服务器冲突处理')},
  }
}

export async function updateNoteState(note: NoteEntity, changes: {pinned?: boolean; status?: string; organizationStatus?: NoteEntity['organizationStatus']}) {
  return createPcNotesService().update({...note, ...changes})
}
export async function restoreNote(note: NoteEntity) {
  return createPcNotesService().update({...note, deleted: false, status: 'active'})
}
