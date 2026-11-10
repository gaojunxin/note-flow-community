<template><ExcalidrawHost ref="host" :scene="documentData" :asset-path="assetPath" @change="$emit('change',$event)"/></template>
<script setup lang="ts">
import {ref} from 'vue'
import ExcalidrawHost from '../ExcalidrawHost.vue'
defineProps<{documentData:string;assetPath?:string}>()
defineEmits<{change:[value:string]}>()
const host=ref<InstanceType<typeof ExcalidrawHost>>()
defineExpose({flush:()=>host.value?.flush(),download:()=>host.value?.download(),fitToContent:()=>host.value?.fitToContent()})
</script>
<style scoped>
:deep(.excalidraw-host){height:100%;min-height:0}
</style>
