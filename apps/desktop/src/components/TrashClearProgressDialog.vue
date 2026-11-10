<script setup lang="ts">
defineProps<{busy:boolean;phase:string;completed:number;total:number;current:string;removed:number;failures:Array<{title:string;reason:string}>;error:string}>()
const emit=defineEmits<{close:[];retry:[]}>()
</script>
<template>
  <Teleport to="body"><div class="pc-modal-backdrop" @click.self="!busy&&emit('close')"><section class="pc-task-dialog trash-progress-dialog" role="dialog" aria-modal="true" aria-label="永久删除回收站内容" :aria-busy="busy">
    <div class="section-heading"><h2>{{busy?'正在清理回收站':failures.length||error?'清理未全部完成':'清理完成'}}</h2><button v-if="!busy" aria-label="关闭清理结果" @click="emit('close')">×</button></div>
    <div v-if="busy" class="trash-progress" role="status" aria-live="polite"><strong>{{phase}}</strong><progress :value="phase==='永久删除内容'&&completed>0?completed:undefined" :max="total||1"/><span>{{phase!=='永久删除内容'?`准备处理 ${total} 项`:completed===0?`正在处理首批内容，共 ${total} 项`:`已处理 ${completed} / ${total} 项`}}</span><small>{{current}}</small></div>
    <p v-else role="status">已永久删除 {{removed}} 项，{{failures.length}} 项未完成。</p>
    <p v-if="error" role="alert">{{error}}</p>
    <ul v-if="failures.length" class="trash-failures"><li v-for="(failure,index) in failures" :key="index">{{failure.title}}：{{failure.reason}}</li></ul>
    <p v-if="!busy&&failures.length">未完成的内容仍保留在回收站，可处理原因后重试。</p>
    <div v-if="!busy" class="dialog-actions"><button v-if="failures.length" @click="emit('retry')">重试未完成项</button><button class="primary-action" @click="emit('close')">确认</button></div>
  </section></div></Teleport>
</template>
<style scoped>
.trash-progress-dialog{width:min(520px,calc(100vw - 48px))}.trash-progress{display:grid;gap:12px;margin:16px 0}.trash-progress progress{width:100%;accent-color:var(--pc-primary)}.trash-progress small{overflow-wrap:anywhere}.trash-failures{max-height:240px;overflow:auto;padding-left:20px;color:#a14444}
</style>
