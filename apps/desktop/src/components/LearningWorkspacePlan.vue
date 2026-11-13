<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref} from 'vue'
import {ElButton} from 'element-plus'
import {aiDataScope} from '../services/aiDataScope'
import {accountLifecycleRevision} from '../services/accountStorage'
import {workspacePlanStore,createLearningWorkspace,withWorkspaceLock} from '../services/learningWorkspaceStore'
import type {WorkspacePlan,WorkspaceAction,WorkspaceScope} from '../services/learningWorkspace'
import {workspaceTextDiff} from '../services/workspaceTextDiff'
import {workspaceService,type AreaEntity,type ProjectEntity} from '../services/workspace'
import {foldersService,type FolderEntity} from '../services/folders'
import {folderPath} from '../services/folderDestinations'
import {useNotesStore} from '../stores/notes'
import {requestLocalSync} from '../services/syncSignals'
const props=defineProps<{sessionUid:string;disabled?:boolean}>()
const emit=defineEmits<{'busy-change':[value:boolean];resume:[scope:WorkspaceScope]}>()
const plan=ref<WorkspacePlan>(),expanded=ref(false),busy=ref(false),error=ref(''),folders=ref<FolderEntity[]>([]),areas=ref<AreaEntity[]>([]),projects=ref<ProjectEntity[]>([])
const scope=aiDataScope(),revision=accountLifecycleRevision(),store=workspacePlanStore(scope,props.sessionUid)
let alive=true,loadRevision=0,metadataLoading=false,metadataReady=false
async function metadata(){if(metadataReady||metadataLoading)return;metadataLoading=true;try{const [f,a,p]=await Promise.all([foldersService.list(),workspaceService.areas(),workspaceService.projects(undefined,true)]);check();folders.value=f;areas.value=a;projects.value=p;metadataReady=true}catch{/* Names remain available from before/after snapshots. */}finally{metadataLoading=false}}
function check(){if(!alive||scope!==aiDataScope()||revision!==accountLifecycleRevision())throw Error('账号或空间已切换，请重新打开讨论')}
const completed=computed(()=>plan.value?.actions.filter(a=>a.done).length||0)
const status=computed(()=>({draft:'待确认',applying:'执行中，可恢复',partial:'部分完成，可重试',completed:'已完成'}[plan.value?.status||'draft']))
async function reload(){const id=++loadRevision;try{const value=await store.read();check();if(id===loadRevision){plan.value=value;if(value?.actions.length)void metadata()}}catch(e){if(alive)error.value=e instanceof Error?e.message:'方案读取失败'}}
function updated(event:Event){const detail=(event as CustomEvent).detail;if(detail?.scope===scope&&detail.sessionUid===props.sessionUid)void reload()}
onMounted(async()=>{window.addEventListener('note-flow:learning-workspace-updated',updated);await reload()})
onBeforeUnmount(()=>{alive=false;emit('busy-change',false);window.removeEventListener('note-flow:learning-workspace-updated',updated)})
const name=(a:WorkspaceAction)=>a.kind==='note'?a.after.title:a.kind==='folder'?a.after.name:a.before.name
const projectedFolders=computed(()=>{const rows=[...folders.value];for(const a of plan.value?.actions||[]){if(a.kind!=='folder')continue;const uid=a.before?.uid||`draft:${a.key}`,row={...(a.before||{id:-rows.length-1,uid,version:0}),...a.after,uid,parentId:null},i=rows.findIndex(f=>f.uid===uid);if(i<0)rows.push(row);else rows[i]=row}return rows})
function path(uid:string|null|undefined,after=true){if(!uid)return '顶级 / 未分类';const rows=after?projectedFolders.value:folders.value,f=rows.find(f=>f.uid===uid);return f?folderPath(f,rows):'原目录（名称暂未载入）'}
function scopeLabel(value:{areaUid?:string|null;projectUid?:string|null}){const a=areas.value.find(a=>a.uid===value.areaUid),p=projects.value.find(p=>p.uid===value.projectUid);const area=a?a.name+(areas.value.filter(v=>v.name===a.name).length>1?` · ${a.uid.slice(-8)}`:''):value.areaUid?'领域名称暂未载入':'未指定领域';const project=p?p.name+(projects.value.filter(v=>v.name===p.name&&(v.areaUid||null)===(p.areaUid||null)).length>1?` · ${p.uid.slice(-8)}`:''):value.projectUid?'项目名称暂未载入':'未关联项目';return `${area} / ${project}`}

