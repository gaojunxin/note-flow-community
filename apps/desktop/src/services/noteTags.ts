import type {NoteEntity} from '@note-flow/core'
import type {TagEntity} from './tags'

export type TagMatchMode='any'|'all'
export function noteTagUids(note:Pick<NoteEntity,'tagUids'|'tagIds'>,tags:TagEntity[]):string[]{
  if(note.tagUids!==undefined)return [...new Set(note.tagUids)]
  const ids=new Set(note.tagIds||[])
  return tags.filter(tag=>ids.has(tag.id)).map(tag=>tag.uid)
}
export function noteHasTag(note:Pick<NoteEntity,'tagUids'|'tagIds'>,tag:TagEntity){
  return note.tagUids!==undefined?note.tagUids.includes(tag.uid):Boolean(note.tagIds?.includes(tag.id))
}
export function matchesNoteTags(note:Pick<NoteEntity,'tagUids'|'tagIds'>,uids:string[],tags:TagEntity[],mode:TagMatchMode='any'){
  if(!uids.length)return true
  const present=new Set(noteTagUids(note,tags))
  return mode==='all'?uids.every(uid=>present.has(uid)):uids.some(uid=>present.has(uid))
}
export function inTagScope(note:NoteEntity,areaUid:string,projectUid:string){
  return !note.deleted&&note.status!=='archived'&&(projectUid?note.projectUid===projectUid:!areaUid||note.areaUid===areaUid)
}
export function countTagNotes(notes:NoteEntity[],tag:TagEntity,areaUid='',projectUid=''){
  return new Set(notes.filter(note=>inTagScope(note,areaUid,projectUid)&&noteHasTag(note,tag)).map(note=>note.uid)).size
}
