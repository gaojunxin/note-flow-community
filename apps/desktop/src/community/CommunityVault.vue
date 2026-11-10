<script setup lang="ts">
import {onBeforeUnmount,ref,watch} from 'vue'
import type {CoreContext,LocalReadHost,LocalTransactionHost} from '@note-flow/core/contracts'
import type {VaultItem,VaultBackup} from '@note-flow/core/vault'
import {createCommunityVault} from './vaultService'
import {exportCommunityFile} from './fileExport'
const confirmAction=(message:string)=>window.confirm(message)
async function saveAttachment(file:{name:string;bytes:Uint8Array;mediaType:string}){await run(async()=>{await exportCommunityFile(new Blob([file.bytes as BlobPart],{type:file.mediaType}),file.name)})}
const props=defineProps<{host:LocalReadHost&LocalTransactionHost;context:CoreContext}>()
let service=createCommunityVault(props.host,props.context)
const exists=ref(false),unlocked=ref(false),password=ref(''),nextPassword=ref(''),busy=ref(false),error=ref(''),items=ref<VaultItem[]>([]),draft=ref<Partial<VaultItem>>({}),selected=ref(''),attachments=ref<Awaited<ReturnType<typeof service.attachments>>>([])
const reset=()=>{service.lock();unlocked.value=false;password.value='';nextPassword.value='';items.value=[];draft.value={};attachments.value=[];selected.value=''}
watch(()=>[props.host,props.context.profileId],async()=>{reset();service=createCommunityVault(props.host,props.context);exists.value=await service.exists()},{immediate:true})
onBeforeUnmount(reset)
async function run(action:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';try{await action()}catch(cause){error.value=cause instanceof Error?cause.message:'保险箱操作失败'}finally{busy.value=false}}
async function refresh(){items.value=await service.list();if(selected.value)attachments.value=await service.attachments(selected.value)}
async function open(){await run(async()=>{if(exists.value)await service.unlock(password.value);else await service.create(password.value);password.value='';exists.value=true;unlocked.value=true;await refresh()})}
async function save(){await run(async()=>{await service.put({...draft.value,title:draft.value.title||'',password:draft.value.password||''});draft.value={};await refresh()})}
async function select(item:VaultItem){if(busy.value)return;draft.value={...item};selected.value=item.uid;await run(refresh)}
async function exportBackup(){await run(async()=>{await exportCommunityFile(new Blob([JSON.stringify(await service.export())],{type:'application/json'}),'community-vault-encrypted.json')})}
async function restore(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;await run(async()=>{const backup=JSON.parse(await file.text()) as VaultBackup;if(!confirm('用此密文备份替换当前空间密码库？请确认已保存现有备份。'))return;await service.restore(backup,password.value);password.value='';exists.value=true;unlocked.value=true;await refresh()});input.value=''}
async function attach(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];if(file&&selected.value)await run(async()=>{await service.attach(selected.value,file);await refresh()});input.value=''}
</script>
<template>
<section aria-label="本地密码库"><h2>本地密码库</h2><p>凭据与附件使用主密码加密，随完整空间备份保存。主密码不会保存，遗失后无法找回；请另存密文备份。此密码库独立于原官方账号库，仅在当前社区空间使用。</p><p v-if="error" role="alert">{{error}}</p>
<form v-if="!unlocked" @submit.prevent="open"><label>主密码<input v-model="password" aria-label="密码库主密码" type="password" autocomplete="off" required></label><button :disabled="busy">{{exists?'解锁密码库':'创建密码库'}}</button><p>新主密码至少12个字符。</p></form>
<template v-else><button :disabled="busy" @click="reset">锁定密码库</button><form @submit.prevent="save"><label>名称<input v-model="draft.title" aria-label="凭据名称" required></label><label>账号<input v-model="draft.username" aria-label="凭据账号" autocomplete="off"></label><label>密码<input v-model="draft.password" aria-label="凭据密码" type="password" autocomplete="new-password"></label><label>地址<input v-model="draft.url" aria-label="凭据地址"></label><label>备注<textarea v-model="draft.notes" aria-label="凭据备注"/></label><button :disabled="busy">{{draft.uid?'保存凭据':'添加凭据'}}</button><button type="button" :disabled="busy" @click="draft={};selected='';attachments=[]">新建凭据</button></form>
<article v-for="item in items" :key="item.uid"><strong>{{item.title}}</strong><span>{{item.username}}</span><button :disabled="busy" @click="select(item)">编辑</button><button :disabled="busy" @click="run(async()=>{if(confirmAction('删除此凭据及其附件？')){await service.remove(item.uid);draft={};selected='';attachments=[];await refresh()}})">删除</button></article>
<section v-if="selected"><h3>加密附件</h3><input type="file" aria-label="添加密码库附件" :disabled="busy" @change="attach"><article v-for="file in attachments" :key="file.uid"><span>{{file.name}}</span><button :disabled="busy" @click="saveAttachment(file)">保存附件</button><button :disabled="busy" @click="run(async()=>{await service.removeAttachment(file.uid);await refresh()})">删除附件</button></article></section>
<form @submit.prevent="run(async()=>{await service.changePassword(password,nextPassword);password='';nextPassword=''})"><label>当前主密码<input v-model="password" type="password" autocomplete="off"></label><label>新主密码<input v-model="nextPassword" type="password" autocomplete="new-password"></label><button :disabled="busy">修改主密码</button></form></template>
<button :disabled="busy||!exists" @click="exportBackup">导出密文密码库</button><label>备份主密码<input v-if="unlocked" v-model="password" type="password" autocomplete="off"></label><label>恢复当前空间的密文备份<input type="file" accept=".json" :disabled="busy" @change="restore"></label><p>恢复仅接受同一空间 owner 的有效备份；错误密码或损坏密文不会覆盖当前数据。桌面和安卓使用应用本地仓储，网页使用当前浏览器本地仓储，清除应用数据或网站存储会丢失本地库。</p>
</section>
</template>
<style scoped>
section{min-width:0;color:#29483c}h2{margin:0 0 14px}p{line-height:1.65;color:#63776d}form{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:14px;margin:18px 0;padding:18px;background:#f7faf8;border:1px solid #dce6e0;border-radius:12px}label{display:flex;flex-direction:column;gap:7px;min-width:0;margin:10px 0;font-size:14px}form label{margin:0}input,textarea{box-sizing:border-box;width:100%;min-height:44px;padding:10px 12px;border:1px solid #cbdad1;border-radius:8px;background:white;color:#29483c;font:inherit}textarea{min-height:88px;resize:vertical}button{min-height:44px;padding:10px 16px;margin:4px 6px 4px 0;border:1px solid #cbdad1;border-radius:8px;background:#edf5ef;color:#245a40;font:inherit;cursor:pointer}button:disabled{opacity:.55;cursor:default}form button{align-self:end}article{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid #dce6e0}article strong,article span{overflow-wrap:anywhere;min-width:0}article strong{flex:1 1 180px}article span{flex:1 1 140px}section section{margin-top:18px;padding:14px;background:#f7faf8;border-radius:10px}[role=alert]{padding:12px;background:#fff1ef;color:#a2463e;border-radius:8px}@media(max-width:600px){form{padding:12px;grid-template-columns:1fr}article{align-items:stretch}article strong,article span{flex-basis:100%}article button{flex:1 1 100px}input[type=file]{font-size:13px}}
</style>
