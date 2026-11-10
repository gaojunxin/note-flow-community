<script setup lang="ts">
import {resolveLinkedCanvas} from '../services/linkedNoteCanvas'
import {isImportedNoteLink,noteHeadingSlug} from '@note-flow/core/imported-note-links'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import DOMPurify from 'dompurify'
import {cachedAttachment} from '../services/attachments'
import {attachmentImageItem} from '../services/attachmentImages'
import {useAuthStore} from '../stores/auth'
import {createMarkdownPreviewParser} from '../services/markdownPreview'
import {MERMAID_STRICT_CONFIG,validateMermaidText} from '../services/mermaidText'

const props = withDefaults(defineProps<{ content: string; ownerId?:string; active?:boolean; noteUid?:string; fragment?:string }>(), {active:true})
const emit=defineEmits<{'note-link':[href:string];'canvas-edit':[id:string];'linked-canvas-open':[uid:string];'outline-change':[headings:Array<{text:string;level:number}>];'outline-active':[index:number]}>()
function openNoteLink(event:MouseEvent){
 const linked=(event.target as HTMLElement).closest<HTMLElement>('[data-linked-canvas]');if(linked?.dataset?.linkedCanvas){event.preventDefault();emit('linked-canvas-open',linked.dataset.linkedCanvas);return}
 const canvas=(event.target as HTMLElement).closest<HTMLElement>('[data-note-canvas]');if(canvas?.dataset?.noteCanvas){event.preventDefault();emit('canvas-edit',canvas.dataset.noteCanvas);return}
 const anchor=(event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]'),href=anchor?.getAttribute('href')||''
 if(href.startsWith('#')){event.preventDefault();scrollToFragment(href.slice(1));return}
 if(props.noteUid&&isImportedNoteLink(href)){event.preventDefault();emit('note-link',href)}
}
function scrollToFragment(value:string){
 let fragment=value;try{fragment=decodeURIComponent(value)}catch{}
 // 只在当前预览内寻找，不修改应用路由，也不受同名全局DOM节点影响。
 const explicit=[...(host.value?.querySelectorAll<HTMLElement>('[data-markdown-anchor]')||[])].find(item=>item.dataset.markdownAnchor===fragment)
 const target=explicit||[...(host.value?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')||[])].find(heading=>noteHeadingSlug(heading.textContent||'')===fragment||heading.textContent===fragment)
 target?.scrollIntoView({block:'start'})
}
async function revealFragment(){await nextTick();if(props.fragment)scrollToFragment(props.fragment)}watch(()=>props.fragment,()=>void revealFragment())
const auth=useAuthStore()
const imageOwner=computed(()=>props.ownerId||String(auth.user?.userId||'local'))
const parser = createMarkdownPreviewParser()
const rendered=ref(''),host = ref<HTMLElement>(), objectUrls = new Map<string,string>()
let headingElements:HTMLElement[]=[],scrollRoot:HTMLElement|Window|undefined,outlineFrame=0,lastActiveHeading=-1,outlineResize:ResizeObserver|undefined
function updateActiveHeading(){
 outlineFrame=0;if(!props.active||!headingElements.length)return
 const container=scrollRoot&&scrollRoot!==window?scrollRoot as HTMLElement:undefined,top=(container?.getBoundingClientRect().top||0)+24
 let active=0
 for(let index=0;index<headingElements.length;index++){if(headingElements[index].getBoundingClientRect().top<=top)active=index;else break}
 if(container&&container.scrollTop>0&&container.scrollTop+container.clientHeight>=container.scrollHeight-2)active=headingElements.length-1
 if(active!==lastActiveHeading){lastActiveHeading=active;emit('outline-active',active)}
}
function scheduleOutlinePosition(){if(!outlineFrame&&typeof window!=='undefined')outlineFrame=window.requestAnimationFrame(updateActiveHeading)}
function releaseOutlineTracking(){scrollRoot?.removeEventListener('scroll',scheduleOutlinePosition);if(typeof window!=='undefined'){window.removeEventListener('resize',scheduleOutlinePosition);window.cancelAnimationFrame(outlineFrame)}outlineFrame=0;outlineResize?.disconnect();outlineResize=undefined;scrollRoot=undefined}
function jumpToHeading(index:number){headingElements[index]?.scrollIntoView({block:'start',behavior:'smooth'})}
async function refreshOutline(version:number){
 await nextTick();if(version!==renderVersion)return
 releaseOutlineTracking();headingElements=[...(host.value?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')||[])]
 emit('outline-change',headingElements.map(item=>({text:item.textContent||'',level:Number(item.tagName.slice(1))})))
 lastActiveHeading=-1;emit('outline-active',-1)
 if(!headingElements.length||typeof window==='undefined')return
 scrollRoot=host.value?.closest<HTMLElement>('.editor-scroll-area')||window
 scrollRoot.addEventListener('scroll',scheduleOutlinePosition,{passive:true});window.addEventListener('resize',scheduleOutlinePosition,{passive:true})
 if(typeof ResizeObserver!=='undefined'&&host.value){outlineResize=new ResizeObserver(scheduleOutlinePosition);outlineResize.observe(host.value)}
 scheduleOutlinePosition()
}
defineExpose({scrollToHeading:jumpToHeading})
const diagramPrefix=useId()
let renderTimer:ReturnType<typeof setTimeout>|undefined,renderVersion=0
let dirty=true
const linkedUrls=new Map<HTMLElement,string>()
let linkedVersion=0
async function resolveLinkedCanvases(){
 const version=++linkedVersion,owner=imageOwner.value;await nextTick()
 for(const [slot,url] of linkedUrls)if(!slot.isConnected){URL.revokeObjectURL(url);linkedUrls.delete(slot)}
 await Promise.all([...(host.value?.querySelectorAll<HTMLElement>('[data-linked-canvas-preview]')||[])].map(async slot=>{
  const uid=slot.dataset.linkedCanvasPreview!
  try{const result=await resolveLinkedCanvas(owner,uid);if(version!==linkedVersion||owner!==imageOwner.value||!slot.isConnected)return
   if(linkedUrls.has(slot))URL.revokeObjectURL(linkedUrls.get(slot)!)
   slot.classList.remove('canvas-unavailable');slot.replaceChildren();if(result.preview){const image=document.createElement('img'),url=URL.createObjectURL(result.preview);image.alt=result.canvas.title||'画布';image.src=url;slot.append(image);linkedUrls.set(slot,url)}else slot.textContent=result.canvas.canvasType==='excalidraw'?'画布暂无绘制内容':'此类型暂不支持内嵌预览，点击打开画布'
   const label=slot.parentElement?.lastChild;if(label?.nodeType===Node.TEXT_NODE)label.textContent=`画布：${result.canvas.title||'未命名画布'}`
  }catch(source){if(version===linkedVersion){slot.textContent=source instanceof Error?source.message:'画布预览不可用';slot.classList.add('canvas-unavailable')}}
 }))
}
function refreshLinkedCanvases(){if(props.active)void resolveLinkedCanvases()}
if(typeof window!=='undefined'){window.addEventListener('note-flow:canvas-change',refreshLinkedCanvases);window.addEventListener('focus',refreshLinkedCanvases)}
const pendingImages=new Map<string,Promise<string|undefined>>()
async function resolveProtectedImages() {
  const version=renderVersion
  await nextTick()
  const images = host.value?.querySelectorAll<HTMLImageElement>('img[data-attachment-source]') || []
  const active=new Set([...images].map(image=>image.dataset.attachmentSource!).filter(Boolean))
  await Promise.all([...images].map(async image => {
    const source=image.dataset.attachmentSource!,item=attachmentImageItem(source)
    if(!item)return
    try {
      let url=objectUrls.get(source)
      if(!url){
        let pending=pendingImages.get(source)
        if(!pending){
          const owner=imageOwner.value
          pending=cachedAttachment(owner,item).then(blob=>{
            if(owner!==imageOwner.value||!host.value)return undefined
            const existing=objectUrls.get(source)
            if(existing)return existing
            const created=URL.createObjectURL(blob);objectUrls.set(source,created);return created
          }).finally(()=>{if(pendingImages.get(source)===pending)pendingImages.delete(source)})
          pendingImages.set(source,pending)
        }
        url=await pending
      }
      if(version===renderVersion&&url)image.src=url
    }catch(error){if(version===renderVersion){image.alt=`${image.alt||'图片'}（${error instanceof Error?error.message:'加载失败'}）`;image.title=image.alt;image.removeAttribute('src')}}
  }))
  for(const [source,url] of objectUrls)if(!active.has(source)){URL.revokeObjectURL(url);objectUrls.delete(source)}
}
async function renderDiagrams(version:number){
  await nextTick()
  const figures=host.value?.querySelectorAll<HTMLElement>('.markdown-mermaid')||[]
  let diagramIndex=0
  for(const figure of figures){
    if(version!==renderVersion)return
    const source=figure.querySelector('code')?.textContent||''
    let scratch:HTMLDivElement|undefined
    try{
      const validation=await validateMermaidText(source)
      if(version!==renderVersion)return
      if(!validation.valid)throw new Error(validation.diagnostics.map(item=>`第 ${item.line} 行：${item.message}`).join('；'))
      const runtime=(await import('mermaid')).default
      if(version!==renderVersion)return
      runtime.initialize(MERMAID_STRICT_CONFIG)
      scratch=document.createElement('div')
      scratch.style.cssText=`position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;width:${host.value?.clientWidth||800}px`
      document.body.append(scratch)
      const result=await runtime.render(`markdown-mermaid-${diagramPrefix}-${version}-${diagramIndex++}`,source,scratch)
      if(version!==renderVersion)return
      figure.innerHTML=DOMPurify.sanitize(result.svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['script','foreignObject'],FORBID_ATTR:['onload','onclick','onerror']})
      figure.setAttribute('role','img')
      figure.setAttribute('aria-label','Mermaid 图表')
    }catch(error){
      if(version!==renderVersion)return
      const caption=document.createElement('figcaption')
      caption.className='markdown-mermaid-error'
      caption.textContent=`图表渲染失败：${error instanceof Error?error.message.split('\n')[0]:'请检查 Mermaid 语法'}`
      figure.append(caption)
    }finally{scratch?.remove()}
  }
}
function render(){
  if(!props.active)return
  dirty=false
  const version=++renderVersion
  rendered.value=DOMPurify.sanitize(parser.render(props.content||''),{USE_PROFILES:{html:true},ADD_ATTR:['target','rel']})
  void refreshOutline(version);void resolveProtectedImages();void resolveLinkedCanvases();void renderDiagrams(version);void revealFragment()
}
watch(imageOwner,()=>{linkedVersion++;for(const [slot,url] of linkedUrls){URL.revokeObjectURL(url);slot.replaceChildren()}linkedUrls.clear();renderVersion++;dirty=true;pendingImages.clear();for(const url of objectUrls.values())URL.revokeObjectURL(url);objectUrls.clear();for(const image of host.value?.querySelectorAll('img[data-attachment-source]')||[])image.removeAttribute('src');clearTimeout(renderTimer);render()})
watch(()=>props.content,()=>{
  renderVersion++;dirty=true;clearTimeout(renderTimer)
  if(props.active){if(!rendered.value)render();else renderTimer=setTimeout(render,200)}
},{immediate:true})
watch(()=>props.active,active=>{
  clearTimeout(renderTimer)
  if(active&&dirty)render();else if(active){void resolveLinkedCanvases();scheduleOutlinePosition()}
})
onBeforeUnmount(()=>{releaseOutlineTracking();linkedVersion++;if(typeof window!=='undefined'){window.removeEventListener('note-flow:canvas-change',refreshLinkedCanvases);window.removeEventListener('focus',refreshLinkedCanvases)}for(const url of linkedUrls.values())URL.revokeObjectURL(url);renderVersion++;clearTimeout(renderTimer);for(const url of objectUrls.values())URL.revokeObjectURL(url)})
</script>

<template>
  <div v-if="content.trim()" ref="host" class="markdown-preview" @click="openNoteLink" v-html="rendered" />
  <div v-else class="markdown-preview-empty">暂无正文内容</div>
</template>

<style scoped>
.markdown-preview :deep(.note-linked-canvas){display:block;margin:12px 0;padding:12px;border:1px solid var(--pc-border,#e0e7e2);border-radius:8px;text-align:center;cursor:pointer}.markdown-preview :deep(.note-linked-canvas img){display:block;max-width:100%;max-height:480px;margin:0 auto 8px;object-fit:contain}.markdown-preview :deep(.note-linked-canvas::after){content:"打开原画布编辑";display:block;margin-top:6px;color:var(--pc-muted,#65756b);font-size:11px}.markdown-preview :deep(.canvas-unavailable){display:block;color:#a3453b;font-size:12px}
.markdown-preview :deep(.note-canvas-preview){display:block;padding:10px;border:1px solid var(--pc-border,#e0e7e2);border-radius:8px;cursor:pointer}.markdown-preview :deep(.note-canvas-preview::after){content:"点击编辑画布";display:block;text-align:center;color:var(--pc-muted,#65756b);font-size:11px}.markdown-preview :deep(.note-canvas-preview img){display:block;max-width:100%;max-height:480px;margin:auto;object-fit:contain}
.markdown-preview :deep(.markdown-mermaid){margin:16px 0;padding:16px;overflow-x:auto;border:1px solid var(--pc-border,#e0e7e2);border-radius:8px;background:#fff;text-align:center}
.markdown-preview :deep(.markdown-mermaid>svg){display:block;max-width:100%;height:auto;margin:0 auto}
.markdown-preview :deep(.markdown-mermaid>pre){text-align:left}
.markdown-preview :deep(.markdown-mermaid-error){margin-top:8px;color:#a3453b;font-size:12px;text-align:left}
</style>
