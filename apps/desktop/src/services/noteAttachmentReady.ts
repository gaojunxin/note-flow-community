import type {NoteEntity} from '@note-flow/core'
/** V2 acknowledgements identify notes by UID and version, without a REST id. */
export function noteAttachmentReady(note:Partial<NoteEntity>|undefined,community=false){
 if(!note||note.deleted)return false
 if(community)return true
 if(note.syncStatus==='pending'||note.syncStatus==='conflict')return false
 return Boolean(note.id||note.uid&&note.syncStatus==='synced'&&(note.version??0)>0)
}
