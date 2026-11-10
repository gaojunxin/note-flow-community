<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref} from 'vue'
import {useRouter} from 'vue-router'
import {localRestoreStatus,pcSyncResetEvents} from '../services/syncResetGuard'
withDefaults(defineProps<{showAction?:boolean}>(),{showAction:true})
const router=useRouter(),pending=ref(false),damaged=ref(false),unavailable=ref(false),checking=ref(false)
let generation=0
async function refresh(){const request=++generation;checking.value=true;try{const value=await localRestoreStatus();if(request===generation){pending.value=value!=='none';damaged.value=value==='damaged';unavailable.value=false}}catch{if(request===generation){pending.value=false;damaged.value=false;unavailable.value=true}}finally{if(request===generation)checking.value=false}}
const changed=()=>{pending.value=false;damaged.value=false;unavailable.value=false;void refresh()}
onMounted(()=>{void refresh();window.addEventListener('note-flow:workspace-change',changed);window.addEventListener(pcSyncResetEvents.resume,changed)})
onBeforeUnmount(()=>{generation++;window.removeEventListener('note-flow:workspace-change',changed);window.removeEventListener(pcSyncResetEvents.resume,changed)})
</script>
<template><aside v-if="pending||unavailable" class="local-restore-notice" role="alert"><strong>{{damaged?'备份恢复状态损坏，云同步已暂停':pending?'上次备份恢复尚未完成，云同步已暂停':'无法确认备份恢复状态'}}</strong><p>{{damaged?'恢复标记无法识别，重新选择同一备份也无法继续。请保留原备份文件与本机数据，修复恢复状态前请勿清除数据或强行开启同步。':pending?'请在“备份恢复”中重新选择上次使用的同一个备份文件，继续恢复。恢复全部完成后，云同步会自动恢复。请保留原备份文件。':'请重新检查；在恢复状态可确认前，同步保护不会放行。'}}</p><div><button v-if="pending&&showAction!==false" type="button" @click="router.push('/settings?tab=protection')">前往备份恢复</button><button type="button" :disabled="checking" @click="refresh">{{checking?'正在检查…':'重新检查恢复状态'}}</button></div></aside></template>
<style scoped>
.local-restore-notice{margin:12px 0;padding:12px 14px;border:1px solid #e8cf91;border-radius:8px;background:#fffbef;color:var(--pc-text)}strong{font-size:13px}p{margin:7px 0;font-size:12px;line-height:1.6;color:var(--pc-muted)}div{display:flex;flex-wrap:wrap;gap:8px}button{padding:6px 10px;border:1px solid var(--pc-border);border-radius:6px;background:var(--pc-surface,#fff);color:inherit;cursor:pointer}button:disabled{opacity:.5}
</style>
