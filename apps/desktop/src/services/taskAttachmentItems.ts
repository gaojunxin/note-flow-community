import type {AttachmentItem,LocalAttachment} from '../../../../packages/core/src/contracts/attachments'
import {inferMediaType} from './filePreview'
/** Preserve the local UID so the preview can resolve queued bytes without a server. */
export function taskAttachmentItem(row:LocalAttachment):AttachmentItem{
 const mediaType=inferMediaType(row.name,row.mediaType)
 return {uid:row.uid,taskUid:row.taskUid,noteUid:row.noteUid,version:0,relationUid:row.relationUid,relationVersion:row.relationVersion,originalFilename:row.name||'附件',mediaType,sizeBytes:row.sizeBytes,sha256:row.sha256,uploadState:row.status,role:mediaType.startsWith('image/')?'image':mediaType.startsWith('audio/')?'audio':'file',contentUrl:row.localPath?`local-media:${row.localPath}`:row.contentUrl||`attachment:${row.uid}`}
}
/** Prefer confirmed server reference metadata when a local upload has the same server UID. */
export function mergeTaskAttachmentItems(local:LocalAttachment[],remote:AttachmentItem[]=[]){
 const result:AttachmentItem[]=[],seen=new Set<string>(),remoteUids=new Set(remote.map(item=>item.uid))
 for(const row of local){if(row.status==='deleted'||remoteUids.has(row.uid)||row.serverUid&&remoteUids.has(row.serverUid)||seen.has(row.uid))continue;seen.add(row.uid);result.push(taskAttachmentItem(row))}
 for(const item of remote){if(seen.has(item.uid))continue;seen.add(item.uid);result.push(item)}
 return result
}

export function filterRemovedTaskReferences(items:AttachmentItem[],removals:Array<Pick<LocalAttachment,'serverUid'|'relationUid'|'relationVersion'>&{uid?:string}>){
 return items.filter(item=>!removals.some(row=>row.uid===item.uid&&row.uid!==row.serverUid||row.serverUid===item.uid&&Boolean(row.relationUid)&&row.relationUid===item.relationUid&&row.relationVersion===item.relationVersion))
}
