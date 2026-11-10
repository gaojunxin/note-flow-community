<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onDeactivated,ref,watch} from 'vue'
import {ElButton,ElDialog,ElInput} from 'element-plus'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/button/style/css'
import {createReadingFinder,readingMatches} from '@note-flow/core/reader-find'
/** 仅检索调用方阅读区的已渲染正文；结果使用文本片段，切文或离开必须清理 Range。 */
const props=defineProps<{contentSelector:string;documentKey?:string}>()
const visible=ref(false),query=ref(''),input=ref<InstanceType<typeof ElInput>|null>(null)
const results=ref<{heading:string;before:string;match:string;after:string}[]>([]),limit=ref(100)
const shownResults=computed(()=>results.value.slice(0,limit.value))
const finder=createReadingFinder();let observer:MutationObserver|undefined,serial=0,pending=-1
async function scan(){
 const run=++serial;await nextTick();if(run!==serial||!visible.value)return
 const root=document.querySelector<HTMLElement>(props.contentSelector)
 // 片段与定位使用相同匹配规则，不改写正文 DOM；仅分批渲染结果行。
 const headings=Array.from(root?.querySelectorAll('h1,h2,h3,h4,h5,h6')||[]).reverse()
 results.value=readingMatches(root,query.value).map(range=>{
  const heading=headings.find(item=>item.contains(range.startContainer)||Boolean(item.compareDocumentPosition(range.startContainer)&Node.DOCUMENT_POSITION_FOLLOWING))?.textContent||'正文'
  const block=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer as Element:range.commonAncestorContainer.parentElement
  const context=block?.closest('p,h1,h2,h3,h4,h5,h6,li,pre,td,th,blockquote')||root
  if(!context)return {heading,before:'',match:range.toString(),after:''}
  const prefix=range.cloneRange();prefix.selectNodeContents(context);prefix.setEnd(range.startContainer,range.startOffset)
  const suffix=range.cloneRange();suffix.selectNodeContents(context);suffix.setStart(range.endContainer,range.endOffset)
  const before=prefix.toString(),after=suffix.toString()
  return {heading,before:(before.length>55?'…':'')+before.slice(-55),match:range.toString(),after:after.slice(0,85)+(after.length>85?'…':'')}
 });limit.value=100;finder.scan(root,query.value)
}
function disconnect(){observer?.disconnect();observer=undefined}
async function show(){
 pending=-1;visible.value=true;await nextTick();disconnect()
 const root=document.querySelector(props.contentSelector)
 if(root){observer=new MutationObserver(()=>void scan());observer.observe(root,{childList:true,subtree:true,characterData:true})}
 await scan()
}
function close(){serial++;disconnect();visible.value=false;pending=-1;finder.clear()}
function choose(index:number){pending=index;serial++;disconnect();visible.value=false}
function afterClosed(){
 // 弹窗解除滚动锁并归还焦点后再定位；切文清理会取消尚未执行的定位。
 if(pending>=0){finder.activate(pending);pending=-1}
}
function reset(){close();query.value='';results.value=[]}
watch(query,()=>void scan());watch(()=>props.documentKey,reset)
onBeforeUnmount(reset);onDeactivated(reset)
</script>
<template>
 <div class="reader-find-control">
  <button type="button" class="plain pc-action pc-action--text reader-find-open" aria-label="查找正文" aria-haspopup="dialog" @click="show"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><span>查找</span></button>
  <ElDialog :model-value="visible" title="查找本文" width="min(640px, 94vw)" top="10vh" append-to-body @update:model-value="!$event&&visible&&close()" @opened="input?.focus()" @closed="afterClosed">
   <div class="reader-find-dialog" role="search" aria-label="正文查找">
    <ElInput ref="input" v-model="query" clearable placeholder="输入关键词，搜索当前文章" aria-label="查找正文关键词" @keydown.enter.prevent="results.length&&choose(0)"/>
    <p class="reader-find-summary" role="status">{{query.trim()?`找到 ${results.length} 处匹配`:'搜索当前文章，点击结果跳转到正文'}}</p>
    <div v-if="results.length" class="reader-find-results" aria-label="正文搜索结果">
     <button v-for="(result,index) in shownResults" :key="index" type="button" class="pc-action pc-action--secondary reader-find-result" :aria-label="`定位第 ${index+1} 处匹配`" @click="choose(index)"><span class="reader-find-result-number">{{String(index+1).padStart(2,'0')}}</span><span class="reader-find-result-content"><span class="reader-find-result-heading">{{result.heading}}</span><span class="reader-find-result-snippet">{{result.before}}<mark>{{result.match}}</mark>{{result.after}}</span></span><span class="reader-find-result-arrow" aria-hidden="true">↗</span></button>
     <ElButton v-if="limit<results.length" text @click="limit+=100">显示更多结果（{{shownResults.length}} / {{results.length}}）</ElButton>
    </div>
    <p v-else-if="query.trim()" class="reader-find-empty">没有匹配的内容，请尝试其他关键词</p>
   </div>
  </ElDialog>
 </div>
</template>
<style scoped>
.reader-find-control{min-width:0}.reader-find-control svg{width:15px;height:15px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.reader-find-open{display:inline-flex;align-items:center;gap:5px;min-height:30px;padding:0 8px;font-size:12px}
.reader-find-summary{margin:12px 0;color:var(--pc-muted);font-size:12px}
.reader-find-results{max-height:55vh;overflow:auto;display:flex;flex-direction:column;gap:6px}
.reader-find-result{--pc-control-height:64px;--pc-control-font-size:13px;display:flex;align-items:flex-start;gap:12px;flex:none;box-sizing:border-box;width:100%;padding:12px;text-align:left;white-space:normal;line-height:1.65;border:1px solid var(--pc-border);border-radius:var(--pc-control-radius,6px);background:var(--pc-surface,transparent)}
.reader-find-result:hover,.reader-find-result:focus-visible{border-color:var(--pc-primary);background:var(--pc-primary-soft)}
.reader-find-result-number{flex:none;color:var(--pc-muted);font-size:11px;font-variant-numeric:tabular-nums;padding-top:2px}.reader-find-result-content{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}.reader-find-result-heading{font-size:11px;color:var(--pc-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reader-find-result-snippet{font-size:13px;overflow-wrap:anywhere;color:var(--pc-text)}.reader-find-result-arrow{flex:none;color:var(--pc-muted);font-size:14px}.reader-find-result mark{padding:1px 2px;border-radius:3px;background:var(--pc-primary-soft);color:var(--pc-primary);font-weight:600}
.reader-find-empty{padding:28px 0;text-align:center;color:var(--pc-muted);font-size:13px}
</style>
