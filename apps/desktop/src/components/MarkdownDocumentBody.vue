<script setup lang="ts">
import {ref,defineAsyncComponent} from 'vue'
const MarkdownEditor=defineAsyncComponent(()=>import('./MarkdownEditor.vue'))
const MarkdownPreview=defineAsyncComponent(()=>import('./MarkdownPreview.vue'))
withDefaults(defineProps<{modelValue?:string;mode:'edit'|'split'|'preview';readonly?:boolean;ownerId?:string;contained?:boolean}>(),{modelValue:''})
const emit=defineEmits<{'update:modelValue':[value:string];submit:[];'attachment-files':[files:File[]]}>()
const editor=ref<InstanceType<typeof MarkdownEditor>>()
defineExpose({focus:()=>editor.value?.focus(),setHeading:(level:number)=>editor.value?.setHeading(level),replaceSelection:(before:string,after?:string,placeholder?:string)=>editor.value?.replaceSelection(before,after,placeholder),prefixLines:(prefix:string)=>editor.value?.prefixLines(prefix)})
</script>
<template><div class="markdown-mode-body document-body" :class="[`document-mode-${mode}`,{'document-contained':contained}]"><slot><MarkdownEditor ref="editor" v-show="mode!=='preview'" :model-value="modelValue" :readonly="readonly" :owner-id="ownerId" @update:model-value="emit('update:modelValue',$event)" @submit="emit('submit')" @attachment-files="emit('attachment-files',$event)"/><MarkdownPreview v-if="mode!=='edit'" :content="modelValue" :owner-id="ownerId"/></slot></div></template>
<style scoped>
.document-body.document-mode-split{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.document-contained{display:grid;flex:1;min-height:0;margin:0;overflow:hidden;border-top:1px solid var(--pc-border)}.document-contained>:deep(.markdown-editor){height:100%;min-height:0;margin:0;overflow:hidden;border:0;border-radius:0}.document-contained :deep(.cm-editor){height:100%;min-height:0}.document-contained :deep(.cm-scroller){overflow:auto}.document-contained :deep(.cm-content){padding:20px 24px;font-size:15px;line-height:1.8}.document-contained>:deep(.markdown-preview){box-sizing:border-box;min-width:0;height:100%;margin:0;padding:20px 28px;overflow:auto;font-size:15px;line-height:1.8}.document-contained.document-mode-split>:deep(.markdown-preview){border-left:1px solid var(--pc-border)}
</style>
