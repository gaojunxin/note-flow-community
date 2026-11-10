import {toRaw} from 'vue'
import type {CanvasEntity,CanvasSnapshot} from '../../services/contracts/canvases'
import {normalizeCanvasDocument} from '../../services/canvasDocument'
import {createCommunityCanvases} from '../canvasService'
import {communityWorkspace,listEntities,entityRevision,attachRevision} from '../runtime'
export type {CanvasEntity,CanvasSnapshot} from '../../services/contracts/canvases'
function normalize(value:Partial<CanvasEntity>){const document=normalizeCanvasDocument(value);return{...value,...document,sceneData:document.documentData,documentData:document.documentData}}
export function createCanvasService(_ownerId:string){
 async function mutate(value:CanvasEntity,changes:Partial<CanvasEntity>,deleted=false){
  const workspace=await communityWorkspace(),ref={entityType:'canvas',entityUid:value.uid}
  return workspace.host.transaction(workspace.context,async tx=>{
   const before=await tx.get(ref);if(!before)throw Error('画布不存在')
   if(entityRevision(value)&&entityRevision(value)!==before.revision)throw Error('画布已变化，请重新加载')
   const previous=before.value as unknown as CanvasEntity;if(previous.version!==value.version)throw Error('画布已变化，请重新加载')
   const now=new Date().toISOString(),snapshotUid=`${value.uid}:${previous.version}`
   const snapshotRef={entityType:'canvas_snapshot',entityUid:snapshotUid},existing=await tx.get(snapshotRef)
   if(!existing){const snapshot=await tx.put(snapshotRef,{uid:snapshotUid,canvasUid:value.uid,version:previous.version,sceneChecksum:previous.sceneChecksum||'',createdAt:now,document:previous},null);await tx.appendChange({...snapshotRef,profileId:workspace.context.profileId,changeId:crypto.randomUUID(),action:'create',afterRevision:snapshot.revision,createdAt:now})}
   const entity={...previous,...toRaw(value),...normalize({...previous,...toRaw(changes)}),version:previous.version+1,updatedAt:now,deleted}
   const after=deleted?await tx.delete(ref,before.revision):await tx.put(ref,entity,before.revision)
   await tx.appendChange({...ref,profileId:workspace.context.profileId,changeId:crypto.randomUUID(),action:deleted?'delete':'update',beforeRevision:before.revision,afterRevision:after.revision,createdAt:now})
   return attachRevision(entity,after.revision) as CanvasEntity
  })
 }
 return{
  async list(){return(await listEntities<CanvasEntity>('canvas')).map(value=>attachRevision({...value,...normalizeCanvasDocument(value)},entityRevision(value)!)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))},
  async create(input:Partial<CanvasEntity>={}){const workspace=await communityWorkspace(),now=new Date().toISOString(),sceneData=input.documentData??input.sceneData??JSON.stringify({type:'excalidraw',version:2,elements:[],appState:{viewBackgroundColor:'#ffffff'},files:{}});const row=await createCommunityCanvases(workspace.host,workspace.context).create({title:'未命名画布',status:'active',textIndex:'',sourceFormat:'native',version:0,deleted:false,createdAt:now,updatedAt:now,...normalize({...toRaw(input),documentData:sceneData})});return attachRevision(row.entity,row.revision) as unknown as CanvasEntity},
  async createMany(inputs:Partial<CanvasEntity>[]){const results:CanvasEntity[]=[];for(const input of inputs)results.push(await this.create(input));return results},
  update:(value:CanvasEntity,changes:Partial<CanvasEntity>)=>mutate(value,changes),
  remove:(value:CanvasEntity)=>mutate(value,{},true),
  async snapshots(value:CanvasEntity):Promise<CanvasSnapshot[]>{return(await listEntities<CanvasSnapshot&{uid:string;canvasUid:string}>('canvas_snapshot')).filter(row=>row.canvasUid===value.uid).sort((a,b)=>b.version-a.version).slice(0,30)},
  async restore(value:CanvasEntity,version:number){const snapshot=(await listEntities<{uid:string;canvasUid:string;version:number;document:CanvasEntity}>('canvas_snapshot')).find(row=>row.canvasUid===value.uid&&row.version===version);if(!snapshot)throw Error('找不到画布历史版本');return mutate(value,{...snapshot.document,uid:value.uid,createdAt:value.createdAt})},
  sync:async()=>{},
 }
}
