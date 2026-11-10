<script setup lang="ts">
export interface FolderImportOutcome { imported:number;skipped:number;createdFolders:number;unfinished:number;emptyFiles?:number;issues?:{path:string;reason:string}[];error?:string }
defineProps<{result:FolderImportOutcome;destination:string}>()
defineEmits<{dismiss:[]}>()
</script>
<template>
  <section class="folder-import-result" :class="{warning:result.error}" role="status" aria-live="polite">
    <div><strong>{{result.error?'导入未全部完成':'导入成功'}}</strong><p>已导入 {{result.imported}} 个文件到“{{destination}}”，跳过 {{result.skipped}} 个重复文件，创建 {{result.createdFolders}} 个目录<span v-if="result.emptyFiles">，跳过 {{result.emptyFiles}} 个空文件</span><span v-if="result.unfinished">，{{result.unfinished}} 个文件未完成</span>。</p><p v-if="result.error">{{result.error}}</p><details v-if="result.issues?.length"><summary>查看跳过或失败的文件（{{result.issues.length}}）</summary><ul><li v-for="(issue,index) in result.issues" :key="index">{{issue.path}}：{{issue.reason}}</li></ul></details></div>
    <button type="button" aria-label="关闭导入结果" @click="$emit('dismiss')">×</button>
  </section>
</template>
<style scoped>
.folder-import-result{display:flex;align-items:flex-start;gap:12px;margin:12px 0;padding:14px 16px;border:1px solid #b8d7c4;border-radius:10px;background:#edf7f0;color:#236344}.folder-import-result>div{flex:1;min-width:0}.folder-import-result strong{font-size:15px}.folder-import-result p{margin:6px 0 0;font-size:12px;line-height:1.6;overflow-wrap:anywhere}.folder-import-result button{flex:none;width:28px;min-height:28px;padding:0;border:0;background:transparent;color:inherit;font-size:20px}.folder-import-result.warning{background:#fff7e8;border-color:#eed1a1;color:#8c5e1e}
</style>
