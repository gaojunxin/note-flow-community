import type {PDFDocumentLoadingTask} from 'pdfjs-dist'
import {pdfPreviewEngine,pdfPreviewOptions} from './pdfPreview'
export const PDF_TEXT_MAX_BYTES=10*1024*1024
export const PDF_TEXT_MAX_PAGES=100
const MAX_CHARACTERS=2*1024*1024,TIMEOUT_MS=10000
export type PdfTextResult={state:'ready';text:string;searchText:string;extractorVersion:number}|{state:'skipped';code:'TOO_LARGE'|'PAGE_LIMIT'|'TEXT_LIMIT'|'NO_TEXT'|'PASSWORD_REQUIRED'|'INVALID_PDF'|'TIMEOUT'}
/** Extracts embedded text only. Does not render pages, run OCR or fetch PDFs. */
export async function extractLocalPdfText(blob:Blob,signal?:AbortSignal):Promise<PdfTextResult>{
 if(signal?.aborted)throw new DOMException('已取消附件文本提取','AbortError')
 if(blob.size>PDF_TEXT_MAX_BYTES)return{state:'skipped',code:'TOO_LARGE'}
 let task:PDFDocumentLoadingTask|undefined,closed=false,timer:ReturnType<typeof setTimeout>|undefined
 const assertActive=()=>{if(closed||signal?.aborted)throw new DOMException('已取消附件文本提取','AbortError')}
 let rejectStop!:(error:Error)=>void
 const stop=new Promise<never>((_,reject)=>{rejectStop=reject})
 const cancel=()=>{closed=true;void task?.destroy().catch(()=>{});rejectStop(new DOMException('已取消附件文本提取','AbortError'))}
 signal?.addEventListener('abort',cancel,{once:true})
 timer=setTimeout(()=>{closed=true;void task?.destroy().catch(()=>{});rejectStop(new Error('PDF_TEXT_TIMEOUT'))},TIMEOUT_MS)
 const work=async():Promise<PdfTextResult>=>{
  const engine=await pdfPreviewEngine();assertActive()
  const bytes=new Uint8Array(await blob.arrayBuffer());assertActive()
  task=engine.getDocument({...pdfPreviewOptions(bytes),disableFontFace:true,useSystemFonts:false,enableXfa:false,disableAutoFetch:true,disableStream:true,stopAtErrors:true})
  const document=await task.promise;assertActive()
  if(document.numPages>PDF_TEXT_MAX_PAGES)return{state:'skipped',code:'PAGE_LIMIT'}
  const chunks:string[]=[];let length=0
  for(let number=1;number<=document.numPages;number++){
   assertActive();const page=await document.getPage(number);assertActive()
   try{
    const content=await page.getTextContent();assertActive()
    for(const item of content.items)if('str' in item){
     length+=item.str.length+1
     if(length>MAX_CHARACTERS)return{state:'skipped',code:'TEXT_LIMIT'}
     chunks.push(item.str,item.hasEOL?'\n':' ')
    }
    chunks.push('\n')
   }finally{page.cleanup()}
  }
  const text=chunks.join('').trim()
  if(!text)return{state:'skipped',code:'NO_TEXT'}
  return{state:'ready',text,searchText:text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim(),extractorVersion:1}
 }
 try{return await Promise.race([work(),stop])}
 catch(source){
  if(signal?.aborted)throw new DOMException('已取消附件文本提取','AbortError')
  if((source as Error)?.message==='PDF_TEXT_TIMEOUT')return{state:'skipped',code:'TIMEOUT'}
  return{state:'skipped',code:(source as Error)?.name==='PasswordException'?'PASSWORD_REQUIRED':'INVALID_PDF'}
 }finally{closed=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);void task?.destroy().catch(()=>{})}
}
