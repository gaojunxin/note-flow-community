import {createNoteHistory} from '../../services/noteHistory'
import {COMMUNITY_PROFILE_KEY} from '../workspace'
import type {NoteEntity} from '@note-flow/core'
import {getCommunityWorkspace, attachRevision} from '../runtime'
import {createPcNotesService} from './notes'
export interface DuplicateCandidate {uid: string; title: string; score: number; reason: string}
const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
const aiUnavailable = async (): Promise<Record<string, any>> => {throw new Error('社区版未启用 AI 服务；可继续手工整理笔记')}
export const noteOrganizationService = {
  async duplicates(uid: string): Promise<DuplicateCandidate[]> {
    const service = createPcNotesService(), source = await service.get(uid)
    if (!source || source.deleted) throw new Error('笔记不存在或已回收')
    const title = normalize(source.title), content = normalize(source.content)
    return (await service.list()).filter(note => note.uid !== uid).flatMap(note => {
      const sameContent = Boolean(content) && normalize(note.content) === content, sameTitle = Boolean(title) && normalize(note.title) === title
      return sameContent || sameTitle ? [{uid: note.uid, title: note.title, score: sameContent ? 1 : 0.8, reason: sameContent ? '本地正文相同（忽略空白与大小写）' : '本地标题相同（忽略空白与大小写）'}] : []
    }).sort((a, b) => b.score - a.score)
  },
  suggestions: (_uid: string, _kinds?: string[]) => aiUnavailable(),
  knowledgeDraft: (_uid: string) => aiUnavailable(),
  async createKnowledge(uid: string, value: {title: string; content: string; summary?: string}) {
    const service = createPcNotesService(), source = await service.get(uid)
    if (!source || source.deleted) throw new Error('来源笔记不存在或已回收')
    return service.create({...value, type: 'knowledge', captureSource: 'manual_organization', sourceNoteUids: [uid]} as Parameters<typeof service.create>[0])
  },
  async merge(value: {sourceUid: string; targetUid: string; sourceVersion?: number; targetVersion?: number; title: string; content: string; summary?: string | null}): Promise<NoteEntity> {
    if (value.sourceUid === value.targetUid) throw new Error('不能合并笔记自身')
    const workspace = await getCommunityWorkspace()
    const assertCurrent = () => {if (localStorage.getItem(COMMUNITY_PROFILE_KEY) !== workspace.context.profileId) throw new Error('空间已切换，已停止笔记合并')}
    const beforeSource = await workspace.notes.get(value.sourceUid, true), beforeTarget = await workspace.notes.get(value.targetUid, true)
    assertCurrent()
    if (!beforeSource || !beforeTarget || beforeSource.deleted || beforeTarget.deleted) throw new Error('待合并笔记不存在或已回收')
    if (value.sourceVersion !== undefined && value.sourceVersion !== beforeSource.entity.version || value.targetVersion !== undefined && value.targetVersion !== beforeTarget.entity.version) throw new Error('笔记已变化，请重新检测后合并')
    const history = createNoteHistory(`community-${workspace.context.profileId}`)
    // Independent history storage must finish before opening the workspace transaction.
    await history.capture(beforeSource.entity as unknown as NoteEntity, 'delete')
    assertCurrent()
    await history.capture(beforeTarget.entity as unknown as NoteEntity, 'edit')
    assertCurrent()
    return workspace.host.transaction(workspace.context, async tx => {
      const sourceRef = {entityType: 'note', entityUid: value.sourceUid}, targetRef = {entityType: 'note', entityUid: value.targetUid}
      const source = await tx.get(sourceRef), target = await tx.get(targetRef)
      assertCurrent()
      if (!source || !target) throw new Error('待合并笔记不存在或已回收')
      if (source.revision !== beforeSource.revision || target.revision !== beforeTarget.revision) throw new Error('笔记已变化，请重新检测后合并')
      if (value.sourceVersion !== undefined && value.sourceVersion !== source.value.version || value.targetVersion !== undefined && value.targetVersion !== target.value.version) throw new Error('笔记已变化，请重新检测后合并')
      const now = new Date().toISOString(), merged = {...target.value, title: value.title, content: value.content, summary: value.summary, version: Number(target.value.version || 0) + 1, updatedAt: now}
      const saved = await tx.put(targetRef, merged, target.revision), removed = await tx.delete(sourceRef, source.revision)
      await tx.appendChange({...targetRef, profileId: workspace.context.profileId, changeId: crypto.randomUUID(), action: 'update', beforeRevision: target.revision, afterRevision: saved.revision, createdAt: now})
      await tx.appendChange({...sourceRef, profileId: workspace.context.profileId, changeId: crypto.randomUUID(), action: 'delete', beforeRevision: source.revision, afterRevision: removed.revision, createdAt: now})
      return attachRevision(merged as unknown as NoteEntity, saved.revision)
    })
  },
}
