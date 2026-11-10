import type {NoteLinkEntity, NoteLinkType} from '@note-flow/core'
import type {LocalEntity} from '@note-flow/core/community'
import {createEntity, listEntities, removeEntity} from '../runtime'
import {createPcNotesService} from './notes'
export type NoteLinkView = NoteLinkEntity & {sourceTitle?: string; targetTitle?: string}
type Link = NoteLinkView & LocalEntity
export const noteLinksService = {
  async list(noteUid: string): Promise<NoteLinkView[]> {
    const notes = createPcNotesService(), rows = await listEntities<Link>('note_link')
    const titles = new Map([...await notes.list(), ...await notes.list('archived')].map(note => [note.uid, note.title]))
    return rows.filter(row => row.sourceNoteUid === noteUid || row.targetNoteUid === noteUid).map(row => ({...row, sourceTitle: titles.get(row.sourceNoteUid), targetTitle: titles.get(row.targetNoteUid)}))
  },
  async create(noteUid: string, targetNoteUid: string, linkType: NoteLinkType): Promise<NoteLinkView> {
    if (noteUid === targetNoteUid) throw new Error('不能关联笔记自身')
    if (!['source', 'related', 'follow_up'].includes(linkType)) throw new Error('关联类型无效')
    const notes = createPcNotesService(), [source, target] = await Promise.all([notes.get(noteUid), notes.get(targetNoteUid)])
    if (!source || source.deleted || !target || target.deleted) throw new Error('关联笔记不存在或已回收')
    const existing = (await this.list(noteUid)).find(row => row.sourceNoteUid === noteUid && row.targetNoteUid === targetNoteUid && row.linkType === linkType)
    if (existing) return existing
    return createEntity<Link>('note_link', {sourceNoteUid: noteUid, targetNoteUid, linkType})
  },
  remove: (link: NoteLinkView) => removeEntity('note_link', link as Link),
}
