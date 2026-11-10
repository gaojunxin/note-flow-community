<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {AttachmentContentHit} from '../services/attachmentContentSearch'
const props=defineProps<{hits:AttachmentContentHit[]}>(),emit=defineEmits<{open:[index:number]}>()
const ROW_HEIGHT=84,OVERSCAN=4,THRESHOLD=200
const viewport=ref<HTMLElement>(),scrollTop=ref(0),height=ref(504)
const virtual=computed(()=>props.hits.length>THRESHOLD)
const start=computed(()=>virtual.value?Math.max(0,Math.floor(scrollTop.value/ROW_HEIGHT)-OVERSCAN):0)
const end=computed(()=>virtual.value?Math.min(props.hits.length,Math.ceil((scrollTop.value+height.value)/ROW_HEIGHT)+OVERSCAN):props.hits.length)
const visible=computed(()=>props.hits.slice(start.value,end.value).map((hit,offset)=>({hit,index:start.value+offset})))
let observer:ResizeObserver|undefined
function measure(){if(viewport.value){height.value=viewport.value.clientHeight;scrollTop.value=viewport.value.scrollTop}}
async function focusIndex(index:number){
 const element=viewport.value;if(!element||!props.hits.length)return
 const target=Math.max(0,Math.min(props.hits.length-1,index)),top=target*ROW_HEIGHT,bottom=top+ROW_HEIGHT
 if(top<element.scrollTop)element.scrollTop=top
 else if(bottom>element.scrollTop+element.clientHeight)element.scrollTop=bottom-element.clientHeight
 measure();await nextTick()
 element.querySelector<HTMLButtonElement>(`button[data-result-index="${target}"]`)?.focus({preventScroll:true})
}
function onKey(event:KeyboardEvent){
 const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-result-index]');if(!button||!viewport.value?.contains(button))return
 const current=Number(button.dataset.resultIndex),page=Math.max(1,Math.floor(height.value/ROW_HEIGHT))
 const destinations:Record<string,number>={ArrowDown:current+1,ArrowUp:current-1,Home:0,End:props.hits.length-1,PageDown:current+page,PageUp:current-page}
 if(!(event.key in destinations)||event.altKey||event.ctrlKey||event.metaKey)return
 event.preventDefault();void focusIndex(destinations[event.key])
}
watch(()=>[props.hits.length,props.hits[0]?.item.uid],([count,first],[previous,previousFirst])=>{if(Number(count)<Number(previous)||first!==previousFirst){if(viewport.value)viewport.value.scrollTop=0;scrollTop.value=0}void nextTick(measure)},{flush:'post'})
onMounted(()=>{measure();if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(measure);if(viewport.value)observer.observe(viewport.value)}window.addEventListener('resize',measure)})
onBeforeUnmount(()=>{observer?.disconnect();window.removeEventListener('resize',measure)})
</script>
<template>
 <div ref="viewport" class="search-results attachment-search-results" role="group" aria-label="附件内容搜索结果，可使用方向键浏览" @scroll="measure" @keydown="onKey">
  <div v-if="virtual&&start" aria-hidden="true" :style="{height:`${start*ROW_HEIGHT}px`}"/>
  <button v-for="{hit,index} in visible" :key="hit.item.uid" :data-result-index="index" :aria-label="`${hit.item.originalFilename}，第 ${index+1} 项，共 ${hits.length} 项。${hit.summary}`" @click="emit('open',index)"><div><strong>{{hit.item.originalFilename}}</strong><p>{{hit.summary}}</p></div><em>本机附件</em></button>
  <div v-if="virtual&&end<hits.length" aria-hidden="true" :style="{height:`${(hits.length-end)*ROW_HEIGHT}px`}"/>
 </div>
</template>
<style scoped>
.attachment-search-results{max-height:min(52vh,504px);overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;overflow-anchor:none}.attachment-search-results>button{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;width:100%;height:84px;min-height:84px;max-height:84px;padding:12px 14px;margin:0;border:0;border-bottom:1px solid var(--pc-border,#edf1ee);background:var(--pc-surface,#fff);text-align:left;cursor:pointer}.attachment-search-results>button>div{min-width:0;overflow:hidden}.attachment-search-results strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px}.attachment-search-results p{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;margin:4px 0 0;white-space:normal;overflow-wrap:anywhere;font-size:11px;line-height:16px;color:var(--pc-muted)}.attachment-search-results>button>em{white-space:nowrap;font-size:10px}.attachment-search-results>button:focus-visible{outline:2px solid var(--pc-primary);outline-offset:-2px}
</style>
