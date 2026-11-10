<script setup lang="ts">
import {ElButton} from 'element-plus'
import 'element-plus/es/components/button/style/css'
export type LogMarkdownAction = 'heading' | 'bold' | 'italic' | 'link' | 'list' | 'task' | 'quote' | 'code'
export type LogMarkdownMode = 'source' | 'split' | 'preview'
defineProps<{mode:LogMarkdownMode;disabled?:boolean}>()
const emit=defineEmits<{command:[action:LogMarkdownAction];'update:mode':[mode:LogMarkdownMode]}>()
const actions:Array<{action:LogMarkdownAction;label:string;title:string}>=[
 {action:'heading',label:'H2',title:'二级标题'}, {action:'bold',label:'粗体',title:'粗体（Ctrl / ⌘ + B）'},
 {action:'italic',label:'斜体',title:'斜体（Ctrl / ⌘ + I）'}, {action:'link',label:'链接',title:'插入链接（Ctrl / ⌘ + K）'},
 {action:'list',label:'列表',title:'无序列表'}, {action:'task',label:'待办',title:'待办清单'},
 {action:'quote',label:'引用',title:'引用'}, {action:'code',label:'代码',title:'代码块'},
]
</script>
<template>
 <div class="log-markdown-toolbar">
  <div class="format-actions" role="group" aria-label="Markdown 格式工具"><ElButton size="small" text v-for="item in actions" :key="item.action" native-type="button" :title="item.title" :aria-label="item.title" :disabled="disabled||mode==='preview'" @mousedown.prevent @click="emit('command',item.action)">{{item.label}}</ElButton></div>
  <div class="markdown-modes" role="group" aria-label="Markdown 显示模式"><ElButton size="small" text v-for="item in [{value:'source',label:'编辑'},{value:'split',label:'分栏'},{value:'preview',label:'预览'}] as const" :key="item.value" native-type="button" :disabled="disabled" :aria-pressed="mode===item.value" @click="emit('update:mode',item.value)">{{item.label}}</ElButton></div>
 </div>
</template>
<style scoped>
.log-markdown-toolbar{display:flex;align-items:center;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid var(--pc-border);background:#f7f9f8;border-radius:0}.format-actions,.markdown-modes{display:flex;align-items:center;flex-wrap:wrap;gap:3px}.log-markdown-toolbar button{margin:0;height:30px;padding:0 10px;border:0;border-radius:5px;background:transparent;color:var(--pc-text,#526159);font-size:13px;cursor:pointer}.log-markdown-toolbar button:hover,.markdown-modes button[aria-pressed=true]{background:var(--pc-primary-soft);color:var(--pc-primary)}.log-markdown-toolbar button:disabled{opacity:.45;cursor:default}.markdown-modes{margin-left:auto;padding:2px;border:1px solid var(--pc-border);border-radius:7px;background:#fff}.markdown-modes button{height:28px;min-width:48px}.log-markdown-toolbar button:focus-visible{outline:2px solid var(--pc-primary);outline-offset:2px}
</style>
