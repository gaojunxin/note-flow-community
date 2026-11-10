import type {FolderTransferImpact,FolderTransferTarget} from '../../services/contracts/folderTransfer'
import {sameFolderScope,validateFolderMove} from '../../services/folderDestinations'
import type {NoteEntity} from '@note-flow/core'
import type {FolderEntity} from '@note-flow/core/contracts'
import type {LocalEntity} from '@note-flow/core/community'
import {createEntity, listEntities, removeEntity, updateEntity} from '../runtime'
import {createPcNotesService} from './notes'
import {tagsService} from './tags'
export type {FolderEntity} from '@note-flow/core/contracts'
export interface FolderDeleteProgress {phase: string; completed: number; total: number; current?: string}
type Folder = FolderEntity & LocalEntity
export function folderSubtree(root: FolderEntity, rows: FolderEntity[]) {
  const result = [root], seen = new Set([root.uid])
  for (let index = 0; index < result.length; index++) for (const child of rows) if ((child.parentUid ? child.parentUid === result[index].uid : child.parentId === result[index].id) && !seen.has(child.uid)) {seen.add(child.uid); result.push(child)}
  return result
}
export function folderChildren(folder: FolderEntity, rows: FolderEntity[]) {return rows.filter(row => row.parentUid ? row.parentUid === folder.uid : row.parentId === folder.id)}
export function folderParent(folder: FolderEntity, rows: FolderEntity[]) {
  if (!folder.parentUid && folder.parentId == null) return null
  const parent = rows.find(row => folder.parentUid ? row.uid === folder.parentUid : row.id === folder.parentId)
  if (!parent) throw new Error('父目录不存在，请刷新目录后重试')
  return parent
}
export function validateFolderPromotion(children: FolderEntity[], parent: FolderEntity | null, rows: FolderEntity[], removedUid?: string) {
  const names = new Set<string>(), siblings = rows.filter(row => row.uid !== removedUid && !children.some(child => child.uid === row.uid) && (parent ? row.parentUid ? row.parentUid === parent.uid : row.parentId === parent.id : !row.parentUid && row.parentId == null))
  for (const child of children) {const name = child.name.trim().toLocaleLowerCase(); if (names.has(name) || siblings.some(row => (row.areaUid || null) === (child.areaUid || null) && (row.projectUid || null) === (child.projectUid || null) && row.name.trim().toLocaleLowerCase() === name)) throw new Error(`同级目录“${child.name}”已存在，请先重命名`); names.add(name)}
}
export const foldersService = {
  // 社区本地目录移动沿用move；服务端迁移和AI批量写入不能冒充本机已执行。
  pendingTreeTransfer(_uid:string):{sent:boolean;request:{operationUid:string;target:FolderTransferTarget};impact:FolderTransferImpact}|undefined{return undefined},
  async treeTransferPreview(_root:FolderEntity,_target:FolderTransferTarget):Promise<FolderTransferImpact>{throw Error('社区版不提供跨空间整棵迁移')},
  async transferTree(..._args:unknown[]):Promise<FolderTransferImpact>{throw Error('社区版不提供跨空间整棵迁移')},
  async workspaceUpdate(..._args:unknown[]):Promise<FolderEntity>{throw Error('社区版不提供AI工作区批量修改')},
  async conflicts(): Promise<never[]> {return []},
  async resolveConflict(_id: string, _strategy: 'local' | 'server',_stamp?:unknown): Promise<void> {throw new Error('社区本地模式不提供服务器冲突处理')},
  list: () => listEntities<Folder>('folder'),
  async create(name: string, parentId: number | null, scope: {areaUid?: string | null; projectUid?: string | null} = {}) {
    if (!name.trim()) throw new Error('目录名称不能为空')
    const rows = await this.list(), parent = parentId == null ? null : rows.find(row => row.id === parentId)
    if (parentId != null && !parent) throw new Error('父目录不存在')
    const draft = {name: name.trim(), parentId, parentUid: parent?.uid ?? null, ...scope}
    validateFolderPromotion([draft as FolderEntity], parent || null, rows)
    return createEntity<Folder>('folder', {...draft, sortOrder: 0})
  },
  async update(folder: FolderEntity, name: string) {
    if (!name.trim()) throw new Error('目录名称不能为空')
    const rows=await this.list(),current=rows.find(row=>row.uid===folder.uid);if(!current)throw Error('目录不存在')
    if(!sameFolderScope(folder,current))throw Error('普通目录更新不能改变领域或项目，请刷新后重试')
    validateFolderPromotion([{...current,name:name.trim()}],folderParent(current,rows),rows)
    return updateEntity('folder',current as Folder,{name:name.trim()})
  },
  async move(folder: FolderEntity, parent: FolderEntity | null) {
    const rows = await this.list()
    const checked=validateFolderMove(folder,parent,rows)
    return updateEntity('folder', checked.current as Folder, {parentId: checked.parent?.id ?? null, parentUid: checked.parent?.uid ?? null})
  },
  async promote(folder: FolderEntity) {
    const rows = await this.list(), parent = folderParent(folder, rows)
    if (!parent) throw new Error('目录已经位于顶级')
    return this.move(folder, folderParent(parent, rows))
  },
  async dissolve(folder: FolderEntity) {
    const rows = await this.list(), parent = folderParent(folder, rows), children = folderChildren(folder, rows)
    validateFolderPromotion(children, parent, rows, folder.uid)
    // Move first and retain the original folder until every content move succeeds.
    for (const child of children) await this.move(child, parent)
    const service = createPcNotesService(), contents = [...await service.list(), ...await service.list('archived')]
    for (const note of contents.filter(note => note.folderUid ? note.folderUid === folder.uid : note.folderId === folder.id)) await this.organize(note, parent?.id ?? null)
    await removeEntity('folder', folder as Folder)
  },
  async remove(folder: FolderEntity, onProgress?: (progress: FolderDeleteProgress) => void) {
    const subtree = folderSubtree(folder, await this.list()), uids = new Set(subtree.map(row => row.uid)), ids = new Set(subtree.map(row => row.id)), service = createPcNotesService()
    const notes = [...await service.list(), ...await service.list('archived')].filter(note => note.folderUid ? uids.has(note.folderUid) : ids.has(Number(note.folderId)))
    const total = notes.length + subtree.length; let completed = 0
    for (const note of notes) {onProgress?.({phase: '移到回收站', completed, total, current: note.title}); await service.remove({...note, folderUid: null, folderId: null}); completed++}
    for (const child of subtree.reverse()) {await removeEntity('folder', child as Folder); onProgress?.({phase: '删除目录', completed: ++completed, total, current: child.name})}
    onProgress?.({phase: '删除完成', completed, total})
  },
  async organize(note: NoteEntity, folderId: number | null, tagIds = note.tagIds || [], tagUids?: string[]) {
    const rows = await this.list(), folder = folderId == null ? null : rows.find(row => row.id === folderId)
    if (folderId != null && !folder) throw new Error('目录不存在')
    const tags = await tagsService.list(), known = new Set(tags.map(tag => tag.uid)), uids = tagUids ?? [...new Set([...tags.filter(tag => tagIds.includes(tag.id)).map(tag => tag.uid), ...(note.tagUids || []).filter(uid => !known.has(uid))])]
    return createPcNotesService().update({...note, folderId, folderUid: folder?.uid ?? null, tagIds, tagUids: uids})
  },
}

export const localAiFolders=()=>foldersService.list()
