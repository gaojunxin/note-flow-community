<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { journalPeriod, seriesMatchesReview, type NoteEntity, type JournalSeriesEntity, type ReviewPeriod, type ReviewScope } from '@note-flow/core'
import { useNotesStore } from '../stores/notes'
import { workspaceService } from '../services/workspace'
import { confirmDialog } from '../services/productDialog'
import { autonomousReviewContent, replaceAutonomousReviewContent } from '../reviews/reviewReport'
import { reviewDraftTemplate, reviewGuides } from '../reviews/reviewContent'
import { reviewPeriodTitle } from '../reviews/reviewWorkbench'
const MarkdownEditor=defineAsyncComponent(()=>import('./MarkdownEditor.vue'))
const MarkdownPreview=defineAsyncComponent(()=>import('./MarkdownPreview.vue'))
const props=defineProps<{period:ReviewPeriod;anchor:string;scope:ReviewScope;summaries:NoteEntity[];series:JournalSeriesEntity[];loading:boolean}>()
const emit=defineEmits<{saved:[note:NoteEntity];seriesCreated:[series:JournalSeriesEntity];details:[note:NoteEntity]}>()
const notes=useNotesStore()
type Draft={title:string;content:string;original:string;note?:NoteEntity;seriesUid:string;busy:boolean;error:string;editing:boolean;period:ReviewPeriod;anchor:string;scope:ReviewScope}
const drafts=reactive<Record<string,Draft>>({}),selections=reactive<Record<string,string>>({})
const contextKey=computed(()=>JSON.stringify([props.period,journalPeriod(props.period,props.anchor).start,props.scope]))
const selected=computed(()=>props.summaries.find(note=>note.uid===selections[contextKey.value])||props.summaries[0])
const draftKey=computed(()=>contextKey.value+'|'+(selected.value?.uid||'new'))
const draft=computed(()=>drafts[draftKey.value])
const preview=computed(()=>autonomousReviewContent(selected.value?.content||''))
function edit(){
  if(props.loading)return
  if(draft.value){draft.value.editing=true;return}
  const note=selected.value,content=note?autonomousReviewContent(note.content):reviewDraftTemplate(props.period)
  drafts[draftKey.value]={title:note?.title||`${reviewPeriodTitle(props.anchor,props.period)} ${reviewGuides[props.period].name}`,content,original:note?content:'',note,seriesUid:note?.journalSeriesUid||props.series[0]?.uid||'',busy:false,error:'',editing:true,period:props.period,anchor:props.anchor,scope:{...props.scope}}
}
const dirty=(value:Draft)=>value.content!==value.original||value.title!==(value.note?.title||'')
async function cancel(){if(draft.value&&dirty(draft.value)&&!await confirmDialog('放弃这份未保存的总结草稿？'))return;delete drafts[draftKey.value]}
async function save(){
  const value=draft.value,key=draftKey.value,context=contextKey.value
  if(!value||value.busy||!value.title.trim())return
  value.busy=true;value.error=''
  try{
    let note=value.note
    if(!note){
      if(!value.seriesUid){
        const scope=value.scope
        // Recheck before creating: the initial metadata request may have failed
        // or another period draft may already have created this series.
        const existing=(await workspaceService.series()).filter(item=>!item.deleted&&item.enabled!==false&&seriesMatchesReview(item,{period:value.period,scope}))
        if(existing.length>1)throw new Error('此范围存在多个总结系列，请重新进入页面并选择保存位置；当前草稿仍保留')
        const series=existing[0]||await workspaceService.createSeries({name:reviewGuides[value.period].name,kind:'custom',periodType:value.period,areaUid:scope.kind==='personal'?null:scope.areaUid||null,projectUid:scope.kind==='project'?scope.projectUid:null,includeTasks:true,includeNotes:true,includeLogs:true,includeFocus:false,includeChildReports:true,enabled:true,sortOrder:0})
        value.seriesUid=series.uid;emit('seriesCreated',series)
      }
      note=await workspaceService.openJournal(value.seriesUid,value.anchor) as NoteEntity
      value.note=note
    }
    const saved=await notes.updateEntity(note,{title:value.title.trim(),content:replaceAutonomousReviewContent(note.content,value.content)})
    selections[context]=saved.uid;delete drafts[key];emit('saved',saved)
  }catch(error){value.error=error instanceof Error?error.message:'总结保存失败，草稿仍保留'}finally{value.busy=false}
}
function addReference(title:string,url:string){
  edit();const value=draft.value;if(!value||value.busy)return
  const link=`[${title.replace(/[\[\]\\\r\n]/g,' ')}](${url})`
  if(value.content.includes(link))return
  if(!value.content.includes('## 参考材料'))value.content+='\n\n## 参考材料\n'
  value.content+=`\n- ${link}\n`
}
const hasUnsaved=computed(()=>Object.values(drafts).some(value=>value.busy||dirty(value)))
onBeforeRouteLeave(async()=>!hasUnsaved.value||await confirmDialog('仍有未保存的回顾草稿，离开将丢弃草稿。是否离开？'))
function beforeUnload(event:BeforeUnloadEvent){if(hasUnsaved.value){event.preventDefault();event.returnValue=''}}
onMounted(()=>window.addEventListener('beforeunload',beforeUnload))
onBeforeUnmount(()=>window.removeEventListener('beforeunload',beforeUnload))
defineExpose({addReference})
</script>

