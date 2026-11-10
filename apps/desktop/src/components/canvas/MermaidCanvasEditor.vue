<template>
  <section class="mermaid-editor">
    <header class="mermaid-tools">
      <label>模板
        <select v-model="templateId" @change="applyTemplate">
          <option value="">选择基础模板…</option>
          <option v-for="item in mermaidTemplates" :key="item.id" :value="item.id">{{item.label}}</option>
        </select>
      </label>
      <span class="render-state" :class="{error:diagnostic}">{{rendering?'正在生成预览…':diagnostic||'预览已更新'}}</span>
      <button type="button" @click="downloadSource">导出源码</button>
      <button type="button" :disabled="!lastValidSvg" @click="downloadSvg">导出 SVG</button>
    </header>
    <div class="mermaid-body">
      <label class="source-pane"><span>MERMAID 源码</span><textarea v-model="source" spellcheck="false" aria-label="Mermaid 源码" @input="scheduleUpdate()"/></label>
      <section class="preview-pane">
        <span class="pane-label">安全预览</span>
        <div v-if="lastValidSvg" class="svg-preview" v-html="lastValidSvg"></div>
        <div v-else class="preview-empty">输入有效的 Mermaid 源码后将在这里预览</div>
        <div v-if="diagnostic" class="diagnostic" role="alert">{{diagnostic}}</div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import {saveLocalExport} from '../../services/localFileExport'
import {onBeforeUnmount,onMounted,ref,watch} from 'vue'
import DOMPurify from 'dompurify'
import {mermaidExportName,mermaidTemplates} from '../../canvas/mermaidEditor'
import {MERMAID_STRICT_CONFIG,validateMermaidText} from '../../services/mermaidText'

const props=defineProps<{documentData:string;title?:string}>()
const emit=defineEmits<{change:[value:string]}>()
const source=ref(props.documentData||'flowchart TD\n'),templateId=ref(''),lastValidSvg=ref(''),diagnostic=ref(''),rendering=ref(false)
let timer:number|undefined,renderSequence=0

watch(()=>props.documentData,value=>{if(value!==source.value){source.value=value;scheduleUpdate(false)}})
function scheduleUpdate(persist=true){clearTimeout(timer);timer=window.setTimeout(()=>void render(persist),420)}
async function render(persist:boolean){
  const value=source.value,sequence=++renderSequence
  rendering.value=true
  const validation=await validateMermaidText(value)
  if(sequence!==renderSequence)return
  if(!validation.valid){diagnostic.value=validation.diagnostics.map(item=>`第 ${item.line} 行：${item.message}`).join('；');rendering.value=false;if(persist)emit('change',value);return}
  try{
    const runtime=(await import('mermaid')).default
    runtime.initialize(MERMAID_STRICT_CONFIG)
    const result=await runtime.render(`note-flow-mermaid-${sequence}`,value)
    if(sequence!==renderSequence)return
    lastValidSvg.value=DOMPurify.sanitize(result.svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['script','foreignObject'],FORBID_ATTR:['onload','onclick','onerror']})
    diagnostic.value=''
  }catch(error){if(sequence===renderSequence)diagnostic.value=error instanceof Error?error.message.split('\n')[0]:'Mermaid 渲染失败'}
  finally{if(sequence===renderSequence){rendering.value=false;if(persist)emit('change',value)}}
}
function flush(){clearTimeout(timer);emit('change',source.value)}
function applyTemplate(){const template=mermaidTemplates.find(item=>item.id===templateId.value);if(template){source.value=template.source;scheduleUpdate()}}
async function download(content:string,type:string,extension:'mmd'|'svg'){
  await saveLocalExport(new Blob([content],{type}),mermaidExportName(props.title||'mermaid-canvas',extension))
}
function downloadSource(){download(source.value,'text/plain;charset=utf-8','mmd')}
function downloadSvg(){if(lastValidSvg.value)download(lastValidSvg.value,'image/svg+xml;charset=utf-8','svg')}
onMounted(()=>void render(false))
onBeforeUnmount(()=>{clearTimeout(timer);renderSequence++})
// The shared Canvas shell exposes one download command. It maps to the richest
// valid artifact; both explicit formats remain available in this editor toolbar.
defineExpose({flush,download:()=>lastValidSvg.value?downloadSvg():downloadSource()})
</script>

<style scoped>
.mermaid-editor{display:grid;height:100%;min-height:0;grid-template-rows:48px 1fr;background:#f7f9f8;color:#27443a}.mermaid-tools{display:flex;align-items:center;gap:9px;padding:7px 12px;border-bottom:1px solid #e1e7e3;background:#fff}.mermaid-tools label{display:flex;align-items:center;gap:7px;color:#718078;font-size:11px}.mermaid-tools select,.mermaid-tools button{height:30px;border:1px solid #dce4df;border-radius:8px;background:#fff;color:#355348;font-size:11px}.mermaid-tools select{padding:0 25px 0 8px}.mermaid-tools button{padding:0 10px;cursor:pointer}.mermaid-tools button:hover:not(:disabled){border-color:#8eb2a2;background:#f1f7f4}.mermaid-tools button:disabled{opacity:.45}.render-state{min-width:0;flex:1;overflow:hidden;color:#6d887c;font-size:10px;text-align:right;text-overflow:ellipsis;white-space:nowrap}.render-state.error{color:#af4e45}.mermaid-body{display:grid;min-height:0;grid-template-columns:minmax(300px,40%) 1fr}.source-pane,.preview-pane{position:relative;display:grid;min-height:0;grid-template-rows:32px 1fr}.source-pane{border-right:1px solid #dfe6e2}.source-pane>span,.pane-label{display:flex;align-items:center;padding:0 12px;border-bottom:1px solid #e5eae7;background:#fbfcfb;color:#7e8e86;font-size:9px;font-weight:800;letter-spacing:.11em}.source-pane textarea{min-width:0;min-height:0;resize:none;padding:14px;border:0;outline:0;background:#15231e;color:#d8e8df;font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2}.preview-pane{overflow:hidden}.svg-preview{display:grid;min-height:0;overflow:auto;place-items:center;padding:24px;background-color:#fff;background-image:radial-gradient(#dce5e0 1px,transparent 1px);background-size:16px 16px}.svg-preview :deep(svg){max-width:100%;max-height:100%}.preview-empty{display:grid;place-items:center;color:#97a49e;font-size:12px}.diagnostic{position:absolute;right:14px;bottom:14px;left:14px;padding:10px 12px;border:1px solid #e8bbb5;border-radius:9px;background:#fff5f3eF;color:#98483f;font-size:11px;box-shadow:0 8px 24px #6b2b2420}
@media(max-width:900px){.mermaid-body{grid-template-columns:1fr;grid-template-rows:45% 55%}.source-pane{border-right:0;border-bottom:1px solid #dfe6e2}.render-state{display:none}}
</style>
