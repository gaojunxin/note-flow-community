<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import {useRouter} from 'vue-router'
import {ElButton,ElDialog,ElMessage} from 'element-plus'
import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/el-dialog.css'
import 'element-plus/theme-chalk/el-overlay.css'
import 'element-plus/theme-chalk/el-button.css'
import 'element-plus/theme-chalk/el-message.css'
import {useNotesStore} from '../stores/notes'
import {useTasksStore} from '../stores/tasks'
import {useAuthStore} from '../stores/auth'
import {workspaceService,type AreaEntity,type ProjectEntity} from '../services/workspace'
import {accountLifecycleRevision} from '../services/accountStorage'
import {clientOwnerScope} from '../services/clientContext'
import {appLock} from '../services/appLock'
import {confirmDialog} from '../services/productDialog'
import {registerLocalDraftGuard} from '../services/localDraftLifecycle'

/** 全局轻量创建：沿用业务仓储，保存前不创建空记录；打开详情由调用者选择。 */
const props=defineProps<{kind:'note'|'task'|'log'|'project';areas:AreaEntity[];projects:ProjectEntity[];areaUid?:string;projectUid?:string}>()
const emit=defineEmits<{close:[];created:[]}>()
const router=useRouter(),notes=useNotesStore(),tasks=useTasksStore(),auth=useAuthStore()
const title=ref(''),content=ref(''),area=ref(props.areaUid||''),project=ref(props.kind==='project'?'':props.projectUid||''),saving=ref(false),error=ref('')
const uid=crypto.randomUUID(),owner=clientOwnerScope(String(auth.user?.userId||'local')),lifecycle=accountLifecycleRevision()
const label=computed(()=>({note:'笔记',task:'任务',log:'日志',project:'项目'})[props.kind])
const availableProjects=computed(()=>props.projects.filter(item=>item.status!=='archived'&&(!area.value||item.areaUid===area.value)))
const dirty=()=>Boolean(title.value.trim()||content.value.trim())
function assertCurrent(){if(owner!==clientOwnerScope(String(auth.user?.userId||'local'))||lifecycle!==accountLifecycleRevision()||appLock.locked.value)throw Error('账号、空间或锁定状态已变化，请回原空间核对创建结果')}
function changeArea(){if(!availableProjects.value.some(item=>item.uid===project.value))project.value=''}
function changeProject(){const selected=props.projects.find(item=>item.uid===project.value);if(selected)area.value=selected.areaUid||''}
async function canClose(){if(saving.value)return false;return !dirty()||await confirmDialog({title:'放弃本次创建？',message:'尚未保存的内容将被丢弃。',confirmText:'放弃',cancelText:'继续编辑',tone:'warning'})}
async function close(){if(await canClose())emit('close')}
async function save(open=false){
 if(saving.value)return
 const name=title.value.trim();if(!name){error.value=`请输入${label.value}标题`;return}
 if(props.kind==='project'&&!area.value){error.value='请选择项目所属领域';return}
 saving.value=true;error.value=''
 try{
  assertCurrent()
  const selected=props.projects.find(item=>item.uid===project.value),location={areaUid:selected?.areaUid||area.value||null,projectUid:selected?.uid||null}
  let path='/notes',query:Record<string,string>={note:uid}
  // 同一次弹窗保留草稿 UID；失败不自动换身份重建，提交结果仍由业务服务校验。
  if(props.kind==='task'){
   await tasks.load();assertCurrent()
   const item=await tasks.create({uid,title:name,description:content.value.trim(),...location,priority:0,completed:false,version:0})
   path='/tasks';query={task:item.uid}
  }else if(props.kind==='project'){
   const item=await workspaceService.createProject({uid,name,description:content.value.trim()||undefined,areaUid:area.value,status:'active',progressMode:'task',sortOrder:props.projects.length})
   path=`/projects/${item.uid}/tasks`;query={}
  }else{
   const item=await notes.create({uid,title:name,content:content.value.trim(),type:props.kind==='log'?'work_log':'note',status:'active',contentFormat:'markdown',captureSource:props.kind==='log'?'quick_log_work':'pc_editor',...location},{select:false})
   if(props.kind==='log'){path='/logs';query={}}
   else query={note:item.uid}
  }
  assertCurrent();title.value='';content.value=''
  window.dispatchEvent(new Event('note-flow:workspace-change'))
  emit('created');emit('close');ElMessage.success(`${label.value}已创建`)
  if(open){await nextTick();await router.push({path,query})}
 }catch(source){error.value=source instanceof Error?source.message:'创建未完成，请检查后重试'}
 finally{saving.value=false}
}
// 弹窗关闭和应用离开都保护尚未提交的输入；切换账号时直接清除旧账号草稿。
const removeNavigationGuard=router.beforeEach(async()=>{const allowed=await canClose();if(allowed)emit('close');return allowed})
const removeDraftGuard=registerLocalDraftGuard(title,{dirty,flush:async()=>{if(saving.value||dirty())throw Error('请先保存或关闭全局新建窗口')},dismiss:()=>{void close();return true}})
watch(()=>[auth.user?.userId,accountLifecycleRevision(),appLock.locked.value],()=>{if(lifecycle!==accountLifecycleRevision()||owner!==clientOwnerScope(String(auth.user?.userId||'local'))||appLock.locked.value){title.value='';content.value='';emit('close')}})
onBeforeUnmount(()=>{removeNavigationGuard();removeDraftGuard()})
</script>
<template>
 <ElDialog :model-value="true" :title="`新建${label}`" width="min(560px, calc(100vw - 32px))" align-center append-to-body :close-on-click-modal="false" :close-on-press-escape="false" :show-close="!saving" @update:model-value="value=>{if(!value)void close()}">
  <form class="global-create-form" @submit.prevent="save()" @keydown.esc.stop.prevent="close" @keydown.ctrl.enter.prevent="save()" @keydown.meta.enter.prevent="save()">
   <p class="global-create-hint">先记下来，创建后可继续完善。创建完成后默认留在当前页面。</p>
   <label>{{label}}标题<input v-model="title" autofocus :disabled="saving" :maxlength="kind==='project'?80:200" :placeholder="`输入${label}标题`"/></label>
   <label>{{kind==='task'||kind==='project'?'描述（选填）':'正文（选填）'}}<textarea v-model="content" :disabled="saving" rows="6" :placeholder="kind==='note'||kind==='log'?'记录内容，支持 Markdown…':'补充说明…'"/></label>
   <div class="global-create-location"><label>所属领域<select aria-label="所属领域" v-model="area" :disabled="saving" @change="changeArea"><option value="">{{kind==='project'?'请选择领域':'未指定领域'}}</option><option v-for="item in areas" :key="item.uid" :value="item.uid">{{item.name}}</option></select></label><label v-if="kind!=='project'">所属项目<select aria-label="所属项目" v-model="project" :disabled="saving" @change="changeProject"><option value="">不关联项目</option><option v-for="item in availableProjects" :key="item.uid" :value="item.uid">{{item.name}}</option></select></label></div>
   <p v-if="error" role="alert" class="global-create-error">{{error}}</p>
   <footer><ElButton :disabled="saving" @click="close">取消</ElButton><span/><ElButton :disabled="saving" @click="save(true)">创建并打开</ElButton><ElButton type="primary" :loading="saving" @click="save()">创建</ElButton></footer>
  </form>
 </ElDialog>
</template>
<style scoped>
.global-create-form{max-height:calc(100dvh - 180px);overflow:auto;padding:0 4px}.global-create-hint{margin:0 0 18px;color:var(--pc-muted);font-size:12px;line-height:1.7}.global-create-form label{display:flex;flex-direction:column;gap:8px;margin:0 0 16px;font-size:13px;color:var(--pc-text)}.global-create-form input,.global-create-form textarea,.global-create-form select{box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid var(--pc-border);border-radius:8px;background:var(--pc-surface);color:var(--pc-text);font:inherit}.global-create-form textarea{resize:vertical;min-height:110px}.global-create-form :is(input,textarea,select):focus-visible{outline:2px solid var(--pc-primary);outline-offset:1px}.global-create-location{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.global-create-error{color:var(--pc-danger);font-size:12px}.global-create-form footer{display:flex;align-items:center;gap:8px;padding-top:16px;border-top:1px solid var(--pc-border)}.global-create-form footer>span{flex:1}.global-create-form footer>.el-button+.el-button{margin-left:0}@media(max-width:480px){.global-create-location{grid-template-columns:1fr}.global-create-form footer{flex-wrap:wrap}}
</style>
