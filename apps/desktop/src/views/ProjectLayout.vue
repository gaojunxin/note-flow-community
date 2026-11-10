<script setup lang="ts">
import {saveLocalExport} from '../services/localFileExport'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import ProjectContextHeader from '../components/ProjectContextHeader.vue'
import { workspaceService, type AreaEntity, type ProjectArchiveImpact, type ProjectEntity } from '../services/workspace'

const route=useRoute(),router=useRouter(),project=ref<ProjectEntity>(),areas=ref<AreaEntity[]>([]),area=ref<AreaEntity>(),loading=ref(true),error=ref('')
const archiveOpen=ref(false),archiveBusy=ref(false),archiveImpact=ref<ProjectArchiveImpact>(),archiveError=ref(''),credentialReviewed=ref(false)
const archiveDraft=ref({taskAction:'keep' as 'keep'|'complete'|'detach',disableSeries:true,createSummary:true,summary:''})
type ProjectTab='tasks'|'notes'|'logs'
const projectUid=computed(()=>String(route.params.projectUid||''))
const activeTab=computed<ProjectTab>(()=>{const value=String(route.name||'').replace('project-','');return ['tasks','notes','logs'].includes(value)?value as ProjectTab:'tasks'})
async function load(){
  loading.value=true;error.value='';area.value=undefined
  try{
    project.value=await workspaceService.project(projectUid.value)
    if(!project.value){error.value='项目不存在或已被删除';return}
    loading.value=false
    void workspaceService.areas().then(values=>{areas.value=values;area.value=values.find(item=>item.uid===project.value?.areaUid)}).catch(()=>undefined)
    if(route.query.action==='archive'){await router.replace({path:route.path});await openArchive()}
  }catch(source){error.value=source instanceof Error?source.message:'项目加载失败'}
  finally{loading.value=false}
}
function openTab(tab:ProjectTab){router.push(`/projects/${projectUid.value}/${tab}`)}
async function setStatus(status:ProjectEntity['status']){if(!project.value)return;project.value=await workspaceService.updateProject(project.value,{status});window.dispatchEvent(new Event('note-flow:workspace-change'))}
async function openArchive(){if(!project.value)return;archiveOpen.value=true;archiveBusy.value=true;archiveError.value='';archiveImpact.value=undefined;credentialReviewed.value=false;archiveDraft.value={taskAction:'keep',disableSeries:true,createSummary:true,summary:''};try{archiveImpact.value=await workspaceService.archiveImpact(project.value)}catch(source){archiveError.value=source instanceof Error?source.message:'无法读取归档影响'}finally{archiveBusy.value=false}}
async function confirmArchive(){if(!project.value||!archiveImpact.value||!credentialReviewed.value)return;archiveBusy.value=true;archiveError.value='';try{const result=await workspaceService.archiveProject(project.value,{taskAction:archiveDraft.value.taskAction,disableSeries:archiveDraft.value.disableSeries,summary:archiveDraft.value.createSummary&&archiveDraft.value.summary.trim()?archiveDraft.value.summary.trim():undefined});if(result.project)project.value=result.project;archiveOpen.value=false;window.dispatchEvent(new Event('note-flow:workspace-change'))}catch(source){archiveError.value=source instanceof Error?source.message:'项目归档失败'}finally{archiveBusy.value=false}}
async function restoreProject(){if(!project.value)return;archiveBusy.value=true;archiveError.value='';try{project.value=await workspaceService.restoreProject(project.value,'paused');window.dispatchEvent(new Event('note-flow:workspace-change'))}catch(source){archiveError.value=source instanceof Error?source.message:'项目恢复失败'}finally{archiveBusy.value=false}}
async function exportProject(){if(!project.value)return;await saveLocalExport(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),project:project.value},null,2)],{type:'application/json'}),`${project.value.name}-项目归档.json`)}
watch(projectUid,load)
watch(()=>route.query.request,()=>{if(project.value&&route.query.action==='archive')void(async()=>{await router.replace({path:route.path});await openArchive()})()})
onMounted(load)
</script>

