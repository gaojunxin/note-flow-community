import type {ReadingProgressRow} from '../../../../packages/core/src/readingProgress'
import {clientIntentRepository} from './clientIntentRepository'
import {accountLifecycleRevision} from './accountStorage'
import {clientOwnerScope} from './clientContext'
/** 本机位置端口捕获账号/世代；SQL或IDB失败不改用localStorage，调用方须等待提交。 */
export function createReadingProgressStore(ownerId:string){
 const revision=accountLifecycleRevision(),scope=clientOwnerScope(ownerId),generation=localStorage.getItem('note-flow-ai-data-generation:'+scope),community=localStorage.getItem('note-flow-community-profile-v1'),check=()=>{if(scope!==clientOwnerScope(ownerId)||revision!==accountLifecycleRevision()||generation!==localStorage.getItem('note-flow-ai-data-generation:'+scope)||community!==localStorage.getItem('note-flow-community-profile-v1'))throw Error('阅读账号或空间已切换')}
 let ready:ReturnType<typeof clientIntentRepository>|undefined
 const port=()=>ready??=clientIntentRepository('reading',ownerId).catch(error=>{ready=undefined;throw error})
 return{check,async read(sha:string){check();return(await port()).invoke<ReadingProgressRow|null>('read',{uid:sha})},async compare(sha:string,expected:ReadingProgressRow|null,value:ReadingProgressRow){check();await(await port()).invoke('compare',{uid:sha,expected,value})}}
}
/** 账号云端重置才清理位置，普通附件缓存清理不得调用；旧源和旧句柄由epoch退役。 */
export async function clearReadingProgress(ownerId:string){await(await clientIntentRepository('reading',ownerId)).invoke('clear')}
