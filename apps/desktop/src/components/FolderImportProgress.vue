<script setup lang="ts">
defineProps<{phase:string;completed:number;total:number;current?:string}>()
</script>
<template>
  <section class="folder-import-progress" role="status" aria-live="polite">
    <strong>{{phase||'正在准备导入'}}…</strong>
    <progress v-if="total>0" :value="completed" :max="total" :aria-label="phase"/>
    <progress v-else :aria-label="phase"/>
    <p>{{total>0?`${completed} / ${total} 个文件`:`已发现 ${completed} 个文件`}}</p>
    <small v-if="current" :title="current">{{current}}</small>
    <small>请保持窗口打开，完成后会显示结果供你确认。</small>
  </section>
</template>
<style scoped>
.folder-import-progress{display:grid;gap:10px;margin:12px 0;padding:18px;border:1px solid var(--pc-border);border-radius:10px;background:var(--pc-primary-soft)}.folder-import-progress strong{font-size:15px}.folder-import-progress progress{width:100%;height:10px;accent-color:var(--pc-primary)}.folder-import-progress p{margin:0;font-size:13px}.folder-import-progress small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--pc-muted);font-size:12px}
</style>
