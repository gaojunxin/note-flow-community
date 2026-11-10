<script setup lang="ts">
import {ElButton} from 'element-plus'
import {nextTick,onBeforeUnmount,ref,watch} from 'vue'
import type {PDFDocumentProxy,PDFPageProxy,RenderTask} from 'pdfjs-dist'
import {pdfPreviewError} from '../services/pdfPreview'

/** 借用父阅读器的文档代理；卸载只回收本页资源，不销毁文档或共享worker。 */
const props=defineProps<{pdf:PDFDocumentProxy;page:number;scale:number;filename:string}>()
const emit=defineEmits<{measure:[size:{width:number;height:number}]}>()
const canvas=ref<HTMLCanvasElement>(),loading=ref(true),error=ref('')
let generation=0,render:RenderTask|undefined,pageProxy:PDFPageProxy|undefined

/** 每个可见页独立取消；离开视口时释放画布，旧任务不得覆盖后来挂载或缩放的页面。 */
async function draw(){
  const request=++generation;render?.cancel();render=undefined;loading.value=true;error.value=''
  try{
    const sheet=await props.pdf.getPage(props.page);if(request!==generation)return;pageProxy=sheet
    const original=sheet.getViewport({scale:1});emit('measure',{width:original.width,height:original.height})
    await nextTick();if(request!==generation||!canvas.value)return
    const viewport=sheet.getViewport({scale:props.scale}),target=canvas.value
    // 连续阅读同时持有数页，单页限制为400万像素，避免沿用单页1600万的总内存开销。
    const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(4_000_000/(viewport.width*viewport.height)))
    target.width=Math.max(1,Math.floor(viewport.width*ratio));target.height=Math.max(1,Math.floor(viewport.height*ratio))
    target.style.width=`${Math.ceil(viewport.width)}px`;target.style.height=`${Math.ceil(viewport.height)}px`
    const context=target.getContext('2d');if(!context)throw new Error('无法创建 PDF 绘图画布')
    render=sheet.render({canvas:target,canvasContext:context,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]})
    await render.promise
  }catch(source){if(request===generation&&(source as Error)?.name!=='RenderingCancelledException')error.value=pdfPreviewError(source)}
  finally{if(request===generation)loading.value=false}
}
watch(()=>[props.pdf,props.page,props.scale],()=>void draw(),{immediate:true})
onBeforeUnmount(()=>{
  generation++;render?.cancel();if(canvas.value){canvas.value.width=0;canvas.value.height=0}
  // 等本页绘制退出再回收PDF.js的图片/操作列表；若页面已重新进入视口，cleanup会保留正在使用的资源。
  void Promise.resolve(render?.promise).catch(()=>{}).then(()=>pageProxy?.cleanup()).catch(()=>{})
})
</script>
<template>
  <div class="pdf-sheet-canvas" :data-render-state="error?'error':loading?'loading':'ready'" :aria-busy="loading">
    <canvas ref="canvas" :aria-label="`${filename}，第 ${page} 页`"/>
    <p v-if="loading" role="status">正在绘制第 {{page}} 页…</p>
    <p v-if="error" class="pdf-sheet-error" role="alert">{{error}} <ElButton size="small" @click="draw">重试此页</ElButton></p>
  </div>
</template>
<style scoped>
.pdf-sheet-canvas{position:relative;width:100%;height:100%}.pdf-sheet-canvas canvas{display:block;background:#fff}.pdf-sheet-canvas>p{position:absolute;top:0;left:0;box-sizing:border-box;max-width:100%;margin:0;padding:12px;background:#fffffff0;color:#5c6b62;font-size:13px}.pdf-sheet-canvas>.pdf-sheet-error{color:#a14444}
</style>
