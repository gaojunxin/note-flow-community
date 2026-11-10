import {attachmentImageItem} from './attachmentImages'
export interface NoteCanvasEmbed {id:string;source:string;preview:string;markdown:string;from:number;to:number}
const reference='(?:attachment:[A-Za-z0-9_-]+|/api/v1/attachments/[A-Za-z0-9_-]+/content(?:\\?[^\\s)"<>]*)?)'
export function noteCanvasEmbeds(content:string):NoteCanvasEmbed[]{
 const pattern=new RegExp(`\\[!\\[画布\\]\\((${reference})\\)\\]\\((${reference}) "note-flow-canvas:([A-Za-z0-9_-]+)"\\)`,'g')
 return [...content.matchAll(pattern)].map(match=>({id:match[3],preview:match[1],source:match[2],markdown:match[0],from:match.index!,to:match.index!+match[0].length}))
}
export function noteCanvasMarkdown(id:string,source:string,preview:string){
 if(!/^[A-Za-z0-9_-]+$/.test(id)||!attachmentImageItem(source)||!attachmentImageItem(preview))throw Error('画布引用无效')
 return `[![画布](${preview})](${source} "note-flow-canvas:${id}")`
}
export function replaceNoteCanvas(content:string,id:string,markdown:string){
 const matches=noteCanvasEmbeds(content).filter(item=>item.id===id)
 if(matches.length!==1)throw Error('画布引用已更改，请关闭后重新打开画布')
 const item=matches[0];return content.slice(0,item.from)+markdown+content.slice(item.to)
}
export function parseNoteCanvasScene(scene:string){
 const value=JSON.parse(scene)
 if(value?.type!=='excalidraw'||!Array.isArray(value.elements)||!value.appState||typeof value.appState!=='object'||!value.files||typeof value.files!=='object')throw Error('画布文件格式无效')
 return value
}
