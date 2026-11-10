import type {NoteEntity} from '@note-flow/core'
import type {FolderEntity} from '@note-flow/core/contracts'
import {folderDescendants,sameFolderScope} from './folderDestinations'
import {consolidationEligible} from './noteConsolidation'
export function folderConsolidationCandidates(folder:FolderEntity,folders:FolderEntity[],notes:NoteEntity[],includeChildren:boolean){
 const scopeFolders=folders.filter(row=>sameFolderScope(row,folder)),included=includeChildren?folderDescendants(folder,scopeFolders):[folder]
 const uids=new Set(included.map(row=>row.uid)),ids=new Set(included.map(row=>row.id))
 return notes.filter(note=>sameFolderScope(note,folder)&&consolidationEligible(note)&&note.status!=='archived'&&(note.folderUid?uids.has(note.folderUid):ids.has(Number(note.folderId))))
}
/** Local metadata grouping is a selection aid, never a semantic merge decision. */
export function groupFolderConsolidation(notes:NoteEntity[],mode:'title'|'folder'|'all',folders:FolderEntity[]){
 const groups=new Map<string,NoteEntity[]>(),names=new Map(folders.map(folder=>[folder.uid,folder.name]))
 for(const note of notes){
  const title=note.title.trim().replace(/^[\d\s_.、-]+/,'')
  const prefix=title.match(/^[\p{Script=Han}]{2,4}|^[a-zA-Z]{3,}/u)?.[0].toLocaleLowerCase()
  const key=mode==='all'?'全部待选笔记':mode==='folder'?(names.get(note.folderUid||'')||folders.find(folder=>folder.id===note.folderId)?.name||'当前目录'):(prefix?`标题开头 · ${prefix}`:'其他标题')
  const rows=groups.get(key)||[];rows.push(note);groups.set(key,rows)
 }
 return [...groups].map(([label,notes])=>({label,notes})).sort((a,b)=>b.notes.length-a.notes.length||a.label.localeCompare(b.label,'zh-CN'))
}
