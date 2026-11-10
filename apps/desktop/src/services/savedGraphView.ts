export const SAVED_GRAPH_VIEW_SCHEMA='note-flow.saved-graph-view' as const
export const SAVED_GRAPH_VIEW_VERSION=1 as const

export type GraphLayoutMode='force'|'radial'|'hierarchical'

export interface SavedGraphViewV1{
  schema:typeof SAVED_GRAPH_VIEW_SCHEMA
  version:typeof SAVED_GRAPH_VIEW_VERSION
  centerNodeUid:string|null
  depth:1|2
  filters:{nodeTypes:string[];relationTypes:string[];query:string;includeOrphans:boolean}
  pinnedNodeUids:string[]
  layoutOverrides:Record<string,{x:number;y:number}>
  viewport:{x:number;y:number;zoom:number}
  labelConfig:{visible:boolean;maxLength:number}
  styleConfig:{layout:GraphLayoutMode;nodeScale:number;edgeOpacity:number}
}

export interface SavedGraphViewValidation{
  valid:boolean
  errors:string[]
  value?:SavedGraphViewV1
}

const own=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key)
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const finite=(value:unknown,fallback:number,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback
const uid=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():null
const strings=(value:unknown,limit=100)=>[...new Set((Array.isArray(value)?value:[]).filter((item):item is string=>typeof item==='string').map(item=>item.trim()).filter(Boolean))].slice(0,limit)
const allowedRoot=new Set(['schema','version','centerNodeUid','depth','filters','pinnedNodeUids','layoutOverrides','viewport','labelConfig','styleConfig'])

export function createSavedGraphView(input:Partial<SavedGraphViewV1>={}):SavedGraphViewV1{
  const filters:Record<string,unknown>=object(input.filters)?input.filters:{}
  const viewport:Record<string,unknown>=object(input.viewport)?input.viewport:{}
  const labels:Record<string,unknown>=object(input.labelConfig)?input.labelConfig:{}
  const style:Record<string,unknown>=object(input.styleConfig)?input.styleConfig:{}
  const overrides:SavedGraphViewV1['layoutOverrides']={}
  if(object(input.layoutOverrides))for(const [key,position] of Object.entries(input.layoutOverrides).slice(0,1000)){
    const normalizedUid=uid(key)
    if(!normalizedUid||!object(position))continue
    const x=finite(position.x,Number.NaN,-1_000_000,1_000_000),y=finite(position.y,Number.NaN,-1_000_000,1_000_000)
    if(Number.isFinite(x)&&Number.isFinite(y))overrides[normalizedUid]={x,y}
  }
  const layout:GraphLayoutMode=style.layout==='radial'||style.layout==='hierarchical'?style.layout:'force'
  return{
    schema:SAVED_GRAPH_VIEW_SCHEMA,
    version:SAVED_GRAPH_VIEW_VERSION,
    centerNodeUid:uid(input.centerNodeUid),
    depth:input.depth===2?2:1,
    filters:{
      nodeTypes:strings(filters.nodeTypes),relationTypes:strings(filters.relationTypes),
      query:typeof filters.query==='string'?filters.query.trim().slice(0,500):'',
      includeOrphans:filters.includeOrphans===true,
    },
    pinnedNodeUids:strings(input.pinnedNodeUids,1000),layoutOverrides:overrides,
    viewport:{x:finite(viewport.x,0,-1_000_000,1_000_000),y:finite(viewport.y,0,-1_000_000,1_000_000),zoom:finite(viewport.zoom,1,0.05,8)},
    labelConfig:{visible:labels.visible!==false,maxLength:Math.round(finite(labels.maxLength,48,8,200))},
    styleConfig:{layout,nodeScale:finite(style.nodeScale,1,0.5,3),edgeOpacity:finite(style.edgeOpacity,0.65,0.1,1)},
  }
}

/** Strictly validates persisted input. Normalization is returned only for valid v1 documents. */
export function validateSavedGraphView(input:unknown):SavedGraphViewValidation{
  const errors:string[]=[]
  if(!object(input))return{valid:false,errors:['document must be an object']}
  for(const key of Object.keys(input))if(!allowedRoot.has(key))errors.push(`unsupported field: ${key}`)
  if(input.schema!==SAVED_GRAPH_VIEW_SCHEMA)errors.push(`schema must be ${SAVED_GRAPH_VIEW_SCHEMA}`)
  if(input.version!==SAVED_GRAPH_VIEW_VERSION)errors.push('version must be 1')
  if(input.centerNodeUid!==null&&!uid(input.centerNodeUid))errors.push('centerNodeUid must be a non-empty string or null')
  if(input.depth!==1&&input.depth!==2)errors.push('depth must be 1 or 2')
  if(!object(input.filters))errors.push('filters must be an object')
  if(!Array.isArray(input.pinnedNodeUids))errors.push('pinnedNodeUids must be an array')
  if(!object(input.layoutOverrides))errors.push('layoutOverrides must be an object')
  if(!object(input.viewport))errors.push('viewport must be an object')
  if(!object(input.labelConfig))errors.push('labelConfig must be an object')
  if(!object(input.styleConfig))errors.push('styleConfig must be an object')
  // Graph business data must always be resolved from the native knowledge projection.
  if(own(input,'nodes')||own(input,'edges'))errors.push('nodes and edges cannot be persisted in a saved graph view')
  return errors.length?{valid:false,errors}:{valid:true,errors,value:createSavedGraphView(input as Partial<SavedGraphViewV1>)}
}

export function parseSavedGraphView(serialized:string):SavedGraphViewValidation{
  try{return validateSavedGraphView(JSON.parse(serialized))}catch{return{valid:false,errors:['document is not valid JSON']}}
}

export function savedGraphViewTextIndex(view:SavedGraphViewV1,resolveLabel?:(uid:string)=>string|undefined):string{
  const uids=[view.centerNodeUid,...view.pinnedNodeUids].filter((item):item is string=>Boolean(item))
  const labels=resolveLabel?uids.map(resolveLabel).filter((item):item is string=>Boolean(item)):[]
  return [...labels,view.filters.query,...view.filters.nodeTypes,...view.filters.relationTypes].filter(Boolean).join(' ').replace(/\s+/g,' ').trim().slice(0,10_000)
}
