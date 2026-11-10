import {readZip} from './localZip'
export const DOCX_TEXT_MAX_BYTES=10*1024*1024
const XML_LIMIT=2*1024*1024
const part=/^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/
export async function extractLocalDocxText(blob:Blob,signal?:AbortSignal){
 const assertActive=()=>{if(signal?.aborted)throw new DOMException('已取消附件文本提取','AbortError')}
 assertActive()
 if(blob.size>DOCX_TEXT_MAX_BYTES)return{state:'skipped' as const,code:'TOO_LARGE'}
 try{
  const files=await readZip(blob,{include:name=>part.test(name),maxEntryBytes:XML_LIMIT,maxSelectedBytes:XML_LIMIT,signal})
  assertActive()
  if(!files.has('word/document.xml'))return{state:'skipped' as const,code:'INVALID_DOCX'}
  const chunks:string[]=[]
  for(const [,bytes] of [...files].sort(([a],[b])=>a==='word/document.xml'?-1:b==='word/document.xml'?1:a.localeCompare(b))){
   assertActive()
   const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
   if(/<!DOCTYPE|<!ENTITY/i.test(xml))return{state:'skipped' as const,code:'INVALID_DOCX'}
   const document=new DOMParser().parseFromString(xml,'application/xml')
   if(document.getElementsByTagName('parsererror').length)return{state:'skipped' as const,code:'INVALID_DOCX'}
   for(const node of Array.from(document.getElementsByTagName('*'))){
    if(!['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main'].includes(node.namespaceURI||''))continue
    if(node.localName==='t')chunks.push(node.textContent||'')
    else if(['p','br','cr'].includes(node.localName))chunks.push('\n')
    else if(node.localName==='tab')chunks.push('\t')
   }
   chunks.push('\n')
  }
  assertActive()
  const text=chunks.join('').trim()
  if(!text)return{state:'skipped' as const,code:'NO_TEXT'}
  return{state:'ready' as const,text,searchText:text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim(),extractorVersion:1}
 }catch{assertActive();return{state:'skipped' as const,code:'INVALID_DOCX'}}
}
