import {MINDMAP_SCHEMA,MINDMAP_VERSION,parseMarkdownMindmap,validateMindmapDocument,type MindmapDocumentV1,type MindmapNodeV1} from '../services/mindmap'

export interface MindmapPosition { id:string; x:number; y:number; depth:number }
export interface LinkedMindmapProjection { schema:string; sourceMode?:'linked'; sourceNoteUid?:string; sourceUpdatedAt?:string; generatedAt?:string; document:MindmapDocumentV1 }

const clone=(document:MindmapDocumentV1):MindmapDocumentV1=>({ ...document,nodes:document.nodes.map(node=>({...node})) })
const nextId=(document:MindmapDocumentV1)=>{let index=document.nodes.length+1,id=`mm-node-${index}`;while(document.nodes.some(node=>node.id===id))id=`mm-node-${++index}`;return id}
const nextOrder=(document:MindmapDocumentV1,parentId:string)=>Math.max(-1,...document.nodes.filter(node=>node.parentId===parentId).map(node=>node.order))+1

export function parseMindmapEditorDocument(value:string):{document:MindmapDocumentV1;linked?:LinkedMindmapProjection;error?:string}{
  try{
    const raw=JSON.parse(value||'{}') as any
    const linked=raw?.schema==='note-flow.mindmap-view'||raw?.sourceMode==='linked'
      ? raw as LinkedMindmapProjection : undefined
    const document=(linked?.document||raw) as MindmapDocumentV1
    if(document?.schema!==MINDMAP_SCHEMA||document?.version!==MINDMAP_VERSION||!Array.isArray(document.nodes))throw new Error('不是可识别的思维导图文档')
    const fatal=validateMindmapDocument(document).find(item=>item.severity==='error')
    return fatal?{document,error:fatal.message}:{document,linked}
  }catch(error){
    return {document:{schema:MINDMAP_SCHEMA,version:MINDMAP_VERSION,rootId:'mm-root',nodes:[{id:'mm-root',parentId:null,kind:'root',text:'中心主题',order:0}]},error:error instanceof Error?error.message:'文档解析失败'}
  }
}