async function apply(){if(busy.value||props.disabled||!plan.value)return;busy.value=true;emit('busy-change',true);error.value='';try{check();await withWorkspaceLock(scope,props.sessionUid,async()=>{check();await useNotesStore().flushPendingSaves();check();const latest=await store.read();check();if(!latest||latest.uid!==plan.value!.uid||latest.revision!==plan.value!.revision)throw Error('方案已变化，请重新查看后确认');await createLearningWorkspace(props.sessionUid,latest).apply();check();requestLocalSync();await useNotesStore().reloadLocal();check();window.dispatchEvent(new Event('note-flow:workspace-change'))})}catch(e){if(alive)error.value=e instanceof Error?e.message:'执行失败，已保留进度'}finally{busy.value=false;emit('busy-change',false);if(alive)await reload()}}
async function discard(){if(!plan.value||busy.value||props.disabled)return;try{check();await withWorkspaceLock(scope,props.sessionUid,async()=>{check();await store.clear(plan.value!.revision,plan.value!.uid)});plan.value=undefined;error.value=''}catch(e){error.value=e instanceof Error?e.message:'丢弃失败'}}
</script>
<template>
 <section v-if="plan&&(plan.actions.length||error)" class="learning-workspace-plan" aria-label="笔记工作区方案">
  <header><ElButton text size="small" :aria-expanded="expanded" @click="expanded=!expanded">笔记工作区 · {{plan.actions.length}} 项变更 · {{status}} {{expanded?'收起':'查看方案'}}</ElButton><ElButton v-if="plan.status==='draft'" text size="small" :disabled="busy||disabled" @click="emit('resume',plan.scope)">继续调整</ElButton><span v-if="completed">已完成 {{completed}} 项</span></header>
  <div v-if="expanded" class="workspace-review">
   <p>核对整批变更后确认一次。也可以继续聊天调整待确认方案；不会删除原笔记。执行中断后重试原批次，已完成项会跳过。</p>
   <article v-for="a in plan.actions" :key="a.key" :aria-label="'变更：'+name(a)"><strong>{{a.done?'已完成':a.before?'调整':'新增'}} · {{name(a)}}</strong>
    <template v-if="a.kind==='folder'"><div class="workspace-comparison"><section><small>调整前</small><p>{{a.before?scopeLabel(a.before)+' / '+path(a.before.parentUid,false)+' / '+a.before.name:'尚未创建'}}</p></section><section><small>调整后</small><p>{{scopeLabel(a.after)}} / {{path(a.after.parentUid)}} / {{a.after.name}}</p></section></div></template>
    <template v-else-if="a.kind==='transfer'"><p>整棵跨领域 / 项目迁移：{{a.impact.folderCount}} 个目录、{{a.impact.noteCount}} 篇内容，包含归档 {{a.impact.archivedNoteCount}} 篇、回收站 {{a.impact.trashNoteCount}} 篇。保留正文和层级。</p><p>目标：{{scopeLabel(a.target)}} / {{path(a.target.parentUid)}}</p></template>
    <template v-else><div class="workspace-comparison"><section><small>调整前</small><p>{{a.before?.title||'尚未创建'}} · {{a.before?scopeLabel(a.before)+' / '+path(a.before.folderUid||folders.find(f=>f.id===a.before?.folderId)?.uid,false):'—'}}</p></section><section><small>调整后</small><p>{{a.after.title}} · {{scopeLabel(a.after)}} / {{path(a.after.folderUid)}}</p></section></div><details v-if="!a.before||a.before.content!==a.after.content"><summary>查看正文变更 · {{a.after.content.length}} 字符</summary><div class="workspace-comparison"><section><small>修改前</small><pre>{{workspaceTextDiff(a.before?.content||'',a.after.content).prefix}}</pre><pre class="workspace-removed">{{workspaceTextDiff(a.before?.content||'',a.after.content).removed}}</pre><pre>{{workspaceTextDiff(a.before?.content||'',a.after.content).suffix}}</pre></section><section><small>修改后</small><pre>{{workspaceTextDiff(a.before?.content||'',a.after.content).prefix}}</pre><pre class="workspace-added">{{workspaceTextDiff(a.before?.content||'',a.after.content).added}}</pre><pre>{{workspaceTextDiff(a.before?.content||'',a.after.content).suffix}}</pre></section></div></details></template>
    <p v-if="a.error" class="workspace-error">{{a.error}}</p>
   </article>
   <details v-if="plan.trace.length"><summary>查看处理记录 · {{plan.trace.length}} 项</summary><p v-for="(row,i) in plan.trace" :key="i">{{row.tool}} · {{row.summary}}</p></details>
   <footer><ElButton v-if="plan.status==='draft'" :disabled="busy||disabled" @click="discard">丢弃方案</ElButton><ElButton v-if="plan.status!=='completed'" type="primary" :loading="busy" :disabled="busy||disabled||!plan.actions.length" @click="apply">{{plan.status==='draft'?`确认应用 ${plan.actions.length} 项变更`:'重试未完成项'}}</ElButton><span v-else role="status">本批次已完成，可继续聊天处理下一项任务。</span></footer>
  </div>
  <p v-if="error" role="alert" class="workspace-error">{{error}}</p>
 </section>
</template>
<style scoped>
.learning-workspace-plan{flex-shrink:0;box-sizing:border-box;width:100%;max-width:1040px;margin:8px auto;border:1px solid var(--pc-border);border-radius:10px;background:var(--pc-surface,#fff);font-size:12px}.learning-workspace-plan header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:5px 10px}.learning-workspace-plan header>span{color:var(--pc-muted)}.workspace-review{max-height:42vh;overflow:auto;padding:0 14px 12px}.workspace-review>p{color:var(--pc-muted);line-height:1.7}.workspace-review article{padding:12px 0;border-top:1px solid var(--pc-border)}.workspace-comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px;margin:10px 0}.workspace-comparison section{min-width:0}.workspace-comparison p{overflow-wrap:anywhere}.workspace-comparison small{color:var(--pc-muted)}.workspace-comparison pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font-family:inherit;line-height:1.7;margin:0}.workspace-removed{background:#fff0ef;color:#922e2e}.workspace-added{background:#edf8ef;color:#22623b}.workspace-review summary{cursor:pointer;margin:8px 0}.workspace-review footer{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}.workspace-error{color:var(--pc-danger,#ad4141);padding:0 12px;overflow-wrap:anywhere}@media(max-width:650px){.workspace-comparison{grid-template-columns:1fr}}
</style>
