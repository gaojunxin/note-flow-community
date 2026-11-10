import {defineAsyncComponent,type Component} from 'vue'
import type {CanvasType} from '../services/canvasDocument'
import {knowledgeCanvasAdapters} from '../services/knowledgeCanvasAdapters'
import {isDiagramsVendorAvailable} from './diagrams/vendor'
import {excalidrawCreationPresets,type CanvasCreationPreset} from './excalidrawPresets'

export interface CanvasTypeAdapter {
  type:CanvasType
  label:string
  description:string
  badge:string
  enabled:boolean
  dataFormat:string
  initialDocument:()=>string
  editor:Component
  canExport:boolean
  creationPresets?:readonly CanvasCreationPreset[]
}

export interface CanvasCreationOption {
  id:string
  adapter:CanvasTypeAdapter
  preset?:CanvasCreationPreset
  label:string
  description:string
  badge:string
  defaultTitle?:string
  initialDocument:()=>string
}

const adapters:CanvasTypeAdapter[]=[
  {type:'excalidraw',label:'白板 / Excalidraw',description:'自由画布、头脑风暴、卡片与草图',badge:'白板',enabled:true,dataFormat:'excalidraw-json',initialDocument:excalidrawCreationPresets[0].initialDocument,creationPresets:excalidrawCreationPresets,editor:defineAsyncComponent(()=>import('../components/canvas/ExcalidrawCanvasEditor.vue')),canExport:true},
  {type:'mindmap',label:'思维导图',description:'从 Markdown 或树形结构组织提纲',badge:'脑图',enabled:true,dataFormat:'noteflow-mindmap-v1',initialDocument:()=>JSON.stringify({schema:'note-flow.mindmap',version:1,rootId:'mm-root',nodes:[{id:'mm-root',parentId:null,kind:'root',text:'中心主题',order:0}]}),editor:defineAsyncComponent(()=>import('../components/canvas/MindmapCanvasEditor.vue')),canExport:false},
  {type:'diagrams',label:'正式图表',description:isDiagramsVendorAvailable?'离线 diagrams.net、UML 与网络拓扑':'需要安装审核后的离线 diagrams.net 资源',badge:'图表',enabled:isDiagramsVendorAvailable,dataFormat:'drawio-xml',initialDocument:()=>'<mxfile host="NoteFlow" version="31.4.6"><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>',editor:defineAsyncComponent(()=>import('../components/canvas/DiagramsCanvasEditor.vue')),canExport:isDiagramsVendorAvailable},
  {type:'flowchart',label:'流程图',description:'使用 Mermaid 文本维护轻量流程',badge:'流程',enabled:true,dataFormat:'mermaid-text',initialDocument:()=>'flowchart TD\n  A[开始] --> B[结束]',editor:defineAsyncComponent(()=>import('../components/canvas/MermaidCanvasEditor.vue')),canExport:true},
  ...knowledgeCanvasAdapters,
]

const registry=new Map<string,CanvasTypeAdapter>(adapters.map(adapter=>[adapter.type,adapter]))
export const canvasTypeAdapters=Object.freeze(adapters)
export const getCanvasTypeAdapter=(type:unknown)=>registry.get(String(type))
const creationOptions:CanvasCreationOption[]=[]
for(const adapter of adapters){
  if(adapter.creationPresets){
    for(const preset of adapter.creationPresets)creationOptions.push({id:`${adapter.type}:${preset.id}`,adapter,preset,label:preset.label,description:preset.description,badge:preset.badge,defaultTitle:preset.defaultTitle,initialDocument:preset.initialDocument})
  }else creationOptions.push({id:adapter.type,adapter,label:adapter.label,description:adapter.description,badge:adapter.badge,initialDocument:adapter.initialDocument})
}
export const canvasCreationOptions:readonly CanvasCreationOption[]=Object.freeze(creationOptions)
