import type {NoteEntity} from '@note-flow/core'

export function noteAttachmentReferenceChanges(note:NoteEntity,localUid:string,contentUrl:string,serverUid?:string):Partial<NoteEntity>{
  const changes:Partial<NoteEntity>={},content=String(note.content||'').replaceAll(`attachment:${localUid}`,contentUrl)
  if(content!==String(note.content||''))changes.content=content
  const remoteUid=serverUid||contentUrl.match(/\/attachments\/([^/?#]+)\/content/)?.[1]
  if(remoteUid&&note.attachmentUid===localUid&&remoteUid!==note.attachmentUid)changes.attachmentUid=remoteUid
  return changes
}
