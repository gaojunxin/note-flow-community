import {toRaw} from 'vue'
import {createBrowserGovernanceService,type GovernanceStorage,type GovernanceStoreName,type GovernanceTransactionStore} from '../../services/governanceBrowser'
import type {LocalWriteTransaction} from '@note-flow/core/contracts'
import {communityProfileId,getCommunityWorkspace} from '../runtime'
export * from '../../services/governanceBrowser'
const entityTypes:Record<GovernanceStoreName,string>={items:'governance_item',candidates:'governance_candidate',sourceNodes:'governance_source_node',rules:'governance_rule',batches:'governance_batch'}
function keyFor(store:GovernanceStoreName,value:Record<string,unknown>){const key=store==='items'?value.noteUid:store==='sourceNodes'?value.path:value.uid;if(typeof key!=='string'||!key)throw Error('本地治理记录标识无效');return key}
/** Same governance algorithm; persistence joins the workspace's original writer/backup. */
export function createGovernanceService(_ownerId:string){
 const profileId=communityProfileId()
 async function storage():Promise<GovernanceStorage>{
  const workspace=await getCommunityWorkspace();if(workspace.context.profileId!==profileId)throw Error('本地空间已切换，请刷新治理页面')
  const ref=(store:GovernanceStoreName,key:string)=>({entityType:entityTypes[store],entityUid:key})
  async function put(tx:LocalWriteTransaction,store:GovernanceStoreName,input:unknown){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('本地治理记录无效');const value=toRaw(input) as Record<string,unknown>,key=keyFor(store,value),before=await tx.get(ref(store,key),{includeDeleted:true}),now=new Date().toISOString(),entity=structuredClone({...before?.value,...value,uid:key}),after=await tx.put(ref(store,key),entity,before?.revision||null);await tx.appendChange({...ref(store,key),profileId,changeId:crypto.randomUUID(),action:before&&!before.deleted?'update':'create',beforeRevision:before?.revision,afterRevision:after.revision,createdAt:now});return key}
  async function all(store:GovernanceStoreName){const values:Record<string,unknown>[]= [];let afterKey:string|undefined;do{const page=await workspace.host.listEntities(workspace.context,{entityType:entityTypes[store],limit:200,afterKey});values.push(...page.items.filter(v=>!v.deleted).map(v=>v.value));afterKey=page.hasMore?page.nextKey:undefined}while(afterKey);return values}
  return{
   get:(store,key)=>workspace.host.transaction(workspace.context,async tx=>(await tx.get(ref(store,key)))?.value),
   put:(store,value)=>workspace.host.transaction(workspace.context,tx=>put(tx,store,value)),
   getAll:all,
   async getAllFromIndex(store,index,key){if(store!=='candidates'||index!=='by-note')throw Error('不支持的本地治理索引');return(await all(store)).filter(v=>v.noteUid===key)},
   delete:(store,key)=>workspace.host.transaction(workspace.context,async tx=>{const before=await tx.get(ref(store,key));if(!before)return;const after=await tx.delete(ref(store,key),before.revision);await tx.appendChange({...ref(store,key),profileId,changeId:crypto.randomUUID(),action:'delete',beforeRevision:before.revision,afterRevision:after.revision,createdAt:new Date().toISOString()})}),
   transaction:<T>(store:GovernanceStoreName,action:(store:GovernanceTransactionStore)=>Promise<T>)=>workspace.host.transaction(workspace.context,tx=>action({get:async key=>(await tx.get(ref(store,key)))?.value,put:value=>put(tx,store,value)})),
  }
 }
 return createBrowserGovernanceService(profileId,storage)
}
