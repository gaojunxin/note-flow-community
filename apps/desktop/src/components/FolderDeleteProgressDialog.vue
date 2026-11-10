<script setup lang="ts">
import type {FolderDeleteProgress} from '../services/folders'
defineProps<{name:string;busy:boolean;error:string;progress:FolderDeleteProgress}>()
const emit=defineEmits<{close:[]}>()
</script>
<template>
  <Teleport to="body"><div class="pc-modal-backdrop" @click.self="!busy&&emit('close')"><section class="pc-task-dialog folder-delete-dialog" role="dialog" aria-modal="true" :aria-label="`删除目录：${name}`" :aria-busy="busy">
    <div class="section-heading"><h2>{{busy?'正在删除目录':error?'删除未完成':'删除完成'}}</h2><button v-if="!busy" type="button" aria-label="关闭删除结果" @click="emit('close')">×</button></div>
    <p>“{{name}}”及全部子目录</p>
    <div v-if="busy" class="delete-progress" role="status" aria-live="polite"><strong>{{progress.phase}}…</strong><progress v-if="progress.total>0" :value="progress.completed" :max="progress.total" :aria-label="progress.phase"/><progress v-else :aria-label="progress.phase"/><span v-if="progress.total>0">{{progress.completed}} / {{progress.total}} 项</span><small v-if="progress.current" :title="progress.current">{{progress.current}}</small><small>请保持窗口打开，正在将内容移到回收站并删除目录。</small></div>
    <p v-else-if="error" class="delete-error" role="alert">{{error}}。请检查剩余内容后重试。</p>
    <p v-else role="status">目录已删除，其中的笔记和文件已移到回收站，附件保留。</p>
    <div v-if="!busy" class="dialog-actions"><button type="button" class="primary-action" @click="emit('close')">确认</button></div>
  </section></div></Teleport>
</template>
<style scoped>
.folder-delete-dialog{width:min(480px,calc(100vw - 48px))}.delete-progress{display:grid;gap:12px;margin:16px 0;padding:18px;border:1px solid var(--pc-border);border-radius:10px;background:var(--pc-primary-soft)}.delete-progress progress{width:100%;height:12px;accent-color:var(--pc-primary)}.delete-progress small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--pc-muted)}.delete-error{color:#a14444}
</style>