<template>
  <div class="project-layout" :class="{archived:project?.status==='archived'}">
    <section class="project-layout-main">
      <ProjectContextHeader v-if="project" :project="project" :area-name="area?.name" :active-tab="activeTab" @tab="openTab" @status="setStatus" @archive="openArchive" @restore="restoreProject" @export="exportProject" />
      <div v-if="project?.status==='archived'" class="project-readonly-banner"><span>这个项目已归档，历史内容仍可查看和检索。恢复后将进入“已暂停”，由你决定何时重新启动。</span><button :disabled="archiveBusy" @click="restoreProject">{{archiveBusy?'正在恢复…':'恢复为已暂停'}}</button></div>
      <p v-if="archiveError&&!archiveOpen" class="project-layout-state error">{{archiveError}}</p>
      <div v-if="loading" class="project-layout-state">正在加载项目…</div>
      <div v-else-if="error" class="project-layout-state error">{{error}}</div>
      <main v-else class="project-layout-content"><RouterView v-slot="{Component}"><KeepAlive><component :is="Component" :inert="project?.status==='archived'||undefined" /></KeepAlive></RouterView></main>
    </section>
    <div v-if="archiveOpen" class="project-create-overlay" @click.self="!archiveBusy&&(archiveOpen=false)"><form class="project-create-dialog project-archive-dialog" @submit.prevent="confirmArchive"><header><div><span class="project-create-icon">▣</span><span><h2>归档项目</h2><p>归档是退出日常工作区，不等于完成，也不会删除任何数据。</p></span></div><button type="button" :disabled="archiveBusy" @click="archiveOpen=false">×</button></header><p v-if="archiveBusy&&!archiveImpact" class="project-archive-loading">正在分析项目内容…</p><template v-else-if="archiveImpact"><section class="project-archive-impact"><span><b>{{archiveImpact.unfinishedTaskCount}}</b> 个未完成任务</span><span><b>{{archiveImpact.noteCount}}</b> 篇笔记</span><span><b>{{archiveImpact.logCount}}</b> 条日志</span><span><b>{{archiveImpact.enabledSeriesCount}}</b> 个启用中的周期系列</span></section><fieldset><legend>未完成任务如何处理</legend><label><input v-model="archiveDraft.taskAction" type="radio" value="keep"> 保留在归档项目中（只读）</label><label><input v-model="archiveDraft.taskAction" type="radio" value="complete"> 全部标记为已完成</label><label><input v-model="archiveDraft.taskAction" type="radio" value="detach"> 移出项目，保留在当前领域</label></fieldset><label class="project-archive-check"><input v-model="archiveDraft.disableSeries" type="checkbox"> 停用项目周期系列，避免归档后继续生成日报或周报</label><label class="project-archive-check"><input v-model="archiveDraft.createSummary" type="checkbox"> 创建项目收尾总结</label><textarea v-if="archiveDraft.createSummary" v-model="archiveDraft.summary" rows="4" placeholder="可选：记录交付结果、遗留问题和后续建议…"/><label class="project-archive-credential"><input v-model="credentialReviewed" type="checkbox"><span><b>我已检查项目凭据</b><small>项目密码箱采用端到端加密，凭据不会被删除或自动移动；需要时可先在“凭据”页完成交接。</small></span></label></template><p v-if="archiveError" class="project-create-error">{{archiveError}}</p><footer><button type="button" :disabled="archiveBusy" @click="archiveOpen=false">取消</button><button class="primary" :disabled="archiveBusy||!archiveImpact||!credentialReviewed">{{archiveBusy?'正在归档…':'确认归档'}}</button></footer></form></div>
  </div>
</template>
<style scoped>
.project-layout{height:100%;min-height:0;overflow:hidden}
.project-layout-main{display:flex;flex-direction:column;height:100%;min-width:0;min-height:0;overflow:hidden}
.project-layout-content{height:100%;min-height:0;flex:1;overflow:hidden}
.project-layout-state{min-height:0;flex:1}
</style>
