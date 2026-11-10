import type {CanvasEntity} from './canvases'
import {parseNoteCanvasScene} from './noteCanvas'
export const linkedCanvasUid=(source:string)=>/^noteflow-canvas:([A-Za-z0-9_-]+)$/.exec(source)?.[1]
export function linkedCanvasMarkdown(uid:string,title:string){
 if(!linkedCanvasUid(`noteflow-canvas:${uid}`))throw Error('画布引用无效')
 return `[画布：${(title||'未命名画布').replace(/[\\[\]]/g,'\\$&').replace(/[\r\n]/g,' ')}](noteflow-canvas:${uid})`
}
export function linkedCanvasEmbeds(content:string){
 return [...content.matchAll(/\[((?:\\.|[^\]\\\n])*)\]\(noteflow-canvas:([A-Za-z0-9_-]+)\)/g)].map(match=>({uid:match[2],from:match.index!,to:match.index!+match[0].length}))
}
const previews=new Map<string,Promise<Blob|undefined>>()
export async function resolveLinkedCanvas(owner:string,uid:string):Promise<{canvas:CanvasEntity;preview?:Blob}>{
 const {createCanvasService}=await import('./canvases')
 const canvas=(await createCanvasService(owner).list()).find(value=>value.uid===uid)
 if(!canvas)throw Error('画布不存在、已删除或尚未同步')
 const scene=canvas.documentData||canvas.sceneData,key=JSON.stringify([owner,uid,canvas.version,scene])
 let pending=previews.get(key)
 if(!pending){
  pending=(async()=>{
   if(canvas.canvasType!=='excalidraw'){const {renderCanvasPreview}=await import('./canvasPreview');return renderCanvasPreview(canvas)}
   const value=parseNoteCanvasScene(scene)
   if(!value.elements.some((item:any)=>!item.isDeleted))return
   const {exportToBlob}=await import('@excalidraw/excalidraw')
   return exportToBlob({elements:value.elements.filter((item:any)=>!item.isDeleted),appState:{...value.appState,exportBackground:true},files:value.files,mimeType:'image/png',exportPadding:20})
  })()
  previews.set(key,pending);if(previews.size>24)previews.delete(previews.keys().next().value!)
 }
 try{return{canvas,preview:await pending}}catch(error){previews.delete(key);throw error}
}
