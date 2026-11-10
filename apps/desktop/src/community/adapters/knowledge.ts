import type {KnowledgeEntity,KnowledgeSource,KnowledgeTopic,KnowledgeUsage,KnowledgeRelation,KnowledgeGraph} from '../../services/contracts/knowledge'
export type {AiPolicy,KnowledgeMaturity,KnowledgeEntity,KnowledgeSource,KnowledgeTopic,KnowledgeUsage,KnowledgeRelation,KnowledgeRelationType,GraphNode,GraphEdge,KnowledgeGraph} from '../../services/contracts/knowledge'
/** 社区版不开放知识业务；旧记录由完整空间备份原样保留，此门面不读写业务库。 */
async function unavailable<T>(..._args:unknown[]):Promise<T>{throw Error('社区版不提供知识管理，该功能属于高级版本')}
export const isKnowledgeOfflineError=()=>false
export const knowledgeService={
 list:unavailable<KnowledgeEntity[]>,one:unavailable<KnowledgeEntity>,create:unavailable<KnowledgeEntity>,update:unavailable<KnowledgeEntity>,
 addSource:unavailable<KnowledgeSource>,topics:unavailable<KnowledgeTopic[]>,createTopic:unavailable<KnowledgeTopic>,linkTopic:unavailable<KnowledgeEntity>,
 usages:unavailable<KnowledgeUsage[]>,use:unavailable<KnowledgeUsage>,feedback:unavailable<KnowledgeUsage>,relations:unavailable<KnowledgeRelation[]>,
 createRelation:unavailable<KnowledgeRelation>,deleteRelation:unavailable<void>,graph:unavailable<KnowledgeGraph>
}
/** AI社区查询只返回基础资料，不读取历史知识实体。 */
export const localAiKnowledge=async():Promise<KnowledgeEntity[]>=>[]
export const createLocalAiKnowledge=unavailable<KnowledgeEntity>
export const syncKnowledgeQueue=unavailable<never>
export const inspectKnowledgeQueue=()=>[]
export const applyConfirmedKnowledgeRemoval=unavailable<void>
