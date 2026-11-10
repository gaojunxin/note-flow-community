import {localLearningScope,localLearningService} from '../../services/localAiLearning'
export const usingClientAi=()=>true
export const learningScope=localLearningScope
export const learningService=localLearningService

export async function importServerLearningHistory():Promise<{restored:number;skipped:number}>{throw Error('社区版不连接账号服务器')}
