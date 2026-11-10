<script setup lang="ts">
import MoreIcon from './MoreIcon.vue'
import type { ProjectEntity } from '../services/workspace'

defineProps<{project:ProjectEntity;areaName?:string;showProjectName?:boolean;activeTab:'tasks'|'notes'|'logs'}>()
const emit=defineEmits<{tab:[value:'tasks'|'notes'|'logs'];status:[value:ProjectEntity['status']];archive:[];restore:[];export:[]}>()
const tabs=[{value:'tasks',label:'任务'},{value:'notes',label:'笔记'},{value:'logs',label:'日志'}] as const
</script>

<template>
  <section class="project-compact-head">
    <header><div class="project-compact-title"><h1>{{showProjectName?project.name:activeTab==='notes'?'项目笔记':activeTab==='logs'?'项目日志':'项目任务'}}</h1><span class="project-area-badge">{{areaName||'未分类'}}</span><p v-if="project.description" :title="project.description">{{project.description}}</p></div><div class="project-compact-actions"><select v-if="project.status!=='archived'" :value="project.status" aria-label="项目状态" @change="emit('status',($event.target as HTMLSelectElement).value as ProjectEntity['status'])"><option value="planning">规划中</option><option value="active">进行中</option><option value="paused">已暂停</option><option value="completed">已完成</option></select><span v-else class="project-archived-badge">已归档 · 只读</span><span v-if="project.targetDate">目标 {{project.targetDate}}</span><details class="project-more-actions"><summary aria-label="更多项目操作" title="更多项目操作" class="pc-more-trigger"><MoreIcon/></summary><div><button v-if="project.status==='archived'" @click="emit('restore')">恢复为已暂停</button><button v-else @click="emit('archive')">归档项目</button><button @click="emit('export')">导出项目</button></div></details></div></header>
    <nav><button v-for="item in tabs" :key="item.value" :class="{active:activeTab===item.value}" @click="emit('tab',item.value)">{{item.label}}</button></nav>
  </section>
</template>
