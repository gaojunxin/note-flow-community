import type {KnowledgeCardRepository,KnowledgeCard} from '../../../../../packages/core/src/contracts/knowledgeCards'
/** 卡片业务不在社区版开放；此门面不打开旧数据库或创建新任务，历史库由备份独立读取。 */
export const knowledgeCardsRepository=new Proxy({} as KnowledgeCardRepository,{get(){return async()=>{throw Error('知识卡片属于高级版本功能')}}})
export async function syncKnowledgeCards():Promise<void>{throw Error('知识卡片属于高级版本功能')}
export async function getKnowledgeCardDisplay(_uid:string):Promise<{card:KnowledgeCard;dispose():void}>{throw Error('知识卡片属于高级版本功能')}
