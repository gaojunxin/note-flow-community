export const CANVAS_TYPES = ['excalidraw','mindmap','diagrams','flowchart','knowledge_graph'] as const
export type CanvasType = typeof CANVAS_TYPES[number]
export type CanvasSourceMode = 'independent'|'linked'

export const CANVAS_FORMATS:Record<CanvasType,readonly string[]> = {
  excalidraw:['excalidraw-json'],
  mindmap:['noteflow-mindmap-v1','noteflow-mindmap-view-v1'],
  diagrams:['drawio-xml'],
  flowchart:['mermaid-text'],
  knowledge_graph:['noteflow-knowledge-graph-view-v1'],
}

export interface CanvasDocumentFields {
  canvasType:CanvasType
  documentData:string
  dataFormat:string
  dataVersion:number
  sourceMode:CanvasSourceMode
  sourceNoteUid:string|null
}

export interface LegacyCanvasDocumentFields extends Partial<CanvasDocumentFields> { sceneData?:string }

function inferCanvasType(value:LegacyCanvasDocumentFields):CanvasType|undefined{
  const format=String(value.dataFormat||'')
  for(const type of CANVAS_TYPES)if(CANVAS_FORMATS[type].includes(format))return type
  const document=String(value.documentData??value.sceneData??'').trim()
  if(!document)return undefined
  if(/^<mxfile\b|^<mxGraphModel\b/i.test(document))return'diagrams'
  if(/^(?:---[\s\S]*?---\s*)?(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|requirementDiagram|gitGraph|xychart-beta|block-beta|packet-beta|architecture-beta|kanban)\b/i.test(document))return'flowchart'
  try{const parsed=JSON.parse(document);if(parsed?.type==='excalidraw'&&Array.isArray(parsed.elements))return'excalidraw';if(parsed?.schema==='note-flow.mindmap'||parsed?.schema==='note-flow.mindmap-view')return'mindmap';if(parsed?.schema==='note-flow.saved-graph-view')return'knowledge_graph'}catch{/* Non-JSON canvas formats were checked above. */}
  return undefined
}

export function normalizeCanvasDocument(value:LegacyCanvasDocumentFields):CanvasDocumentFields{
  const declared=CANVAS_TYPES.includes(value.canvasType as CanvasType)?value.canvasType as CanvasType:undefined,inferred=inferCanvasType(value)
  const canvasType=(!declared||declared==='excalidraw'&&inferred&&inferred!=='excalidraw')?inferred||'excalidraw':declared
  const defaultFormat=CANVAS_FORMATS[canvasType][0]
  return{
    canvasType,
    documentData:String(value.documentData??value.sceneData??''),
    dataFormat:CANVAS_FORMATS[canvasType].includes(String(value.dataFormat||''))?String(value.dataFormat):defaultFormat,
    dataVersion:Number.isInteger(value.dataVersion)&&Number(value.dataVersion)>0?Number(value.dataVersion):1,
    sourceMode:value.sourceMode==='linked'?'linked':'independent',
    sourceNoteUid:value.sourceMode==='linked'&&value.sourceNoteUid?String(value.sourceNoteUid):null,
  }
}

export function supportsCanvasFormat(type:CanvasType,format:string){return CANVAS_FORMATS[type].includes(format)}
