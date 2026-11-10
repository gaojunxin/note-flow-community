<template><div class="unavailable-editor"><span>{{adapter?.badge||'未知'}}</span><h3>{{adapter?.label||'暂不支持的画布类型'}}</h3><p>{{adapter?.enabled?'编辑器正在加载。':'此类型的编辑器即将支持。文档数据已安全保留，你仍可重命名、查看历史或移入回收状态。'}}</p></div></template>
<script setup lang="ts">
import {computed} from 'vue'
import {getCanvasTypeAdapter} from '../../canvas/registry'
const props=defineProps<{canvasType?:string}>()
const adapter=computed(()=>getCanvasTypeAdapter(props.canvasType))
</script>
<style scoped>
.unavailable-editor{display:grid;height:100%;place-content:center;justify-items:center;padding:40px;background:radial-gradient(circle,#f8fbf9,#f1f5f2);color:#29483c;text-align:center}.unavailable-editor>span{display:grid;width:54px;height:54px;place-items:center;border-radius:16px;background:#e4f0e9;color:#2f6852;font-size:12px;font-weight:800}.unavailable-editor h3{margin:16px 0 7px;font-size:20px}.unavailable-editor p{max-width:460px;margin:0;color:#75877f;font-size:12px;line-height:1.7}
</style>

