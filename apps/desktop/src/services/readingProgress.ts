import {createReadingProgress,clearStoredReadingProgress,type ReadingProgressRow} from '../../../../packages/core/src/readingProgress'
import {accountLifecycleRevision} from './accountStorage'
import {clientOwnerScope} from './clientContext'
import {syncAvailable} from './profiles'
import api from './api'
/** 本机位置以profile隔离；生命周期代次仅用于拒绝旧回执，不进入持久键。 */
export function readingProgress(ownerId:string){
 const revision=accountLifecycleRevision(),scope=()=>`${clientOwnerScope(ownerId)}${accountLifecycleRevision()===revision?'':':expired'}`
 const bound=scope(),options={readingBoundary:()=>scope()===bound} as any
 return createReadingProgress({storage:localStorage,scope,remote:!syncAvailable()?undefined:{
  async read(sha:string){return(await api.get(`/api/v1/reading-progress/${sha}`,options)).data.data},
  async write(sha:string,value:ReadingProgressRow){return(await api.put(`/api/v1/reading-progress/${sha}`,{page:value.page,pages:value.pages,offset:value.offset,zoom:value.zoom,version:value.version,operationId:value.operationId},options)).data.data}
 }})
}

export function clearReadingProgress(ownerId:string){clearStoredReadingProgress(localStorage,clientOwnerScope(ownerId))}
