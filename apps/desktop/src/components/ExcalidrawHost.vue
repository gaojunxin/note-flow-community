<template><div ref="host" class="excalidraw-host"/></template>
<script setup lang="ts">
import {saveLocalExport} from '../services/localFileExport'
import {onBeforeUnmount,onMounted,ref} from 'vue'
import React from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {Excalidraw,serializeAsJSON} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
const props=defineProps<{scene:string;assetPath?:string;langCode?:string}>(),emit=defineEmits<{change:[value:string]}>(),host=ref<HTMLElement>(),api=ref<any>();let root:Root|undefined,timer:number|undefined,fitTimer:number|undefined
function initialData(){try{const value=JSON.parse(props.scene||'{}');return{elements:value.elements||[],appState:value.appState||{},files:value.files||{}}}catch{return{elements:[],appState:{},files:{}}}}
function changed(elements:any,appState:any,files:any){clearTimeout(timer);timer=window.setTimeout(()=>emit('change',serializeAsJSON(elements,appState,files,'local')),450)}
function flush(){clearTimeout(timer);if(api.value)emit('change',serializeAsJSON(api.value.getSceneElements()||[],api.value.getAppState()||{},api.value.getFiles()||{},'local'))}
async function download(){const blob=new Blob([serializeAsJSON(api.value?.getSceneElements()||[],api.value?.getAppState()||{},api.value?.getFiles()||{},'local')],{type:'application/json'});await saveLocalExport(blob,'drawing.excalidraw')}
function fitToContent(animate=true){const value=api.value,elements=value?.getSceneElements?.().filter((item:any)=>!item.isDeleted)||[];if(!value||!elements.length)return false;value.scrollToContent(elements,{fitToContent:true,animate,duration:animate?260:0,viewportZoomFactor:.86});return true}
function acceptApi(value:any){api.value=value;clearTimeout(fitTimer);fitTimer=window.setTimeout(()=>fitToContent(false),80)}
defineExpose({download,fitToContent,flush})
onMounted(()=>{if(props.assetPath)(window as Window & {EXCALIDRAW_ASSET_PATH?:string}).EXCALIDRAW_ASSET_PATH=props.assetPath;root=createRoot(host.value!);root.render(React.createElement(Excalidraw,{initialData:initialData(),langCode:props.langCode,excalidrawAPI:acceptApi,onChange:changed,theme:document.documentElement.dataset.theme==='dark'?'dark':'light'}))})
onBeforeUnmount(()=>{clearTimeout(timer);clearTimeout(fitTimer);root?.unmount()})
</script>
<style scoped>.excalidraw-host{width:100%;height:100%;min-height:520px}</style>
