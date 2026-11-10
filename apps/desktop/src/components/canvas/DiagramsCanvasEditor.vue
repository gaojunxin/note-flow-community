<template>
  <div class="diagrams-host">
    <iframe v-if="available" ref="frame" :src="entry" title="diagrams.net 离线编辑器" sandbox="allow-scripts allow-downloads allow-same-origin" referrerpolicy="no-referrer" @load="onFrameLoad"/>
    <div v-else class="missing"><strong>diagrams.net 离线资源尚未安装</strong><p>为保护图表和凭据，本应用不会回退到在线编辑器。请通过受审核的 vendor 流程安装固定版本资源。</p></div>
  </div>
</template>
<script setup lang="ts">
import {saveLocalExport} from '../../services/localFileExport'
import {onBeforeUnmount,ref} from 'vue'
import {createDiagramsCommand,createDiagramsNonce,validateDiagramsMessageEvent} from '../../canvas/diagrams/protocol'
import {diagramsVendorEntry,isDiagramsVendorAvailable} from '../../canvas/diagrams/vendor'

const props=defineProps<{documentData:string;title?:string}>(),emit=defineEmits<{change:[value:string]}>()
const frame=ref<HTMLIFrameElement>(),nonce=createDiagramsNonce(),available=isDiagramsVendorAvailable,entry=diagramsVendorEntry
// WebView2 serves packaged assets with an origin-specific CORS response. The
// vendored editor must remain same-origin to load its local language bundles.
// Source + nonce still bind messages to this exact iframe instance.
const origin=window.location.origin
let ready=false
function post(action:'configure'|'load'|'export',payload?:unknown){frame.value?.contentWindow?.postMessage(createDiagramsCommand(action,nonce,payload),'*')}
function onFrameLoad(){ready=false;post('configure',{network:false,plugins:false,libraries:false,telemetry:false});post('load',{xml:props.documentData})}
let pendingFlush:{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined
function flush(){if(!available)return Promise.resolve();if(pendingFlush)return Promise.reject(new Error('图表正在保存'));return new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{pendingFlush=undefined;reject(new Error('图表保存响应超时，请重试'))},8000);pendingFlush={resolve,reject,timer};if(ready)post('export',{format:'xml'})})}
function decodeExport(value:string){if(!value.startsWith('data:'))return value;const comma=value.indexOf(',');if(comma<0)return value;const metadata=value.slice(0,comma),body=value.slice(comma+1);return metadata.includes(';base64')?atob(body):decodeURIComponent(body)}
async function downloadXml(value:string){await saveLocalExport(new Blob([value],{type:'application/xml;charset=utf-8'}),`${(props.title||'diagram').replace(/[\\/:*?"<>|]+/g,'_')}.drawio`)}
function onMessage(event:MessageEvent){if(!frame.value?.contentWindow)return;try{const message=validateDiagramsMessageEvent(event,{origin,source:frame.value.contentWindow,nonce});if(message.event==='ready'){ready=true;if(pendingFlush)post('export',{format:'xml'})}if(message.event==='save'&&message.payload&&typeof message.payload==='object'&&typeof (message.payload as {xml?:unknown}).xml==='string')emit('change',(message.payload as {xml:string}).xml);if(message.event==='export'&&message.payload&&typeof message.payload==='object'){const data=(message.payload as {data?:unknown}).data;if(typeof data==='string'){if(pendingFlush){const pending=pendingFlush;pendingFlush=undefined;clearTimeout(pending.timer);const xml=decodeExport(data);if(!/^\s*<(?:mxfile|mxGraphModel)\b/.test(xml)){pending.reject(new Error('图表导出内容无效，原文已保留'))}else{emit('change',xml);pending.resolve()}}else downloadXml(decodeExport(data))}}}catch{/* Ignore every message outside the capability boundary. */}}
if(typeof window!=='undefined')window.addEventListener('message',onMessage)
onBeforeUnmount(()=>{window.removeEventListener('message',onMessage);if(pendingFlush){clearTimeout(pendingFlush.timer);pendingFlush.reject(new Error('图表编辑器已关闭'));pendingFlush=undefined}})
defineExpose({flush,download:()=>post('export',{format:'xml'})})
</script>
<style scoped>
.diagrams-host,.diagrams-host iframe{width:100%;height:100%;border:0}.missing{display:grid;height:100%;place-content:center;padding:32px;color:#36564a;text-align:center}.missing strong{font-size:16px}.missing p{max-width:520px;color:#7b8d85;font-size:12px;line-height:1.7}
</style>
