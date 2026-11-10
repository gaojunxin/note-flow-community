import {assertEmptyArea} from '../../services/areaManagement'
import {journalDraft,type AreaEntity,type JournalNoteEntity,type JournalSeriesEntity,type ProjectEntity,type ProjectLogEntity} from '@note-flow/core'
import {communityWorkspace,entityRevision,attachRevision,listEntities,createEntity,updateEntity,removeEntity} from '../runtime'
import {tasksService} from './tasks'
export type {AreaEntity,JournalNoteEntity,JournalSeriesEntity,ProjectEntity,ProjectLogEntity} from '@note-flow/core'
import type {ProjectMoveImpact,ProjectArchiveImpact,ProjectArchiveRequest,ReportSourceReference,ReportGenerationInfo,WorkspaceConflict} from '../../services/contracts/workspace'
export type {ProjectMoveImpact,ProjectArchiveImpact,ProjectArchiveRequest,ReportSourceReference,ReportGenerationInfo,WorkspaceConflict} from '../../services/contracts/workspace'
const advanced=():never=>{throw Error('自动报告生成需要高级组件；已有报告与记录会保留')}
const readProject=async(uid:string)=>(await listEntities<ProjectEntity>('project')).find(value=>value.uid===uid)
export const workspaceService={
 sync:async():Promise<void>=>{throw Error('社区本地模式不提供同步')},conflicts:async():Promise<WorkspaceConflict[]>=>[],resolveConflict:async(_conflictId:string,_strategy:'local'|'server',_stamp?:unknown):Promise<void>=>{throw Error('本地社区版没有服务器冲突')},
 areas:()=>listEntities<AreaEntity>('area'),
 createArea:(value:Partial<AreaEntity>)=>createEntity<AreaEntity>('area',{name:'',kind:'custom',sortOrder:0,archived:false,...value}),
 async removeArea(value:AreaEntity){
  const workspace=await communityWorkspace(),counts=new Map<string,number>()
  const labels:Record<string,string>={project:'项目',note:'笔记',task:'任务',folder:'目录',task_list:'任务清单',journal_series:'记录系列',project_log:'项目日志',focus_session:'专注记录',canvas:'画布',knowledge:'知识'}
  let afterKey:string|undefined
  do{const page=await workspace.host.listEntities(workspace.context,{afterKey,includeDeleted:true,limit:200});for(const row of page.items)if(row.value.areaUid===value.uid)counts.set(row.entityType,(counts.get(row.entityType)||0)+1);afterKey=page.hasMore?page.nextKey:undefined}while(afterKey)
  const refs=Array.from(counts,([type,count])=>({label:labels[type]||type,count}))
  assertEmptyArea(refs);await removeEntity('area',value)
 },
 updateArea:(value:AreaEntity,changes:Partial<AreaEntity>)=>updateEntity('area',value,changes),
 async projects(areaUid?:string,includeArchived=false){return(await listEntities<ProjectEntity>('project')).filter(value=>(!areaUid||value.areaUid===areaUid)&&(includeArchived||value.status!=='archived'))},
 project:readProject,
 createProject:(value:Partial<ProjectEntity>)=>createEntity<ProjectEntity>('project',{name:'',status:'planning',progressMode:'manual',sortOrder:0,...value}),
 updateProject:(value:ProjectEntity,changes:Partial<ProjectEntity>)=>updateEntity('project',value,changes),
 async moveImpact(value:ProjectEntity,targetAreaUid:string):Promise<ProjectMoveImpact>{
  const [areas,tasks,notes,logs,series]=await Promise.all([this.areas(),tasksService.list(),listEntities<{uid:string;projectUid?:string}>('note'),listEntities<ProjectLogEntity>('project_log'),this.series()]);const target=areas.find(item=>item.uid===targetAreaUid);if(!target)throw Error('目标领域不存在')
  const folders=await listEntities<any>('folder'),lists=await listEntities<any>('task_list');return{folderCount:folders.filter(item=>item.projectUid===value.uid&&!item.deleted).length,taskListCount:lists.filter(item=>item.projectUid===value.uid&&!item.deleted).length,projectUid:value.uid,projectName:value.name,sourceAreaUid:value.areaUid,targetAreaUid,targetAreaName:target.name,noteCount:notes.filter(item=>item.projectUid===value.uid).length,taskCount:tasks.filter(item=>item.projectUid===value.uid).length,logCount:logs.filter(item=>item.projectUid===value.uid).length,seriesCount:series.filter(item=>item.projectUid===value.uid).length}
 },
 async moveProject(value:ProjectEntity,targetAreaUid:string){
  const impact=await this.moveImpact(value,targetAreaUid),workspace=await communityWorkspace()
  const linked:Array<{type:string;value:any}>=[]
  for(const type of ['note','task','folder','task_list','journal_series','project_log','canvas'])for(const item of await listEntities<any>(type))if(item.projectUid===value.uid&&!item.deleted)linked.push({type,value:item})
  if(linked.some(item=>item.type==='canvas'))throw Error('项目含独立画布，当前不能安全迁移。请先处理画布归属后重试')
  const project=await workspace.host.transaction(workspace.context,async tx=>{
   const target=await tx.get({entityType:'area',entityUid:targetAreaUid});if(!target||target.value.archived)throw Error('目标领域不存在或已归档')
   const source=await tx.get({entityType:'project',entityUid:value.uid});if(!source||source.revision!==entityRevision(value))throw Error('项目已变化，请刷新后重试')
   if(source.value.areaUid===targetAreaUid)return attachRevision(source.value,source.revision) as unknown as ProjectEntity
   let saved:ProjectEntity|undefined
   for(const item of [{type:'project',value},...linked]){
    const ref={entityType:item.type,entityUid:item.value.uid},before=await tx.get(ref)
    if(!before||before.revision!==entityRevision(item.value))throw Error('项目关联内容已变化，请刷新后重试')
    const now=new Date().toISOString(),entity={...before.value,areaUid:targetAreaUid,version:Number(before.value.version||0)+1,updatedAt:now}
    const after=await tx.put(ref,entity,before.revision)
    await tx.appendChange({...ref,profileId:workspace.context.profileId,changeId:crypto.randomUUID(),action:'update',beforeRevision:before.revision,afterRevision:after.revision,createdAt:now})
    if(item.type==='project')saved=attachRevision(entity,after.revision) as unknown as ProjectEntity
   }
   return saved!
  })
  return{...impact,project}
 },
 async archiveImpact(value:ProjectEntity):Promise<ProjectArchiveImpact>{const[tasks,notes,logs,series]=await Promise.all([tasksService.list(),listEntities<{uid:string;projectUid?:string}>('note'),this.logs(value.uid),this.series({projectUid:value.uid})]);return{projectUid:value.uid,projectName:value.name,status:value.status,unfinishedTaskCount:tasks.filter(item=>item.projectUid===value.uid&&!item.completed).length,noteCount:notes.filter(item=>item.projectUid===value.uid).length,logCount:logs.length,enabledSeriesCount:series.filter(item=>item.enabled).length}},
 async archiveProject(value:ProjectEntity,request:ProjectArchiveRequest){
  const impact=await this.archiveImpact(value)
  // Keep this local operation explicit: automated bulk completion belongs to the private workflow engine.
  if(request.taskAction==='complete'&&impact.unfinishedTaskCount)throw Error('请先在任务页完成未完成任务，再归档项目')
  if(request.taskAction==='detach')for(const task of(await tasksService.list()).filter(item=>item.projectUid===value.uid&&!item.completed))await tasksService.update({...task,projectUid:null})
  if(request.disableSeries)for(const series of await this.series({projectUid:value.uid}))if(series.enabled)await this.updateSeries(series,{enabled:false})
  let summaryNote: {uid:string;title:string}|undefined
  if(request.summary?.trim())summaryNote=await createEntity<{uid:string;title:string}>('note',{title:request.summaryTitle?.trim()||`${value.name} 归档总结`,content:request.summary.trim(),contentFormat:'markdown',type:'note',status:'inbox',areaUid:value.areaUid,projectUid:value.uid} as any)
  return{...impact,project:await updateEntity('project',value,{status:'archived'}),taskAction:request.taskAction,seriesDisabled:request.disableSeries,summaryNote}
 },
 restoreProject:(value:ProjectEntity,status:Exclude<ProjectEntity['status'],'archived'>='paused')=>updateEntity('project',value,{status}),
 async reviewLogs(projectUids:string[]){const ids=new Set(projectUids);return(await listEntities<ProjectLogEntity>('project_log')).filter(value=>ids.has(value.projectUid))},
 async logs(projectUid:string){return(await listEntities<ProjectLogEntity>('project_log')).filter(value=>value.projectUid===projectUid).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt))},
 async createLog(projectUid:string,content:string,source?:{sourceType?:string;sourceUid?:string}){const project=await readProject(projectUid);if(!project)throw Error('项目不存在');return createEntity<ProjectLogEntity>('project_log',{projectUid,areaUid:project.areaUid,content,occurredAt:new Date().toISOString(),...source})},
 updateLog:(value:ProjectLogEntity,changes:Partial<ProjectLogEntity>)=>updateEntity('project_log',value,changes),
 removeLog:(value:ProjectLogEntity)=>removeEntity('project_log',value),
 async series(params:{areaUid?:string;projectUid?:string}={}){return(await listEntities<JournalSeriesEntity>('journal_series')).filter(value=>(!params.areaUid||value.areaUid===params.areaUid)&&(!params.projectUid||value.projectUid===params.projectUid))},
 async createSeries(value:Partial<JournalSeriesEntity>){if(value.includeTasks||value.includeNotes||value.includeFocus||value.includeLogs||value.includeChildReports)advanced();return createEntity<JournalSeriesEntity>('journal_series',{name:'',kind:'journal',periodType:'daily',enabled:true,sortOrder:0,includeTasks:false,includeNotes:false,includeFocus:false,includeLogs:false,includeChildReports:false,...value})},
 async updateSeries(value:JournalSeriesEntity,changes:Partial<JournalSeriesEntity>){if(['includeTasks','includeNotes','includeFocus','includeLogs','includeChildReports'].some(key=>(changes as any)[key]===true&&(value as any)[key]!==true))advanced();return updateEntity('journal_series',value,changes)},
 async openJournal(seriesUid:string,anchor=new Date().toISOString().slice(0,10)):Promise<JournalNoteEntity>{const series=(await this.series()).find(value=>value.uid===seriesUid);if(!series||!series.enabled)throw Error('记录系列不存在或已停用');if(series.includeTasks||series.includeNotes||series.includeFocus||series.includeLogs||series.includeChildReports)advanced();const draft=journalDraft(series,anchor);const existing=(await listEntities<JournalNoteEntity>('note')).find(value=>value.journalSeriesUid===seriesUid&&value.periodKey===draft.periodKey);return existing||createEntity<JournalNoteEntity>('note',{...draft,type:'journal',status:'inbox',contentFormat:'markdown',pinned:false} as any)},
 reportGeneration:async(..._args:unknown[]):Promise<ReportGenerationInfo>=>advanced(),regenerateReport:async(..._args:unknown[]):Promise<JournalNoteEntity>=>advanced(),
}

export const localAiWorkspace=async()=>({areas:await listEntities<AreaEntity>('area'),projects:await listEntities<ProjectEntity>('project')})
