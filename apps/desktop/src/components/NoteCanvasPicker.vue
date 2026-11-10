<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue'
import {createCanvasService,type CanvasEntity} from '../services/canvases'
const props=defineProps<{ownerId:string;areaUid?:string|null}>()
const emit=defineEmits<{create:[];select:[uid:string];close:[]}>()
const items=ref<CanvasEntity[]>([]),query=ref(''),loading=ref(false),error=ref(''),dialog=ref<HTMLElement>()
const visible=computed(()=>items.value.filter(item=>(!props.areaUid||!item.areaUid||item.areaUid===props.areaUid)&&(!query.value||item.title.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()))))
const labels:Record<string,string>={excalidraw:'白板',mindmap:'思维导图',diagrams:'正式图表',flowchart:'流程图',knowledge_graph:'知识关系图'}
let request=0
const previousFocus=document.activeElement as HTMLElement|null
async function load(){const token=++request;loading.value=true;error.value='';try{const values=await createCanvasService(props.ownerId).list();if(token===request)items.value=values}catch(source){if(token===request)error.value=source instanceof Error?source.message:'画布列表加载失败'}finally{if(token===request)loading.value=false}}
function keydown(event:KeyboardEvent){
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();emit('close')}
 if(event.key==='Tab'){const items=[...(dialog.value?.querySelectorAll<HTMLElement>('button:not([disabled]),input')||[])].filter(item=>item.getClientRects().length),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
}
watch(()=>props.ownerId,load,{immediate:true})
onMounted(()=>dialog.value?.focus())
onBeforeUnmount(()=>{request++;if(previousFocus?.isConnected)previousFocus.focus()})
</script>
<template><Teleport to="body"><div class="canvas-picker-overlay" @click.self="emit('close')" @keydown="keydown"><section ref="dialog" class="canvas-picker" role="dialog" aria-modal="true" aria-label="插入画布" tabindex="-1"><header><strong>插入画布</strong><button aria-label="关闭插入画布" @click="emit('close')">×</button></header><button class="new-canvas" @click="emit('create')">＋ 新建画布</button><h3>选择已有画布</h3><input v-model="query" aria-label="搜索已有画布" placeholder="搜索已有画布"/><p class="hint">插入后保持关联，编辑原画布会更新各处预览。</p><p v-if="loading" role="status">正在加载画布…</p><p v-else-if="error" role="alert">{{error}} <button @click="load">重试</button></p><div v-else class="canvas-picker-list"><button v-for="item in visible" :key="item.uid" @click="emit('select',item.uid)"><span>{{labels[item.canvasType]||'画布'}}</span><strong>{{item.title||'未命名画布'}}</strong><small>插入关联</small></button><p v-if="!visible.length">{{query?'没有匹配的画布':'当前范围内暂无已有画布，可先新建。'}}</p></div></section></div></Teleport></template>
<style scoped>
.canvas-picker-overlay{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:rgb(15 30 24 / .42)}.canvas-picker{display:flex;flex-direction:column;gap:12px;width:min(480px,100%);max-height:85vh;padding:20px;border-radius:12px;background:#fff;box-shadow:0 20px 80px #0003}.canvas-picker header{display:flex;align-items:center;justify-content:space-between}.canvas-picker header button{border:0;background:transparent;font-size:22px;cursor:pointer}.new-canvas{padding:12px;border:1px solid #b5d1c1;border-radius:8px;background:#edf5ef;color:#2f7d5b;cursor:pointer;text-align:left}.canvas-picker h3{margin:4px 0 0;font-size:13px}.canvas-picker>input{padding:10px;border:1px solid #dce5de;border-radius:7px}.canvas-picker .hint{margin:0;color:#65756b;font-size:12px}.canvas-picker-list{overflow:auto;display:grid;gap:6px;min-height:0}.canvas-picker-list>button{display:flex;align-items:center;gap:10px;min-height:48px;padding:10px;border:1px solid #e0e7e2;border-radius:7px;background:#fff;cursor:pointer;text-align:left}.canvas-picker-list>button:hover{background:#edf5ef}.canvas-picker-list strong{flex:1;min-width:0;overflow-wrap:anywhere}.canvas-picker-list span,.canvas-picker-list small{flex:none;color:#65756b;font-size:11px}
</style>
