import {aiDataScope} from './aiDataScope'
import {learningExecutionRepository} from './learningExecutionRepository'
import {executionKey,type SkillReceipt} from './learningExecutionValidation'
export type LearningSkillReceipt=SkillReceipt
export const learningSkillKey=(scope:string,sessionUid:string,messageUid:string)=>JSON.stringify([scope,sessionUid,messageUid])
/** 只读取当前空间的本机完成事实；备份惰性回执不能抑制新空间的技能调用。 */
export async function readLearningSkillReceipt(key:string):Promise<LearningSkillReceipt|undefined>{const scope=aiDataScope();let parts:unknown;try{parts=JSON.parse(key)}catch{throw Error('技能回执身份无效')}if(Array.isArray(parts)&&parts[0]!==scope)return undefined;executionKey(key,scope,3);const repository=await learningExecutionRepository(scope);return repository.read('receipts',key)}
/** 调用方必须先确认实际执行完成并检查会话；重复提交保留首次摘要和完成时点，不代表云端确认。 */
export async function completeLearningSkill(key:string,summary:string){const scope=aiDataScope();executionKey(key,scope,3);const value={key,summary,completedAt:new Date().toISOString()},repository=await learningExecutionRepository(scope);await repository.insert('receipts',key,value);const committed=await repository.read('receipts',key);if(!committed)throw Error('技能回执提交尚未确认');return committed as LearningSkillReceipt}
