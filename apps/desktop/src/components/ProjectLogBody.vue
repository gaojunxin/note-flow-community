<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref} from 'vue'
import MarkdownPreview from './MarkdownPreview.vue'
defineProps<{content:string}>()
const body=ref<HTMLElement>(),expanded=ref(false),overflow=ref(false)
let observer:ResizeObserver|undefined
onMounted(()=>{observer=new ResizeObserver(()=>{overflow.value=(body.value?.getBoundingClientRect().height||0)>156});if(body.value)observer.observe(body.value)})
onBeforeUnmount(()=>observer?.disconnect())
</script>
<template>
 <div class="project-log-body"><div class="body-window" :class="{collapsed:overflow&&!expanded}"><div ref="body"><MarkdownPreview :content="content"/></div></div><button v-if="overflow" class="body-toggle" :aria-expanded="expanded" @click="expanded=!expanded">{{expanded?'收起正文':'展开全文'}} <span aria-hidden="true">{{expanded?'⌃':'⌄'}}</span></button></div>
</template>
<style scoped>
.project-log-body{min-width:0;overflow-wrap:anywhere}.body-window.collapsed{max-height:156px;overflow:hidden;mask-image:linear-gradient(#000 0%,#000 80%,transparent 100%)}.body-toggle{display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:4px 0;border:0;background:transparent;color:var(--pc-primary);font:inherit;font-size:12px;cursor:pointer}.body-toggle:hover{text-decoration:underline}.body-toggle:focus-visible{outline:2px solid var(--pc-primary);outline-offset:3px}
.project-log-body :deep(.markdown-preview){font-size:14px;line-height:1.8}.project-log-body :deep(.markdown-preview>:first-child){margin-top:0}.project-log-body :deep(.markdown-preview>:last-child){margin-bottom:0}.project-log-body :deep(h1),.project-log-body :deep(h2){font-size:17px;line-height:1.5;margin:16px 0 8px;padding:0;border:0}.project-log-body :deep(h3),.project-log-body :deep(h4){font-size:15px;margin:12px 0 6px}.project-log-body :deep(p){margin:8px 0;white-space:normal}.project-log-body :deep(pre){max-width:100%;overflow:auto}
</style>
