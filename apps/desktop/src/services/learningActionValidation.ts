import {aiDataScope} from './aiDataScope'
import {validateLearningCache,type LearningActionProposal,type LearningActionOperation} from '@note-flow/core/ai-learning'
function validDraft(v:any,expectedScope:string){
 if(!v||typeof v!=='object'||v.scope!==expectedScope||!['knowledge','tasks'].includes(v.kind))throw Error('成果备份空间或类型不匹配')
 const fields:Record<string,number>={uid:64,sessionUid:64,title:200,conclusion:1000,content:50000,applicability:4000,limitations:4000,areaUid:64,projectUid:64,createdAt:40}
 for(const [key,max] of Object.entries(fields))if(typeof v[key]!=='string'||v[key].length>max)throw Error('成果备份字段无效')
 if(!v.uid||!v.sessionUid||!Number.isFinite(Date.parse(v.createdAt))||!v.model||!['local','personal','server'].includes(v.model.channel)||typeof v.model.model!=='string'||v.model.model.length>200||Object.keys(v.model).some(k=>!['channel','model'].includes(k)))throw Error('成果模型信息无效')
 validateLearningCache({sessions:[{uid:v.sessionUid,revision:1,title:'',input:'',draft:'',draftSources:[],messages:[v.message]}],selectedUid:'',input:'',draft:'',sources:[]})
 if(v.message.role!=='assistant'||v.message.status!=='complete'||!Array.isArray(v.tasks)||v.tasks.length>20)throw Error('成果来源或任务无效')
 const keys=new Set();for(const task of v.tasks){if(!task||typeof task.key!=='string'||!task.key||task.key.length>64||keys.has(task.key)||typeof task.selected!=='boolean'||typeof task.title!=='string'||task.title.length>200||typeof task.description!=='string'||task.description.length>8000||![0,1,2,3].includes(task.priority)||task.estimatedMinutes!==null&&(!Number.isInteger(task.estimatedMinutes)||task.estimatedMinutes<1||task.estimatedMinutes>10080)||task.parentKey!==null&&typeof task.parentKey!=='string')throw Error('成果任务字段无效');keys.add(task.key);for(const date of [task.startAt,task.dueAt])if(date!==null&&(typeof date!=='string'||!Number.isFinite(Date.parse(date))))throw Error('成果日期无效')}
 // 持久字段采用白名单，备份不能携带凭据或未经支持的可执行附加字段。
 const allowed=new Set([...Object.keys(fields),'scope','kind','message','model','tasks']);if(Object.keys(v).some(k=>!allowed.has(k)))throw Error('成果备份包含不支持的字段')
}
/** 校验迁移/恢复档案与空间；验证成功不授予自动执行资格，失败不得覆盖源档案。 */
export function validateLearningActions(value:unknown,expectedScope=aiDataScope()):{drafts:LearningActionProposal[];operations:LearningActionOperation[]}{
 const v=value as any;if(!v||!Array.isArray(v.drafts)||!Array.isArray(v.operations)||v.drafts.length>1000||v.operations.length>1000)throw Error('成果备份格式无效')
 const ids=new Set<string>();for(const draft of v.drafts){validDraft(draft,expectedScope);if(ids.has(draft.uid))throw Error('成果草稿重复');ids.add(draft.uid)}
 ids.clear();for(const operation of v.operations){if((operation.lease===undefined)!==(operation.leaseUntil===undefined)||operation.lease!==undefined&&(typeof operation.lease!=='string'||!operation.lease||operation.lease.length>64||!Number.isSafeInteger(operation.leaseUntil)||operation.leaseUntil<=0))throw Error('成果租约格式无效');validDraft(operation.proposal,expectedScope);if(operation.uid!==operation.proposal.uid||ids.has(operation.uid)||operation.signature!==JSON.stringify(operation.proposal)||!Array.isArray(operation.results)||operation.results.length>20)throw Error('成果操作备份无效');ids.add(operation.uid);const results=new Set();for(const result of operation.results){if(!result||typeof result.uid!=='string'||!result.uid||result.uid.length>64||results.has(result.uid)||!['knowledge','task'].includes(result.kind)||!['pending','saved','failed'].includes(result.status)||typeof result.title!=='string'||result.title.length>200||result.error!==undefined&&(typeof result.error!=='string'||result.error.length>1000))throw Error('成果结果备份无效');results.add(result.uid)}}return v
}
