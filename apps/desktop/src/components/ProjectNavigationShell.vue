<script setup lang="ts">
import {nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {ElButton,ElPopover} from 'element-plus'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/popover/style/css'

const props=defineProps<{ownerId:string;projectName?:string;selectedUid?:string;dismissKey?:string;toolbarTarget?:string}>()
const ready=ref(false)
onMounted(async()=>{await nextTick();ready.value=true})
const open=ref(false),trigger=ref<InstanceType<typeof ElButton>>(),panel=ref<HTMLElement>()
async function close(){open.value=false;await nextTick();trigger.value?.ref?.focus()}
async function focusSearch(){await nextTick();panel.value?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()}
function escape(event:KeyboardEvent){if(open.value&&event.key==='Escape'){event.preventDefault();event.stopPropagation();void close()}}
watch(open,value=>{if(value)document.addEventListener('keydown',escape,true);else document.removeEventListener('keydown',escape,true)})
onBeforeUnmount(()=>document.removeEventListener('keydown',escape,true))
watch(()=>[props.ownerId,props.selectedUid,props.dismissKey],()=>{open.value=false})
</script>

<template>
 <div class="project-route-shell">
  <Teleport v-if="ready" :to="toolbarTarget||'body'" :disabled="!toolbarTarget">
   <div class="project-switcher">
    <ElPopover v-model:visible="open" trigger="click" placement="bottom-start" :width="360" popper-class="project-switcher-popover" :show-arrow="false" :persistent="false" @after-enter="focusSearch">
     <template #reference><ElButton ref="trigger" text class="project-switcher-trigger" aria-label="切换项目" aria-haspopup="dialog" :aria-expanded="open" :title="projectName||'选择项目'"><svg class="project-switcher-folder" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5h6l2 2h10v13H3Z"/></svg><span>{{projectName||'选择项目'}}</span><svg class="project-switcher-chevron" viewBox="0 0 20 20" aria-hidden="true" :class="{open}"><path d="m6 8 4 4 4-4"/></svg></ElButton></template>
     <section ref="panel" class="project-switcher-panel" role="dialog" aria-label="切换项目" @keydown.esc.stop.prevent="close"><slot name="list" :collapse="close"/></section>
    </ElPopover>
   </div>
  </Teleport>
  <div class="project-route-content"><div class="project-content-body"><slot/></div></div>
 </div>
</template>

<style scoped>
.project-route-shell{grid-template-columns:minmax(0,1fr)}
.project-route-content{display:flex;flex-direction:column;min-width:0;min-height:0}
.project-content-body{flex:1;min-height:0;min-width:0;overflow:hidden}
.project-content-body :deep(>.projects-page){display:block}
.project-switcher{min-width:0;max-width:100%}
.project-switcher-trigger{display:flex;gap:9px;max-width:100%;height:36px;padding:0 8px;font-size:13px;font-weight:600}
.project-switcher-trigger :deep(>span){display:flex;gap:9px;align-items:center;min-width:0}
.project-switcher-trigger span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:290px}
.project-switcher-trigger svg{flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.project-switcher-folder{width:19px;height:19px;color:var(--pc-primary)}
.project-switcher-chevron{width:14px;height:14px;color:var(--pc-muted);transition:transform .15s}
.project-switcher-chevron.open{transform:rotate(180deg)}
.project-switcher-panel :deep(.project-list-panel){display:flex;flex-direction:column;width:100%;height:auto;max-height:min(65vh,620px);padding:0;border:0;background:transparent;box-sizing:border-box}
.project-switcher-panel :deep(.project-navigation-tree){overflow:auto;min-height:0;flex:1;padding:4px 0}
.project-switcher-panel :deep(.project-list-panel>header){padding:4px 6px 10px;font-size:13px}
.project-switcher-panel :deep(.project-list-search){margin:0 4px 8px;min-height:34px}.project-switcher-panel :deep(.project-list-search input){font-size:12px}.project-switcher-panel :deep(.project-list-panel>header button){font-size:12px}
.project-switcher-panel :deep(.project-tree-item){font-size:12px;height:32px}
.project-switcher-panel :deep(.el-tree-node__content){height:32px;min-height:32px;border-radius:6px}
.project-switcher-panel :deep(.project-tree-item>small){font-size:10px}
.project-switcher-panel :deep(.project-switcher-footer){display:flex;justify-content:space-between;border-top:1px solid var(--pc-border);margin-top:8px;padding:8px 0 0}
@media(max-width:1100px){.project-switcher-trigger span{max-width:180px}}
</style>
<style>
.el-popover.project-switcher-popover{max-width:calc(100vw - 24px);padding:12px;border-radius:10px;box-shadow:0 12px 36px #172b211f}
#project-switcher-anchor{min-width:0;max-width:36%;flex:0 1 340px}
.pc-topbar:has(#project-switcher-anchor) .global-search{min-width:140px;flex:1}
</style>
