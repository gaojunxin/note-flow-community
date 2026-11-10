<script setup lang="ts">
import {onMounted,ref} from 'vue'
import type {NoteEntity} from '@note-flow/core'
import {noteOrganizationService,type DuplicateCandidate} from '../services/noteOrganization'
import {useNotesStore} from '../stores/notes'
import {noteStamp,consolidationEligible} from '../services/noteConsolidation'
import {clientOwnerScope} from '../services/clientContext'
import {accountSessionRevision} from '../services/accountStorage'
const props=defineProps<{noteUid:string;ownerId:string}>(),emit=defineEmits<{close:[];select:[notes:NoteEntity[]]}>()
const store=useNotesStore(),rows=ref<DuplicateCandidate[]>([]),chosen=ref<string[]>([]),busy=ref(true),error=ref('')
const scope=clientOwnerScope(props.ownerId),session=accountSessionRevision()
function assertScope(){if(clientOwnerScope(props.ownerId)!==scope||accountSessionRevision()!==session)throw Error('账号已变化，请重新打开')}
onMounted(async()=>{try{rows.value=await noteOrganizationService.duplicates(props.noteUid);assertScope()}catch{error.value='重复检测失败，请重试'}finally{busy.value=false}})
async function proceed(){busy.value=true;error.value='';try{await store.flushPendingSaves();assertScope();const service=store.service(),notes=await Promise.all([props.noteUid,...chosen.value].map(uid=>service.get(uid)));assertScope();if(notes.some(note=>!note||!consolidationEligible(note)))throw Error('来源不存在或不允许整合，请重新选择');const full=notes as NoteEntity[];for(const note of full){const current=await service.get(note.uid);if(!current||noteStamp(current)!==noteStamp(note))throw Error('来源已变化，请重新检测')}assertScope();emit('select',full)}catch(source){error.value=source instanceof Error?source.message:'无法读取来源'}finally{busy.value=false}}
</script>
<template><div class="pc-modal-backdrop" @click.self="!busy&&emit('close')"><section role="dialog" aria-modal="true" aria-labelledby="duplicate-title" class="duplicate-dialog"><header><h2 id="duplicate-title">疑似重复笔记</h2><button aria-label="关闭重复检测" :disabled="busy" @click="emit('close')">×</button></header><p>选择要一起整理的笔记，进入整合预览后再决定是否替换原笔记。相似度仅供参考。</p><p v-if="busy" role="status">正在读取…</p><p v-if="error" role="alert">{{error}}</p><p v-if="!busy&&!error&&!rows.length">没有发现疑似重复笔记。</p><label v-for="row in rows" :key="row.uid"><input v-model="chosen" type="checkbox" :value="row.uid" :disabled="busy||chosen.length>=19&&!chosen.includes(row.uid)"><span><strong>{{row.title||'未命名笔记'}}</strong><small>{{Math.round(row.score*100)}}% · {{row.reason}}</small></span></label><footer><button :disabled="busy" @click="emit('close')">取消</button><button :disabled="busy||!chosen.length" @click="proceed">整合预览（{{chosen.length+1}} 篇）</button></footer></section></div></template>
<style scoped>
.duplicate-dialog{width:min(560px,calc(100vw - 32px));max-height:85vh;overflow:auto;padding:24px;border-radius:12px;background:var(--pc-surface,#fff);color:var(--pc-text)}header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{margin:0;font-size:18px}p,small{font-size:12px;line-height:1.6;color:var(--pc-muted)}label{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--pc-border)}label span{display:grid;gap:4px}strong{font-size:13px}button{padding:7px 12px;border:1px solid var(--pc-border);border-radius:6px;cursor:pointer}button:disabled{opacity:.5;cursor:default}footer{justify-content:flex-end;margin-top:18px}
</style>