export function addMindmapChild(document:MindmapDocumentV1,parentId:string,text='新主题'){
  const next=clone(document);next.nodes.push({id:nextId(next),parentId,kind:'list-item',text,order:nextOrder(next,parentId)});return next
}
export function addMindmapSibling(document:MindmapDocumentV1,nodeId:string,text='新主题'){
  const node=document.nodes.find(item=>item.id===nodeId);return !node?.parentId?document:addMindmapChild(document,node.parentId,text)
}
export function renameMindmapNode(document:MindmapDocumentV1,nodeId:string,text:string){
  const next=clone(document),node=next.nodes.find(item=>item.id===nodeId);if(node)node.text=text.trim()||node.text;return next
}
export function deleteMindmapBranch(document:MindmapDocumentV1,nodeId:string){
  if(nodeId===document.rootId)return document
  const removed=new Set([nodeId]);let changed=true
  while(changed){changed=false;for(const node of document.nodes)if(node.parentId&&removed.has(node.parentId)&&!removed.has(node.id)){removed.add(node.id);changed=true}}
  const next=clone(document);next.nodes=next.nodes.filter(node=>!removed.has(node.id));return next
}
export function reparentMindmapNode(document:MindmapDocumentV1,nodeId:string,newParentId:string){
  if(nodeId===document.rootId||nodeId===newParentId)return document
  const node=document.nodes.find(item=>item.id===nodeId),parent=document.nodes.find(item=>item.id===newParentId)
  if(!node||!parent||node.parentId===newParentId)return document
  const descendants=new Set([nodeId]);let changed=true
  while(changed){changed=false;for(const item of document.nodes)if(item.parentId&&descendants.has(item.parentId)&&!descendants.has(item.id)){descendants.add(item.id);changed=true}}
  if(descendants.has(newParentId))return document
  const next=clone(document),moved=next.nodes.find(item=>item.id===nodeId)!,oldParent=node.parentId
  moved.parentId=newParentId;moved.order=nextOrder(next,newParentId)
  if(oldParent)next.nodes.filter(item=>item.parentId===oldParent&&item.id!==nodeId).sort((a,b)=>a.order-b.order).forEach((item,index)=>item.order=index)
  return next
}
export interface MindmapHistory {past:MindmapDocumentV1[];present:MindmapDocumentV1;future:MindmapDocumentV1[]}
export const createMindmapHistory=(document:MindmapDocumentV1):MindmapHistory=>({past:[],present:clone(document),future:[]})
export function commitMindmapHistory(history:MindmapHistory,next:MindmapDocumentV1,limit=50):MindmapHistory{return next===history.present||JSON.stringify(next)===JSON.stringify(history.present)?history:{past:[...history.past,clone(history.present)].slice(-limit),present:clone(next),future:[]}}
export function undoMindmapHistory(history:MindmapHistory):MindmapHistory{const previous=history.past.at(-1);return previous?{past:history.past.slice(0,-1),present:clone(previous),future:[clone(history.present),...history.future]}:history}
export function redoMindmapHistory(history:MindmapHistory):MindmapHistory{const next=history.future[0];return next?{past:[...history.past,clone(history.present)],present:clone(next),future:history.future.slice(1)}:history}
export function createLinkedMindmapProjection(note:{uid:string;title:string;content:string;updatedAt?:string},generatedAt=new Date().toISOString()):LinkedMindmapProjection{
  let document:MindmapDocumentV1|undefined
  try{const value=JSON.parse(note.content||'{}') as MindmapDocumentV1;if(value?.schema===MINDMAP_SCHEMA&&value.version===MINDMAP_VERSION&&Array.isArray(value.nodes)&&!validateMindmapDocument(value).some(item=>item.severity==='error'))document=value}catch{/* Legacy imports commonly contain Markdown outlines. */}
  return{schema:'note-flow.mindmap-view',sourceMode:'linked',sourceNoteUid:note.uid,sourceUpdatedAt:note.updatedAt,generatedAt,document:document||parseMarkdownMindmap(note.content,note.title).document}
}
export function createLinkedMindmapCanvasInput(note:{uid:string;title:string;content:string;updatedAt?:string;areaUid?:string|null;projectUid?:string|null}){
  const documentData=JSON.stringify(createLinkedMindmapProjection(note))
  return{title:`${note.title||'未命名笔记'} · 脑图`,canvasType:'mindmap' as const,dataFormat:'noteflow-mindmap-view-v1',dataVersion:1,sourceMode:'linked' as const,sourceNoteUid:note.uid,areaUid:note.areaUid||null,projectUid:note.projectUid||null,documentData,sceneData:documentData}
}
export function layoutMindmap(document:MindmapDocumentV1,collapsed:ReadonlySet<string>=new Set()):MindmapPosition[]{
  const children=new Map<string,MindmapNodeV1[]>();for(const node of document.nodes){if(!node.parentId)continue;const list=children.get(node.parentId)||[];list.push(node);children.set(node.parentId,list)}
  for(const list of children.values())list.sort((a,b)=>a.order-b.order)
  const result:MindmapPosition[]=[];let row=0
  const visit=(id:string,depth:number)=>{result.push({id,x:60+depth*220,y:48+row++*76,depth});if(!collapsed.has(id))for(const child of children.get(id)||[])visit(child.id,depth+1)}
  visit(document.rootId,0);return result
}
export function isLinkedProjectionStale(linked?:LinkedMindmapProjection){
  if(!linked?.sourceUpdatedAt)return false
  if(!linked.generatedAt)return true
  return Date.parse(linked.sourceUpdatedAt)>Date.parse(linked.generatedAt)
}
