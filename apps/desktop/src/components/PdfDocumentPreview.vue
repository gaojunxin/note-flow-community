<script setup lang="ts">
import {ElButton,ElDialog,ElPopover} from 'element-plus'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/popover/style/css'
import {computed,shallowRef,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {readPdfOutline,resolvePdfOutline,type PdfOutlineEntry} from '../../../../packages/core/src/pdfOutline'
import type {ReadingPosition} from '../../../../packages/core/src/readingProgress'
import type {PDFDocumentLoadingTask,PDFDocumentProxy} from 'pdfjs-dist'
import {readingProgress} from '../services/readingProgress'
import {pdfPreviewEngine,pdfPreviewError,pdfPreviewOptions} from '../services/pdfPreview'
import {pdfContinuousLayout,pdfPageAt,pdfVisiblePages,PDF_PAGE_GAP,type PdfPageSize} from '../services/pdfContinuousLayout'
import PdfPageCanvas from './PdfPageCanvas.vue'

/** 接收已校验PDF及进度空间；document-info、document-actions插槽合并外层信息/操作，文档加载失败通过error返回，单页失败原位重试。 */
const props=defineProps<{blob:Blob;filename:string;ownerId:string}>(),emit=defineEmits<{error:[message:string]}>()
const stage=ref<HTMLElement>(),page=ref(1),pages=ref(0),zoom=ref(1),loading=ref(false),error=ref('')
const pdfDocument=shallowRef<PDFDocumentProxy>(),sizes=shallowRef(new Map<number,PdfPageSize>())
const fallbackSize=ref<PdfPageSize>({width:612,height:792}),viewportWidth=ref(800),viewportHeight=ref(600)
const fitWidth=ref(true),visiblePages=shallowRef(new Set<number>())
const boxes=computed(()=>pdfContinuousLayout(pages.value,sizes.value,fallbackSize.value,viewportWidth.value,zoom.value,fitWidth.value))
const totalHeight=computed(()=>{const last=boxes.value.at(-1);return last?last.top+last.height+PDF_PAGE_GAP:0})
const displayZoom=computed(()=>boxes.value[page.value-1]?.scale||zoom.value)
const progressMessage=ref(''),progressConflict=ref(false),progressNeedsSync=ref(false),progressSaveFailed=ref(false)
const outline=shallowRef<PdfOutlineEntry[]>([]),outlineOpen=ref(false),outlineLoading=ref(false),outlineError=ref(''),outlineBusy=ref(false)
let resizeObserver:ResizeObserver|undefined,resizeFrame=0,outlineNavigation=0,navigation=0,layoutRevision=0
let progress:ReturnType<typeof readingProgress>|undefined,sha='',syncTimer:ReturnType<typeof setTimeout>|undefined,scrollTimer:ReturnType<typeof setTimeout>|undefined,positionRevision=0,restoring=false
let generation=0,task:PDFDocumentLoadingTask|undefined

function updateVisible(trackPage=true){
 const element=stage.value;if(!element||!boxes.value.length)return
 visiblePages.value=pdfVisiblePages(boxes.value,element.scrollTop,element.clientHeight)
 if(trackPage){
  const bottom=element.scrollTop>0&&element.scrollTop>=element.scrollHeight-element.clientHeight-2
  page.value=bottom?pages.value:boxes.value[pdfPageAt(boxes.value,element.scrollTop+PDF_PAGE_GAP)].page
 }
}
function position():ReadingPosition{
 const element=stage.value,box=boxes.value[page.value-1]
 // 沿用原跨端契约：offset只表示当前页内的可滚动比例，不能保存整本文档的滚动比例。
 const range=box&&element?Math.max(0,box.height-element.clientHeight):0
 return{page:page.value,pages:pages.value,zoom:displayZoom.value,offset:range&&element&&box?Math.max(0,Math.min(1,(element.scrollTop-box.top)/range)):0}
}
function scrollToPosition(value:ReadingPosition){
 const element=stage.value,box=boxes.value[value.page-1];if(!element||!box)return
 page.value=value.page;element.scrollTop=box.top+value.offset*Math.max(0,box.height-element.clientHeight)
 updateVisible(false)
}
function measured(number:number,size:PdfPageSize){
 const previous=sizes.value.get(number)||fallbackSize.value
 if(previous.width===size.width&&previous.height===size.height)return
 const anchor=position(),revision=positionRevision,request=generation,layout=++layoutRevision
 sizes.value=new Map(sizes.value).set(number,size)
 // 后续页面可能有不同纸张尺寸；替换占位高度时保持阅读锚点，不让正文随测量结果跳动。
 void nextTick(()=>{if(request===generation&&layout===layoutRevision&&revision===positionRevision&&!restoring){scrollToPosition(anchor)}})
}
async function goTo(target:number,offset=0,point?:{left:number|null;top:number|null},persist=true){
 const pdf=pdfDocument.value;if(!pdf||target<1||target>pages.value)return false
 const request=generation,token=++navigation;positionRevision++;clearTimeout(scrollTimer);restoring=true
 try{
  const sheet=await pdf.getPage(target);if(request!==generation||token!==navigation)return false
  error.value=''
  const original=sheet.getViewport({scale:1});sizes.value=new Map(sizes.value).set(target,{width:original.width,height:original.height})
  await nextTick();if(request!==generation||token!==navigation)return false
  scrollToPosition({page:target,pages:pages.value,zoom:displayZoom.value,offset})
  if(stage.value){
   stage.value.scrollLeft=0
   if(point?.top!==null&&point?.top!==undefined){
    const box=boxes.value[target-1],coordinates=sheet.getViewport({scale:box.scale}).convertToViewportPoint(point.left??0,point.top)
    stage.value.scrollTop=box.top+Math.max(0,Math.min(box.height-1,coordinates[1]));if(point.left!==null)stage.value.scrollLeft=Math.max(0,coordinates[0]);updateVisible(false)
   }
  }
  // 程序滚动事件在本帧处理完后才恢复进度写入，避免把恢复位置误认为用户的新阅读操作。
  await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
  if(request!==generation||token!==navigation)return false
  restoring=false;if(persist)await savePosition();return true
 }finally{if(request===generation&&token===navigation)restoring=false}
}
async function loadOutline(pdf:PDFDocumentProxy,request:number){
 outlineLoading.value=true;outlineError.value=''
 try{const entries=await readPdfOutline(pdf);if(request===generation)outline.value=entries}
 catch{if(request===generation)outlineError.value='大纲读取失败，正文仍可阅读，请重试'}
 finally{if(request===generation)outlineLoading.value=false}
}
function retryOutline(){if(pdfDocument.value)void loadOutline(pdfDocument.value,generation)}
async function selectOutline(entry:PdfOutlineEntry){
 const pdf=pdfDocument.value,request=generation,token=++outlineNavigation;if(!pdf)return
 outlineBusy.value=true;outlineError.value='';positionRevision++
 try{
  const target=await resolvePdfOutline(pdf,entry.dest)
  if(request!==generation||token!==outlineNavigation)return
  if(await goTo(target.page,0,target)&&request===generation&&token===outlineNavigation)outlineOpen.value=false
 }catch{if(request===generation&&token===outlineNavigation)outlineError.value='无法跳转此目录项，当前位置已保留，请选择其他章节'}
 finally{if(request===generation&&token===outlineNavigation)outlineBusy.value=false}
}
function dispose(){navigation++;layoutRevision++;visiblePages.value=new Set();pdfDocument.value=undefined;void task?.destroy().catch(()=>undefined);task=undefined}
async function savePosition(){
 if(restoring||!pages.value||!sha||!progress)return
 const active=progress,key=sha,request=generation,revision=++positionRevision,value=position()
 progressMessage.value='正在保存阅读进度…'
 try{await active.save(key,value);if(request!==generation||revision!==positionRevision)return;progressSaveFailed.value=false;progressNeedsSync.value=true;progressMessage.value='阅读进度已保存在本机';scheduleSync()}catch{if(request!==generation||revision!==positionRevision)return;progressSaveFailed.value=true;progressMessage.value='阅读进度尚未保存，请检查本机存储后重试'}
}
function scheduleSync(){clearTimeout(syncTimer);const active=progress,key=sha,request=generation;syncTimer=setTimeout(()=>{void active?.sync(key).then(async()=>{if(request!==generation)return;const row=await active.read(key);if(request!==generation)return;progressConflict.value=Boolean(active.conflict());if(row?.dirty===false){progressNeedsSync.value=false;progressMessage.value=row.version>0?'阅读进度已同步':'阅读进度已保存在本机'}else if(row?.dirty&&active.cloudEnabled&&!active.conflict())scheduleSync()}).catch(()=>{if(request===generation)progressMessage.value=progressSaveFailed.value?'阅读进度尚未保存，请保留文档并重试':'阅读进度已保存在本机，联网后重试同步'})},800)}
function userInteracted(){positionRevision++;if(restoring){navigation++;restoring=false}}
function scrolled(){
 if(restoring){updateVisible(false);return}
 // 页码同步更新，保证滚动后立即关闭时仍保存实际所在页；仅持久化操作做防抖。
 positionRevision++;updateVisible();clearTimeout(scrollTimer);scrollTimer=setTimeout(savePosition,300)
}
async function restorePosition(value:ReadingPosition|null){if(value)await goTo(Math.min(pages.value,value.page),value.offset,undefined,false)}
async function resolveProgress(useCloud:boolean){const request=generation;try{const value=await progress?.resolve(sha,useCloud);if(request!==generation)return;progressConflict.value=false;progressSaveFailed.value=false;progressNeedsSync.value=Boolean(value?.dirty);progressMessage.value=value&&!value.dirty&&value.version>0?'阅读进度已同步':'阅读进度已保存在本机';if(useCloud&&value)await restorePosition(value);if(request===generation&&(!useCloud||value?.dirty))scheduleSync()}catch(source){if(request===generation)progressMessage.value=source instanceof Error?source.message:'阅读进度冲突尚未解决'}}
async function load(){
 savePosition();if(sha)void progress?.sync(sha).catch(()=>{});clearTimeout(syncTimer);clearTimeout(scrollTimer)
 const request=++generation;outlineNavigation++;outline.value=[];outlineOpen.value=false;outlineBusy.value=false;outlineError.value='';dispose()
 progress=readingProgress(props.ownerId);sha='';progressMessage.value='';progressSaveFailed.value=false;progressConflict.value=false;restoring=false;loading.value=true;error.value='';pages.value=0;page.value=1;zoom.value=1;fitWidth.value=true;sizes.value=new Map()
 try{
  const engine=await pdfPreviewEngine(),bytes=new Uint8Array(await props.blob.arrayBuffer());if(request!==generation)return
  const hash=await crypto.subtle.digest('SHA-256',bytes);if(request!==generation)return;sha=[...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('')
  task=engine.getDocument(pdfPreviewOptions(bytes));const pdf=await task.promise;if(request!==generation)return
  const first=await pdf.getPage(1);if(request!==generation)return
  const initial=first.getViewport({scale:1});fallbackSize.value={width:initial.width,height:initial.height};sizes.value=new Map([[1,fallbackSize.value]])
  pdfDocument.value=pdf;pages.value=pdf.numPages;loading.value=false;void loadOutline(pdf,request)
  await nextTick();if(request!==generation)return
  if(stage.value){viewportWidth.value=stage.value.clientWidth||800;viewportHeight.value=stage.value.clientHeight}
  const activeProgress=progress;let local:Awaited<ReturnType<typeof activeProgress.read>>=null
  try{local=await activeProgress.read(sha)}catch{if(request===generation){progressSaveFailed.value=true;progressMessage.value='本机阅读进度暂不可用，当前位置尚未保存'}}
  if(request!==generation)return
  await goTo(local?.page||1,local?.offset||0,undefined,false)
  if(request!==generation)return
  const active=progress,key=sha,revision=positionRevision
  void active.open(key).then(async value=>{if(request!==generation)return;progressConflict.value=Boolean(active.conflict());if(positionRevision===revision&&value&&!value.dirty)await restorePosition(value);if(request!==generation)return;if(!active.conflict())scheduleSync()}).catch(()=>{if(request===generation)progressMessage.value=progressSaveFailed.value?'本机阅读进度暂不可用，当前位置尚未保存':'使用本机阅读进度，云端暂不可用'})
 }catch(source){if(request===generation){error.value=pdfPreviewError(source);emit('error',error.value)}}
 finally{if(request===generation)loading.value=false}
}
function move(offset:number){void goTo(page.value+offset).catch(source=>{error.value=pdfPreviewError(source)})}
function jump(event:Event){const input=event.target as HTMLInputElement,next=Number(input.value);if(Number.isInteger(next)&&next>=1&&next<=pages.value)void goTo(next).catch(source=>{error.value=pdfPreviewError(source)});else input.value=String(page.value)}
async function reflow(change:()=>void){
 const anchor=position(),request=generation,revision=positionRevision;change();await nextTick()
 if(request===generation&&revision===positionRevision){await goTo(anchor.page,anchor.offset,undefined,false)}
}
function actualSize(){void reflow(()=>{fitWidth.value=false;zoom.value=1})}
function scale(offset:number){const value=Math.max(.25,Math.min(3,displayZoom.value+offset));void reflow(()=>{fitWidth.value=false;zoom.value=value})}
function adaptWidth(){void reflow(()=>{fitWidth.value=true})}
onMounted(()=>{
 resizeObserver=new ResizeObserver(()=>{
  const element=stage.value;if(!element)return
  const width=element.clientWidth,height=element.clientHeight
  if(Math.abs(width-viewportWidth.value)<1&&Math.abs(height-viewportHeight.value)<1)return
  cancelAnimationFrame(resizeFrame)
  resizeFrame=requestAnimationFrame(()=>{void reflow(()=>{viewportWidth.value=width;viewportHeight.value=height})})
 })
 if(stage.value)resizeObserver.observe(stage.value)
})
watch(()=>[props.blob,props.ownerId],()=>void load(),{immediate:true})
globalThis.addEventListener('online',scheduleSync)
onBeforeUnmount(()=>{resizeObserver?.disconnect();cancelAnimationFrame(resizeFrame);globalThis.removeEventListener('online',scheduleSync);savePosition();clearTimeout(syncTimer);clearTimeout(scrollTimer);void progress?.sync(sha).catch(()=>{});generation++;dispose()})
</script>
<template>
  <section class="pdf-document-preview" :aria-label="`PDF 预览：${filename}`">
    <nav v-if="pages" class="pdf-toolbar" :class="{'pdf-toolbar--file':$slots['document-info']}" aria-label="PDF 翻页和缩放">
      <div v-if="$slots['document-info']" class="pdf-toolbar-info"><slot name="document-info"/></div>
      <div class="pdf-toolbar-controls">
      <ElButton aria-label="PDF 大纲" aria-haspopup="dialog" @click="outlineOpen=true">{{$slots['document-info']?'目录':'PDF 大纲'}}</ElButton>
      <button type="button" aria-label="上一页" title="上一页" :disabled="page<=1" @click="move(-1)">{{$slots['document-info']?'‹':'上一页'}}</button>
      <span>第 {{page}} / {{pages}} 页</span><input :value="page" type="number" min="1" :max="pages" aria-label="跳转页码" @change="jump" style="width:60px;min-height:32px"/>
      <button type="button" aria-label="下一页" title="下一页" :disabled="page>=pages" @click="move(1)">{{$slots['document-info']?'›':'下一页'}}</button>
      <button type="button" :disabled="displayZoom<=.25" aria-label="缩小 PDF" @click="scale(-.25)">−</button>
      <span>{{Math.round(displayZoom*100)}}%</span>
      <button type="button" :disabled="displayZoom>=3" aria-label="放大 PDF" @click="scale(.25)">＋</button>
      <button type="button" @click="actualSize">100%</button>
      <button type="button" aria-label="适应宽度" title="适应宽度" @click="adaptWidth">{{$slots['document-info']?'↔':'适应宽度'}}</button>
      <ElPopover v-if="progressMessage" trigger="click" placement="bottom-end" :width="260">
        <template #reference><ElButton text :title="progressMessage" :aria-label="`阅读进度：${progressMessage}`"><span aria-hidden="true">{{progressNeedsSync?'↻':'✓'}}</span></ElButton></template>
        <p role="status">{{progressMessage}}</p><ElButton v-if="progressNeedsSync&&progress?.cloudEnabled" size="small" @click="scheduleSync">重试同步</ElButton>
      </ElPopover>
      </div>
      <div v-if="$slots['document-actions']" class="pdf-toolbar-actions"><slot name="document-actions"/></div>
    </nav>
    <ElDialog v-model="outlineOpen" title="PDF 大纲" width="min(560px, 92vw)" append-to-body @closed="outlineNavigation++;outlineBusy=false">
      <div class="pdf-outline" :aria-busy="outlineLoading||outlineBusy">
        <p v-if="outlineLoading" role="status">正在读取大纲…</p>
        <p v-if="outlineError" role="alert">{{outlineError}} <ElButton @click="retryOutline">重新读取大纲</ElButton></p>
        <p v-else-if="!outlineLoading&&!outline.length" role="status">此 PDF 未提供内置大纲。正文中的目录页暂不自动识别。</p>
        <ol v-if="outline.length" aria-label="PDF章节目录"><li v-for="entry in outline" :key="entry.id" :style="{'padding-left':`${Math.min(entry.depth,8)*16}px`}"><ElButton text :disabled="!entry.dest||outlineBusy" :aria-label="`${entry.title}，第${entry.depth+1}级章节`" @click="selectOutline(entry)">{{entry.title}}<span v-if="!entry.dest">（无跳转位置）</span></ElButton></li></ol>
      </div>
    </ElDialog>
    <p v-if="progressConflict" role="status">其他设备有不同的阅读位置。<button type="button" @click="resolveProgress(true)">使用云端位置</button><button type="button" @click="resolveProgress(false)">保留本机位置</button></p>
    <p v-else-if="progressSaveFailed" class="pdf-error" role="alert">阅读进度保存失败，请检查本机存储空间。</p>
    <p v-if="loading" role="status">正在读取 PDF…</p>
    <p v-if="error" class="pdf-error" role="alert">{{error}}</p>
    <div ref="stage" class="pdf-page-stage" role="region" aria-label="PDF 连续阅读区" tabindex="0" :aria-busy="loading" @scroll.passive="scrolled" @wheel.passive="userInteracted" @pointerdown="userInteracted" @keydown="userInteracted">
      <div v-if="pdfDocument&&!error" class="pdf-page-stack" :style="{height:`${totalHeight}px`}">
        <div v-for="box in boxes" :key="box.page" class="pdf-page-slot" :data-page="box.page" :style="{top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`}">
          <PdfPageCanvas v-if="visiblePages.has(box.page)" :pdf="pdfDocument" :page="box.page" :scale="box.scale" :filename="filename" @measure="measured(box.page,$event)"/>
        </div>
      </div>
    </div>
  </section>
</template>
<style scoped>
.pdf-document-preview{display:flex;flex-direction:column;min-width:0;min-height:0;width:100%;height:100%;background:#e5e9e7}.pdf-document-preview nav{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;padding:10px;background:#fff;border-bottom:1px solid var(--pc-border,#dce4df)}.pdf-document-preview nav button{padding:6px 10px;border:1px solid #cfd8d2;border-radius:6px;background:#fff;color:#314e3d;font-size:12px;cursor:pointer}.pdf-document-preview nav button:disabled{opacity:.45;cursor:default}.pdf-document-preview nav span{font-size:12px;color:#56665c}.pdf-page-stage{box-sizing:border-box;flex:1;position:relative;min-height:0;padding:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;overflow-anchor:none}.pdf-page-stack{position:relative;min-width:100%;width:max-content}.pdf-page-slot{position:absolute;left:16px;right:16px;margin-inline:auto;background:#fff;box-shadow:0 2px 12px #14261a20}.pdf-page-stage:focus-visible{outline:2px solid var(--pc-primary,#42604f);outline-offset:-2px}.pdf-document-preview>p,.pdf-render-status{padding:12px;margin:0;font-size:13px;color:#5c6b62}.pdf-error{color:#a14444!important;background:#fff7f3}.pdf-render-status{position:absolute;top:16px;left:16px;background:#ffffffdf;border-radius:6px}
.pdf-outline{max-height:60dvh;overflow:auto;overscroll-behavior:contain}.pdf-outline ol{list-style:none;padding:0;margin:0}.pdf-outline li{margin:0;min-width:0}.pdf-outline li button{box-sizing:border-box;width:100%;min-height:44px;height:auto;justify-content:flex-start;text-align:left;white-space:normal;overflow-wrap:anywhere;padding:10px 8px;border:0;border-bottom:1px solid var(--line,#dce4df);background:transparent;color:inherit;font:inherit;line-height:1.5}.pdf-outline li button:disabled{opacity:.45}.pdf-outline li span{font-size:12px}.pdf-outline p{line-height:1.6;font-size:14px}.pdf-outline-entry{display:flex;align-items:center;justify-content:space-between;min-height:48px;padding:10px 12px;border:1px solid var(--line,#cdd8d0);border-radius:8px;background:var(--surface,#fff);color:var(--ink,#20362a);font:inherit}.pdf-outline-entry span{font-size:12px;color:var(--muted,#66756d)}
</style>

<style scoped>
.pdf-toolbar{flex:none;overflow-x:auto}.pdf-toolbar-controls,.pdf-toolbar-actions{display:flex;align-items:center;gap:8px;flex:none;white-space:nowrap}.pdf-toolbar-actions{margin-left:auto}.pdf-toolbar-info{flex:1 1 160px;min-width:100px;max-width:220px;text-align:left}.pdf-document-preview .pdf-toolbar--file{min-height:44px;box-sizing:border-box;flex-wrap:nowrap;justify-content:flex-start;gap:8px;padding:5px 8px}.pdf-toolbar--file .pdf-toolbar-controls,.pdf-toolbar--file .pdf-toolbar-actions{gap:4px}.pdf-document-preview .pdf-toolbar--file button{min-height:28px;height:28px;padding:3px 6px;margin:0;font-size:12px}.pdf-document-preview .pdf-toolbar--file input{box-sizing:border-box;width:44px!important;min-height:28px!important;height:28px}.pdf-toolbar--file .pdf-toolbar-controls>span{font-size:11px}.pdf-toolbar--file{scrollbar-width:thin}.pdf-toolbar--file::-webkit-scrollbar{height:4px}
</style>