<template>
  <section class="surface review-writing">
    <header><div><small>{{reviewGuides[period].name}}</small><h2>本期总结</h2></div><button v-if="!draft?.editing" class="primary-action" :disabled="loading" @click="edit">{{selected?'编辑总结':'开始写总结'}}</button></header>
    <p class="guide">{{reviewGuides[period].prompt}}</p>
    <p v-if="Object.keys(drafts).length" class="draft-hint">本次打开共暂存 {{Object.keys(drafts).length}} 份草稿，可切回对应周期继续编辑。</p>
    <label v-if="summaries.length>1">已保存的总结 <select v-model="selections[contextKey]"><option v-for="note in summaries" :key="note.uid" :value="note.uid">{{note.title}}</option></select></label>
    <template v-if="draft?.editing">
      <p class="draft-hint">切换周期会暂存草稿；离开回顾前请保存。下期计划请写在“下期计划”标题下，可使用列表或待办项。</p>
      <label v-if="!draft.note&&series.length>1">保存到 <select v-model="draft.seriesUid" :disabled="draft.busy"><option v-for="item in series" :key="item.uid" :value="item.uid">{{item.name}}</option></select></label>
      <fieldset :disabled="draft.busy"><input v-model="draft.title" aria-label="本期总结标题"><MarkdownEditor v-model="draft.content" /></fieldset>
      <p v-if="draft.error" role="alert">{{draft.error}}</p>
      <footer><button :disabled="draft.busy" @click="cancel">放弃草稿</button><button class="primary-action" :disabled="draft.busy||!draft.title.trim()" @click="save">{{draft.busy?'保存中…':'保存总结'}}</button></footer>
    </template>
    <template v-else-if="selected"><h3>{{selected.title}}</h3><MarkdownPreview v-if="preview" :content="preview"/><p v-else>尚未填写自主总结，自动明细可在来源与计划中查看。</p><button @click="emit('details',selected)">来源与计划 · 查看自动明细 / 转换任务</button></template>
    <p v-else class="empty">{{loading?'正在查找已有总结…':'还没有本期总结。先回看右侧材料，再记下你的认识；不必为了填满每个周期而写。'}}</p>
  </section>
</template>

<style scoped>
.review-writing{padding:24px;min-width:0;align-self:start}.review-writing header,.review-writing footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.review-writing h2{margin:4px 0;font-size:20px}.review-writing h3{font-size:18px}.review-writing small,.guide,.draft-hint,.empty{color:var(--pc-muted)}.guide,.empty{line-height:1.8;font-size:14px}.draft-hint{font-size:12px;line-height:1.7}.review-writing button,.review-writing select,.review-writing input{font:inherit;font-size:13px}.review-writing button{padding:9px 12px;border:1px solid var(--pc-border);border-radius:7px;cursor:pointer}.review-writing input{width:100%;padding:10px;border:1px solid var(--pc-border);border-radius:6px;margin-bottom:12px}.review-writing fieldset{border:0;padding:0;margin:14px 0;min-width:0}.review-writing fieldset:disabled{pointer-events:none;opacity:.7}.review-writing :deep(.markdown-editor){min-height:360px}.review-writing footer{justify-content:flex-end}.review-writing label{display:flex;gap:10px;align-items:center;margin:12px 0;font-size:13px}.review-writing [role=alert]{color:#b54735}
</style>
