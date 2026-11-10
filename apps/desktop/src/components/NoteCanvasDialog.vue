<script setup lang="ts">
import {defineAsyncComponent,nextTick,onMounted,onBeforeUnmount,ref} from 'vue'
import {parseNoteCanvasScene} from '../services/noteCanvas'
const ExcalidrawHost=defineAsyncComponent(()=>import('./ExcalidrawHost.vue'))
const props=defineProps<{scene:string;busy?:boolean;error?:string}>()
const emit=defineEmits<{save:[scene:string,preview:Blob];close:[]}>()
const scene=ref(props.scene),host=ref<{flush:()=>void}>(),exporting=ref(false),exportError=ref(''),dialog=ref<HTMLElement>()
const previousFocus=document.activeElement as HTMLElement|null
async function save(){
 if(props.busy||exporting.value)return
 exporting.value=true;exportError.value=''
 try{
  host.value?.flush();await nextTick()
  const value=parseNoteCanvasScene(scene.value)
  if(!value.elements.some((item:any)=>!item.isDeleted))throw Error('请先绘制画布内容')
  const {exportToBlob}=await import('@excalidraw/excalidraw')
  const preview=await exportToBlob({elements:value.elements.filter((item:any)=>!item.isDeleted),appState:{...value.appState,exportBackground:true},files:value.files,mimeType:'image/png',exportPadding:20})
  emit('save',scene.value,preview)
 }catch(error){exportError.value=error instanceof Error?error.message:'画布预览生成失败'}finally{exporting.value=false}
}
function keydown(event:KeyboardEvent){
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!props.busy&&!exporting.value)emit('close')}
 if(event.key==='Tab'){
  const items=[...(dialog.value?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]')||[])].filter(item=>item.getClientRects().length)
  const first=items[0],last=items.at(-1)
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
 }
}
onMounted(()=>dialog.value?.focus())
onBeforeUnmount(()=>previousFocus?.isConnected&&previousFocus.focus())
</script>
<template><Teleport to="body"><div class="note-canvas-overlay" @keydown="keydown"><section ref="dialog" class="note-canvas-dialog" role="dialog" aria-modal="true" aria-label="编辑笔记画布" tabindex="-1"><header><strong>笔记画布</strong><div><button :disabled="busy||exporting" @click="emit('close')">取消</button><button class="save" :disabled="busy||exporting" @click="save">{{busy||exporting?'正在保存…':'保存画布'}}</button></div></header><p v-if="error||exportError" role="alert">{{error||exportError}}</p><div class="note-canvas-editor"><ExcalidrawHost ref="host" :scene="scene" lang-code="zh-CN" @change="scene=$event"/></div></section></div></Teleport></template>
<style scoped>
.note-canvas-overlay{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:rgb(15 30 24 / .42)}.note-canvas-dialog{display:flex;flex-direction:column;width:min(1200px,100%);height:min(850px,100%);overflow:hidden;border-radius:12px;background:#fff;box-shadow:0 20px 80px #0003}.note-canvas-dialog>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid #e0e7e2}.note-canvas-dialog header>div{display:flex;gap:8px}.note-canvas-dialog header button{padding:7px 14px;border:1px solid #dce5de;border-radius:7px;background:#fff;cursor:pointer}.note-canvas-dialog header button.save{background:#2f7d5b;color:#fff;border-color:#2f7d5b}.note-canvas-dialog header button:disabled{opacity:.5;cursor:wait}.note-canvas-dialog>p{margin:0;padding:8px 16px;color:#a3453b}.note-canvas-editor{flex:1;min-height:0}.note-canvas-editor :deep(.excalidraw-host){height:100%;min-height:0}@media(max-width:640px){.note-canvas-overlay{padding:0}.note-canvas-dialog{height:100%;border-radius:0}}
</style>
