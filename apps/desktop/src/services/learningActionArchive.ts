import {aiDataScope} from './aiDataScope'
import {learningActionRepository} from './learningActionRepository'
import {validateLearningActions} from './learningActionValidation'
export {validateLearningActions} from './learningActionValidation'
export async function exportLearningActions(scope=aiDataScope()){if(scope!==aiDataScope())throw Error('账号或空间已切换，已取消成果备份');const repository=await learningActionRepository();repository.check();if(scope!==repository.scope)throw Error('账号或空间已切换，已取消成果备份');return repository.snapshot()}
/** 恢复仅补缺失草稿/固定成果身份并移除历史租约，不自动调用commit或执行外部写入。 */
export async function restoreLearningActions(value:unknown){const scope=aiDataScope(),valid=validateLearningActions(value,scope),repository=await learningActionRepository();repository.check();if(scope!==repository.scope)throw Error('成果恢复空间已切换');await repository.restore(valid)}
