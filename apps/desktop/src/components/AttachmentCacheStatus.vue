<script setup lang="ts">
import {ElButton,ElPopover} from 'element-plus'
import 'element-plus/es/components/popover/style/css'
import 'element-plus/es/components/button/style/css'
/** 展示已完成读取的离线状态；toggle由调用方执行固定缓存写入并反馈失败。 */
defineProps<{state:{source:string;persistent:boolean;pinned:boolean}}>()
defineEmits<{toggle:[]}>()
</script>
<template>
  <ElPopover trigger="click" placement="bottom-end" :width="250">
    <template #reference><ElButton text class="cache-status" :title="state.persistent?'离线可用，点击查看详情':'未保留离线副本，点击查看详情'" :aria-label="state.persistent?'离线状态：可离线阅读':'离线状态：未保留副本'"><span aria-hidden="true">{{state.persistent?'✓':'!'}}</span></ElButton></template>
    <p role="status">{{state.persistent?'文件已保存到本机，可离线阅读':'本次已加载，缓存未能保留；关闭后可能需要重新下载'}}</p>
    <ElButton v-if="state.persistent&&state.source!=='local'" size="small" @click="$emit('toggle')">{{state.pinned?'取消保留离线':'保留离线'}}</ElButton>
  </ElPopover>
</template>
<style scoped>.cache-status{flex:none;min-width:32px;height:32px;color:var(--pc-muted,#66756d)}p{margin:0 0 10px;font-size:13px;line-height:1.6}</style>
