import type {NoteEntity} from '@note-flow/core'
export interface NoteDraftSnapshot {uid:string;title:string;content:string}
export function noteDraftSnapshot(note:NoteEntity):NoteDraftSnapshot{return{uid:note.uid,title:note.title?.trim()||'未命名笔记',content:note.content||''}}
export function noteDraftChanges(baseline:NoteDraftSnapshot|undefined,note:NoteEntity|undefined,title:string,content:string):Partial<NoteEntity>{
  if(!baseline||!note||note.deleted||baseline.uid!==note.uid)return{}
  const changes:Partial<NoteEntity>={},normalizedTitle=title.trim()||'未命名笔记'
  if(normalizedTitle!==baseline.title)changes.title=normalizedTitle
  if(content!==baseline.content)changes.content=content
  return changes
}

/** Adopt received fields independently; never replace a field the user is still editing. */
export function reconcileNoteDraft(baseline:NoteDraftSnapshot|undefined,note:NoteEntity|undefined,title:string,content:string){
  if(!baseline||!note||baseline.uid!==note.uid)return{baseline,title,content}
  const received=noteDraftSnapshot(note),normalizedTitle=title.trim()||'未命名笔记'
  const titleDirty=normalizedTitle!==baseline.title&&normalizedTitle!==received.title
  const contentDirty=content!==baseline.content&&content!==received.content
  return{
    baseline:{...received,title:titleDirty?baseline.title:received.title,content:contentDirty?baseline.content:received.content},
    title:titleDirty?title:note.title||'',content:contentDirty?content:note.content||''
  }
}
