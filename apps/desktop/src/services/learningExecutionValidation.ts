import type {WorkspacePlan} from './learningWorkspace'
export interface SkillReceipt {key:string;summary:string;completedAt:string}
export interface PlanRecord {key:string;plan:WorkspacePlan}
export interface ExecutionBase {scope:string;plans:PlanRecord[];receipts:SkillReceipt[]}
export interface ExecutionBackup extends ExecutionBase {version:1;archives:ExecutionBase[]}
const object=(value:unknown):value is Record<string,any>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const text=(value:unknown,max:number,empty=false)=>typeof value==='string'&&value.length<=max&&(empty||value.length>0)
const stamp=(value:unknown)=>text(value,40)&&Number.isFinite(Date.parse(value as string))
/** 复合身份必须保持原顺序，不能仅按消息/会话UID跨账号查找。 */
export function executionKey(key:string,scope:string,size:2|3){let parts:unknown;try{parts=JSON.parse(key)}catch{throw Error('执行记录身份无效，原始数据已保留')}if(!Array.isArray(parts)||parts.length!==size||parts[0]!==scope||parts.some(value=>!text(value,1024)))throw Error('执行记录空间或身份不匹配');return parts as string[]}
export function validateReceipt(value:unknown,scope:string):SkillReceipt{const v=value as SkillReceipt;if(!v||!text(v.key,2048)||!text(v.summary,10000,true)||!stamp(v.completedAt))throw Error('技能回执格式无效，原始数据已保留');executionKey(v.key,scope,3);return v}
/** 只校验持久边界与可恢复身份；领域权限、正文版本及目录影响仍由原工作区执行器核对。 */
export function validatePlanRecord(value:unknown,scope:string):PlanRecord{
 const v=value as PlanRecord;if(!v||!text(v.key,2048))throw Error('工作区方案身份无效');executionKey(v.key,scope,2);const p=v.plan
 if(!object(p)||!text(p.uid,128)||!Number.isSafeInteger(p.revision)||p.revision<0||!object(p.scope)||!text(p.scope.areaUid,128,true)||!['draft','applying','partial','completed'].includes(p.status)||!stamp(p.updatedAt)||!Array.isArray(p.actions)||p.actions.length>40||!Array.isArray(p.trace))throw Error('工作区方案格式无效，原始数据已保留')
 const keys=new Set<string>();let length=0
 for(const a of p.actions){if(!object(a)||!text(a.key,80)||keys.has(a.key)||!['note','folder','transfer'].includes(a.kind)||a.sent!==undefined&&typeof a.sent!=='boolean'||a.done!==undefined&&typeof a.done!=='boolean'||a.error!==undefined&&typeof a.error!=='string')throw Error('工作区变更格式无效');keys.add(a.key)
  if(a.kind==='note'){if(!text(a.uid,128)||!object(a.after)||!text(a.after.title,200)||!text(a.after.content,50000,true))throw Error('工作区笔记变更无效');length+=a.after.content.length}
  if(a.kind==='folder'&&(!object(a.after)||!text(a.after.name,100)))throw Error('工作区目录变更无效')
  if(a.kind==='transfer'&&(!object(a.before)||!text(a.before.uid,128)||!object(a.target)||!object(a.impact)||a.operationUid!==undefined&&!text(a.operationUid,128)))throw Error('工作区迁移变更无效')
 }
 if(length>180000||p.trace.some(row=>!object(row)||typeof row.tool!=='string'||typeof row.summary!=='string')||p.sources!==undefined&&(!object(p.sources)||Object.keys(p.sources).length>2000||Object.values(p.sources).some(v=>typeof v!=='string')))throw Error('工作区来源或处理记录无效')
 return v
}
export function validateExecutionBase(value:unknown,scope?:string):ExecutionBase{const v=value as ExecutionBase;if(!v||!text(v.scope,1024)||scope!==undefined&&v.scope!==scope||!Array.isArray(v.plans)||!Array.isArray(v.receipts)||v.plans.length+v.receipts.length>20000)throw Error('执行档案空间或格式无效');const ids=new Set<string>();for(const plan of v.plans){validatePlanRecord(plan,v.scope);if(ids.has(plan.key))throw Error('工作区方案重复');ids.add(plan.key)}ids.clear();for(const receipt of v.receipts){validateReceipt(receipt,v.scope);if(ids.has(receipt.key))throw Error('技能回执重复');ids.add(receipt.key)}return v}
/** 恢复只接收平铺的惰性档案，不把历史sent/done或已完成技能提升为当前执行凭据。 */
export function validateExecutionBackup(value:unknown,scope?:string):ExecutionBackup{const v=value as ExecutionBackup;validateExecutionBase(v,scope);if(v.version!==1||!Array.isArray(v.archives)||v.archives.length>20000)throw Error('执行备份版本无效');v.archives.forEach(base=>validateExecutionBase(base));return v}
