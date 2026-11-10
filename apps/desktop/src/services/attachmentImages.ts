import type {AttachmentItem} from '../../../../packages/core/src/contracts/attachments'
/** Only application-owned references are resolved through attachment storage. */
export function attachmentImageItem(source:string):AttachmentItem|undefined {
 const local=/^attachment:([a-zA-Z0-9_-]+)$/.exec(source)
 const remote=/^\/api\/v1\/attachments\/([a-zA-Z0-9_-]+)\/content(?:\?[^#]*)?$/.exec(source)
 const uid=local?.[1]||remote?.[1]
 if(!uid)return
 return{uid,version:0,originalFilename:'图片',mediaType:'image/*',sizeBytes:0,sha256:'',contentUrl:local?`local-media:${uid}`:source}
}
