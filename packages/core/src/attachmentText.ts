/** Local-only extraction. The caller supplies an already verified local Blob. */
export const ATTACHMENT_TEXT_MAX_BYTES = 2 * 1024 * 1024
export const ATTACHMENT_TEXT_EXTRACTOR_VERSION = 1
export type AttachmentTextResult =
 | {state:'ready';text:string;searchText:string;extractorVersion:number}
 | {state:'skipped';code:'UNSUPPORTED_TYPE'|'TOO_LARGE'|'INVALID_ENCODING'|'BINARY_CONTENT'|'READ_FAILED'}

const types:Record<string,readonly string[]>={
 txt:['text/plain'],md:['text/markdown','text/x-markdown','text/plain'],markdown:['text/markdown','text/x-markdown','text/plain'],
 csv:['text/csv','application/csv','text/plain'],json:['application/json','text/json','text/plain']
}
function assertActive(signal?:AbortSignal){if(signal?.aborted)throw new DOMException('已取消附件文本提取','AbortError')}
export async function extractLocalAttachmentText(blob:Blob,metadata:{name:string;mediaType?:string},signal?:AbortSignal):Promise<AttachmentTextResult>{
 assertActive(signal)
 const extension=metadata.name.split('.').pop()?.toLowerCase()||'',mime=String(metadata.mediaType||blob.type||'').split(';')[0].trim().toLowerCase(),allowed=types[extension]
 if(!allowed||(mime&&mime!=='application/octet-stream'&&!allowed.includes(mime)))return{state:'skipped',code:'UNSUPPORTED_TYPE'}
 if(blob.size>ATTACHMENT_TEXT_MAX_BYTES)return{state:'skipped',code:'TOO_LARGE'}
 let bytes:ArrayBuffer
 try{bytes=await blob.arrayBuffer()}catch{assertActive(signal);return{state:'skipped',code:'READ_FAILED'}}
 assertActive(signal)
 if(bytes.byteLength>ATTACHMENT_TEXT_MAX_BYTES)return{state:'skipped',code:'TOO_LARGE'}
 let text:string
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{return{state:'skipped',code:'INVALID_ENCODING'}}
 // A renamed executable or binary must not populate a plaintext search index.
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))return{state:'skipped',code:'BINARY_CONTENT'}
 const searchText=text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim()
 assertActive(signal)
 return{state:'ready',text,searchText,extractorVersion:ATTACHMENT_TEXT_EXTRACTOR_VERSION}
}
