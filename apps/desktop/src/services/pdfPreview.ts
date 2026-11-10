import './pdfPromiseCompatibility'
import './pdfBufferCompatibility'
import workerUrl from './pdfPreview.worker?worker&url'

let localWorker:Promise<Worker>|undefined

/** 页面读取随包脚本后启动线程，等PDF.js确认ready才释放Blob，避免WebKit尚未读取就失去URL。 */
async function packagedPdfWorker(){
  const response=await fetch(workerUrl)
  if(!response.ok)throw new Error('PDF 绘图线程资源读取失败，请重新打开文件')
  const url=URL.createObjectURL(new Blob([await response.text()],{type:'text/javascript'}))
  let worker:Worker
  try{worker=new Worker(url)}catch(source){URL.revokeObjectURL(url);throw source}
  return new Promise<Worker>((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('message',ready);worker.removeEventListener('error',failed);URL.revokeObjectURL(url)}
    const failed=()=>{cleanup();worker.terminate();reject(new Error('PDF 绘图线程启动失败，请重新打开文件'))}
    const ready=(event:MessageEvent)=>{if(event.data?.action==='ready'){cleanup();resolve(worker)}}
    const timer=setTimeout(failed,15_000)
    worker.addEventListener('message',ready);worker.addEventListener('error',failed)
  })
}

/** 使用兼容构建；自定义协议宿主由页面读取脚本并持有共享worker端口。 */
export async function pdfPreviewEngine(){
  const engine=await import('pdfjs-dist/legacy/build/pdf.mjs')
  engine.GlobalWorkerOptions.workerSrc=workerUrl
  if(globalThis.location?.protocol==='tauri:'){
    // PDF.js 会把不透明来源包装为 Blob 内的 import，WKWebView 无法可靠解析该路径。
    // Blob只执行已打包脚本，不再导入tauri: URL；并发打开复用同一启动过程，失败允许下次重试。
    localWorker??=packagedPdfWorker().catch(source=>{localWorker=undefined;throw source})
    engine.GlobalWorkerOptions.workerPort=await localWorker
  }
  return engine
}

export function pdfPreviewOptions(data:Uint8Array){
  const base=import.meta.env.BASE_URL||'/'
  const agent=globalThis.navigator?.userAgent||''
  const webkit=/AppleWebKit/i.test(agent)&&!/Chrome|Chromium|Edg|OPR|Android/i.test(agent)
  // 旧版WKWebView可提供字体/离屏画布API，却未必能完成自定义协议下的字体加载或图片转换。
  // 使用PDF.js的字形路径与普通图片解码；资源由页面读取后传入worker，避免Blob来源相对路径。
  return{data,cMapUrl:`${base}pdfjs/cmaps/`,cMapPacked:true,standardFontDataUrl:`${base}pdfjs/standard_fonts/`,wasmUrl:`${base}pdfjs/wasm/`,isEvalSupported:false,
    ...(webkit?{disableFontFace:true,useSystemFonts:false,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,useWorkerFetch:false,stopAtErrors:true}:{})}
}

export function pdfPreviewError(source:unknown){
  const name=source instanceof Error?source.name:''
  if(name==='PasswordException')return '此 PDF 需要密码，请使用默认程序打开。'
  if(name==='InvalidPDFException')return 'PDF 文件损坏或格式无效，请检查原文件。'
  return `PDF 预览失败：${source instanceof Error?source.message:'无法读取文件'}`
}
