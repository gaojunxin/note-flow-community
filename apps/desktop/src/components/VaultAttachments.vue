<script setup lang="ts">
import {saveLocalExport} from '../services/localFileExport'
import {onMounted,ref,watch} from 'vue'
import {confirmDialog} from '../services/productDialog'
import {isCommunityEdition} from '../services/clientCapabilities'
import {exportCommunityFile} from '../community/fileExport'
import {deleteVaultAttachment,listVaultAttachments,readVaultAttachment,saveVaultAttachment,type VaultAttachment} from '../services/vault'
const props=defineProps<{ownerId:string;itemUid:string;vaultKey:CryptoKey}>(),emit=defineEmits<{changed:[]}>()
const values=ref<VaultAttachment[]>([]),busy=ref(false),message=ref('')
async function load(){values.value=await listVaultAttachments(props.ownerId,props.itemUid,props.vaultKey)}
async function add(event:Event){const input=event.target as HTMLInputElement,files=[...(input.files||[])];if(!files.length)return;busy.value=true;message.value='';try{for(const file of files)await saveVaultAttachment(props.ownerId,props.itemUid,props.vaultKey,file);await load();emit('changed')}catch(source){message.value=source instanceof Error?source.message:'附件加密失败'}finally{busy.value=false;input.value=''}}
async function open(value:VaultAttachment){busy.value=true;message.value='';try{const result=await readVaultAttachment(props.ownerId,props.itemUid,value.uid,props.vaultKey),blob=new Blob([result.bytes as BlobPart],{type:value.mediaType});if(isCommunityEdition){if(!await exportCommunityFile(blob,value.name))message.value='已取消附件导出';return}if(!await saveLocalExport(blob,value.name))message.value='已取消附件导出'}catch(source){message.value=source instanceof Error?source.message:'附件导出失败'}finally{busy.value=false}}
async function remove(value:VaultAttachment){if(!await confirmDialog(`删除加密附件“${value.name}”？`))return;await deleteVaultAttachment(props.ownerId,props.itemUid,value.uid);await load();emit('changed')}
watch(()=>props.itemUid,load);onMounted(load)
</script>
<template><section class="vault-attachments" :class="{'empty-state':!values.length}"><header><div><strong>加密附件</strong><small>{{values.length?`${values.length} 个附件，文件名和内容均已加密`:'暂无附件'}}</small></div><label :class="{disabled:busy}">＋ 添加文件<input type="file" multiple :disabled="busy" @change="add"></label></header><p v-if="message" class="error">{{message}}</p><article v-for="value in values" :key="value.uid"><span><b>{{value.name}}</b><small>{{value.mediaType}} · {{Math.max(1,Math.ceil(value.size/1024))}} KB</small></span><button :disabled="busy" @click="open(value)">解密下载</button><button class="danger" :disabled="busy" @click="remove(value)">删除</button></article></section></template>
<style scoped>
.vault-attachments{display:grid;width:100%;max-width:880px;box-sizing:border-box;gap:8px;margin:18px 0;padding:14px;border:1px solid var(--pc-border);border-radius:10px}.vault-attachments.empty-state{margin-top:14px;padding:10px 12px}.vault-attachments header{display:flex;align-items:center;justify-content:space-between}.vault-attachments header div,.vault-attachments article span{display:grid;min-width:0;gap:3px}.vault-attachments strong{font-size:12px}.vault-attachments small{color:var(--pc-muted);font-size:10px}.vault-attachments label,.vault-attachments button{flex:0 0 auto;padding:7px 10px;border:1px solid var(--pc-border);border-radius:6px;background:#fff;color:var(--pc-primary);font-size:10px;cursor:pointer}.vault-attachments input{display:none}.vault-attachments article{display:flex;min-width:0;align-items:center;gap:7px;padding-top:8px;border-top:1px solid #edf1ee}.vault-attachments article span{min-width:0;margin-right:auto}.vault-attachments article b{overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.vault-attachments .danger,.error{color:#a23f3f}.disabled{opacity:.5;pointer-events:none}
</style>
