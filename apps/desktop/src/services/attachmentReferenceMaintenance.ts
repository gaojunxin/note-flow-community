import type {NoteEntity} from '@note-flow/core'
export async function maintainUploadedAttachmentReferences(notes:()=>NoteEntity[],items:Array<{uid:string;serverUid?:string;contentUrl?:string;status:string}>,replace:(noteUid:string,from:string,to:string,serverUid:string)=>Promise<unknown>){
  const references=new Map<string,Set<string>>()
  for(const note of notes()){
    if(note.deleted)continue
    for(const uid of [note.attachmentUid,...Array.from((note.content||'').matchAll(/attachment:([\w-]+)/g),match=>match[1])]){
      if(!uid)continue
      if(!references.has(uid))references.set(uid,new Set())
      references.get(uid)!.add(note.uid)
    }
  }
  let repaired=0
  for(const item of items){
    if(item.status!=='uploaded'||!item.serverUid)continue
    for(const uid of references.get(item.uid)||[])if(await replace(uid,`attachment:${item.uid}`,item.contentUrl||`/api/v1/attachments/${item.serverUid}/content`,item.serverUid))repaired++
  }
  return repaired
}
