<script setup lang="ts">
import {computed,defineAsyncComponent,onBeforeUnmount,onMounted,ref} from 'vue'
import {ElButton} from 'element-plus'
import type {LearningSession} from '@note-flow/core/ai-learning'
import {aiDataScope} from '../services/aiDataScope'
import {accountLifecycleRevision} from '../services/accountStorage'
import {parseLearningSkill,learningSkillLabel} from '../services/learningSkills'
import {learningSkillKey,readLearningSkillReceipt,completeLearningSkill} from '../services/learningSkillReceipts'
const AiNoteSeriesDialog=defineAsyncComponent(()=>import('./AiNoteSeriesDialog.vue'))
const FolderOrganizationDialog=defineAsyncComponent(()=>import('./FolderOrganizationDialog.vue'))
const props=defineProps<{session:LearningSession;messageUid:string;ownerId:string;disabled?:boolean}>()
const emit=defineEmits<{saved:[uid:string]}>()
const message=props.session.messages.find(m=>m.uid===props.messageUid)!
const parsed=parseLearningSkill(message.content),call=parsed.call
const scope=aiDataScope(),revision=accountLifecycleRevision(),key=learningSkillKey(scope,props.session.uid,props.messageUid)
const snapshot=JSON.parse(JSON.stringify(props.session)) as LearningSession
const open=ref(false),loading=ref(true),summary=ref(''),error=ref('')
let alive=true,release:(()=>void)|undefined
const label=computed(()=>call?learningSkillLabel(call.skill):'技能请求未启用')
function check(){if(!alive||aiDataScope()!==scope||accountLifecycleRevision()!==revision)throw Error('账号或空间已切换，请重新打开讨论')}
onMounted(async()=>{try{const saved=await readLearningSkillReceipt(key);check();summary.value=saved?.summary||''}catch(e){error.value=e instanceof Error?e.message:'无法读取执行记录'}finally{loading.value=false}})
function close(){open.value=false;release?.();release=undefined}
onBeforeUnmount(()=>{alive=false;close()})
async function start(){if(!call||props.disabled||loading.value||summary.value||open.value)return;loading.value=true;error.value=''
 try{check();if(!navigator.locks)throw Error('当前环境不支持跨窗口操作锁，请使用独立的目录整理或系列笔记入口')
  let acquired!:(ok:boolean)=>void;const ready=new Promise<boolean>(resolve=>acquired=resolve)
  void navigator.locks.request('note-flow-learning-skill:'+key,{ifAvailable:true},async lock=>{if(!lock){acquired(false);return}await new Promise<void>(resolve=>{release=resolve;acquired(true);if(!alive)resolve()})}).catch(()=>acquired(false))
  if(!await ready)throw Error('此技能正在另一个窗口处理，请在该窗口继续')
  check();const saved=await readLearningSkillReceipt(key);check();if(saved){summary.value=saved.summary;close();return}
  open.value=true
 }catch(e){close();error.value=e instanceof Error?e.message:'无法准备技能'}finally{loading.value=false}
}
async function record(summaryText:string){check();const receipt=await completeLearningSkill(key,summaryText);check();summary.value=receipt.summary}
async function recordSeries(uids:string[]){await record(`已创建 ${uids.length} 篇笔记及所需目录`)}
async function recordDirectory(count:number){await record(`已完成 ${count} 篇笔记的目录整理`)}
function created(uids:string[]){if(uids[0])emit('saved',uids[0])}
</script>
<template>
 <section class="learning-skill-card" aria-label="会话技能">
  <strong>{{label}}</strong>
  <template v-if="call"><p>{{call.instruction}}</p><small>先准备并预览方案，确认应用后才修改资料。</small><p v-if="summary" role="status">{{summary}} · 此调用已完成</p><ElButton v-else :disabled="disabled||loading||open" @click="start">{{loading?'正在读取执行记录…':'准备方案'}}</ElButton></template>
  <p v-if="parsed.error||error" role="alert">{{parsed.error||error}}</p>
 </section>
 <AiNoteSeriesDialog v-if="open&&call?.skill==='create_note_series'" :owner-id="ownerId" :session="snapshot" :through-uid="messageUid" :draft-key="'skill:'+messageUid" :initial-instruction="call.instruction" :initial-area-uid="call.areaUid" :initial-project-uid="call.projectUid" :initial-folder-uid="call.folderUid" :record-result="recordSeries" @created="created" @close="close"/>
 <FolderOrganizationDialog v-if="open&&call?.skill==='organize_note_directory'" :owner-id="ownerId" :initial-instruction="call.instruction" :initial-area-uid="call.areaUid" :initial-project-uid="call.projectUid" :initial-folder-uid="call.folderUid" :record-result="recordDirectory" @close="close"/>
</template>
<style scoped>
.learning-skill-card{display:grid;justify-items:start;gap:10px;margin-top:14px;padding:14px 16px;border:1px solid var(--pc-border);border-radius:12px;background:var(--pc-surface-muted,#f5f8f6);font-size:13px;overflow-wrap:anywhere}.learning-skill-card p{margin:0;white-space:pre-wrap;line-height:1.7}.learning-skill-card small{color:var(--pc-muted);line-height:1.6}.learning-skill-card [role=alert]{color:var(--pc-danger,#b54747)}
</style>
