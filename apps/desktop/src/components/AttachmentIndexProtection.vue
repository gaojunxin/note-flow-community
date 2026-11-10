<script setup lang="ts">
import {clearWorkspaceDerivedIndexes} from '../services/workspaceDerivedReset'
import {clientOwnerScope} from '../services/clientContext'

import {onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {attachmentIndexProtectionState,prepareAttachmentIndexProtection,unlockAttachmentIndexProtection,lockAttachmentIndexProtection,exportAttachmentIndexKey,restoreAttachmentIndexKey,changeAttachmentIndexPassword} from '../services/attachmentIndexProtection'
import {saveLocalExport} from '../services/localFileExport'
import {accountLifecycleRevision} from '../services/accountStorage'
import {appLock} from '../services/appLock'
const props=defineProps<{ownerId:string}>(),emit=defineEmits<{change:[state:{configured:boolean;unlocked:boolean}]}>()
const configured=ref(false),unlocked=ref(false),mode=ref<'create'|'unlock'|'recovery'|'restore'|'clear'|'change'|''>(''),password=ref(''),newPassword=ref(''),confirmation=ref(''),recovery=ref(''),recoveryCheck=ref(''),saved=ref(false),busy=ref(false),error=ref('')
let pendingArchive=''
const backupPicker=ref<HTMLInputElement>()
let sequence=0,controller:AbortController|undefined,prepared:Awaited<ReturnType<typeof prepareAttachmentIndexProtection>>|undefined
function publish(){emit('change',{configured:configured.value,unlocked:unlocked.value})}
function close(){controller?.abort();sequence++;mode.value='';pendingArchive='';password.value='';newPassword.value='';confirmation.value='';recovery.value='';recoveryCheck.value='';saved.value=false;prepared=undefined;busy.value=false;error.value=''}
async function refresh(){const current=++sequence,owner=props.ownerId,revision=accountLifecycleRevision();try{const state=await attachmentIndexProtectionState(owner);if(current!==sequence||owner!==props.ownerId||revision!==accountLifecycleRevision())return;configured.value=state.configured;unlocked.value=state.unlocked;publish()}catch{if(current===sequence){unlocked.value=false;publish()}}}
function open(){close();mode.value=configured.value?'unlock':'create'}
async function submit(){
 error.value='';busy.value=true;controller=new AbortController();const current=sequence,owner=props.ownerId
 try{
  if(mode.value==='clear'){
   await clearWorkspaceDerivedIndexes(clientOwnerScope(owner));if(current!==sequence)return;close();await refresh()
  }else if(mode.value==='change'){
   if(newPassword.value.length<12||newPassword.value!==confirmation.value)throw Error('请输入至少 12 字符且一致的新口令')
   await changeAttachmentIndexPassword(owner,password.value,newPassword.value,saved.value?'recovery':'password',controller.signal);if(current!==sequence)return;close();await refresh()
  }else if(mode.value==='create'){
   if(password.value.length<12||password.value!==confirmation.value)throw Error('请输入至少 12 字符且一致的口令')
   const value=await prepareAttachmentIndexProtection(owner,password.value,controller.signal)
   if(current!==sequence)return
   prepared=value;recovery.value=value.recoveryCode;password.value='';newPassword.value='';confirmation.value='';mode.value='recovery'
  }else if(mode.value==='recovery'){
   if(!saved.value||recoveryCheck.value!==recovery.value)throw Error('请保存恢复码，并粘贴核对')
   await prepared!.commit(controller.signal);if(current!==sequence)return
   close();await refresh()
  }else if(mode.value==='restore'){
   await restoreAttachmentIndexKey(owner,pendingArchive,password.value,saved.value?'recovery':'password',controller.signal);if(current!==sequence)return;close();await refresh()
  }else{
   await unlockAttachmentIndexProtection(owner,password.value,saved.value?'recovery':'password',controller.signal)
   if(current!==sequence)return
   close();await refresh()
  }
 }catch(source){if(current===sequence)error.value=source instanceof Error?source.message:'索引保护操作未完成'}
 finally{if(current===sequence)busy.value=false}
}
async function downloadKey(){const owner=props.ownerId,revision=accountLifecycleRevision();try{const archive=await exportAttachmentIndexKey(owner);if(owner!==props.ownerId||revision!==accountLifecycleRevision()||appLock.locked.value)return;await saveLocalExport(new Blob([JSON.stringify(archive)],{type:'application/json'}),'note-flow-attachment-index-keys.json')}catch{error.value='密钥备份未完成，请重试'}}
async function importKey(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(!file)return;close();const current=sequence,owner=props.ownerId,revision=accountLifecycleRevision();try{if(file.size>2*1024*1024)throw Error('索引密钥备份过大');const text=await file.text();if(current!==sequence||owner!==props.ownerId||revision!==accountLifecycleRevision())return;pendingArchive=text;mode.value='restore';saved.value=true}catch{error.value='无法读取索引密钥备份'}}
function lock(){lockAttachmentIndexProtection(props.ownerId);unlocked.value=false;close();publish()}
function invalidate(){close();unlocked.value=false;publish()}
watch(()=>props.ownerId,()=>{close();configured.value=false;unlocked.value=false;publish();void refresh()},{immediate:true})
function keyChanged(event:Event){if((event as CustomEvent).detail?.scope!==clientOwnerScope(props.ownerId))return;if(busy.value){unlocked.value=false;publish()}else{invalidate();void refresh()}}
function foreground(){if(!mode.value&&!busy.value)void refresh()}
onMounted(()=>{window.addEventListener('note-flow:workspace-key-change',keyChanged);for(const event of ['note-flow:app-locked','note-flow:account-lifecycle-change','pagehide'])window.addEventListener(event,invalidate);window.addEventListener('focus',foreground);window.addEventListener('pageshow',foreground)})
onBeforeUnmount(()=>{window.removeEventListener('note-flow:workspace-key-change',keyChanged);close();for(const event of ['note-flow:app-locked','note-flow:account-lifecycle-change','pagehide'])window.removeEventListener(event,invalidate);window.removeEventListener('focus',foreground);window.removeEventListener('pageshow',foreground)})
</script>
<template>
 <div class="attachment-index-protection"><span>本机附件加密索引 · {{configured?(unlocked?'已解锁':'已锁定'):'未启用'}}</span><button v-if="!unlocked" :disabled="appLock.locked.value" @click="open">{{configured?'解锁索引':'启用加密索引'}}</button><button v-else @click="lock">锁定索引</button><button v-if="configured" @click="downloadKey">备份索引密钥</button><button v-if="configured" @click="close();mode='change'">更换索引口令</button><button v-if="configured" @click="close();mode='clear'">清理索引缓存</button><button v-if="!configured" @click="backupPicker?.click()">恢复索引密钥</button><input ref="backupPicker" type="file" accept=".json,application/json" hidden @change="importKey"/><small v-if="error&&!mode" role="alert">{{error}}</small></div>
 <Teleport to="body"><div v-if="mode" class="pc-modal-backdrop" @click.self="!busy&&close()"><form class="pc-task-dialog attachment-index-dialog" role="dialog" aria-modal="true" aria-labelledby="attachment-index-title" @submit.prevent="submit" @keydown.esc.stop.prevent="!busy&&close()">
  <h2 id="attachment-index-title">{{mode==='create'?'启用本机附件加密索引':mode==='recovery'?'保存恢复码':mode==='restore'?'恢复索引密钥':mode==='clear'?'清理索引缓存':mode==='change'?'更换索引口令':'解锁附件索引'}}</h2>
  <p>只加密本机生成的搜索索引，原始附件和笔记保持现有存储方式。口令和恢复码不会发送给服务器或 AI。</p>
  <p v-if="mode==='clear'">将清除当前账号生成的附件索引，并锁定本窗口的索引会话。原始附件、笔记及受包裹密钥会保留。重新解锁并搜索后会建立新的索引。</p>
  <template v-else-if="mode==='change'"><p>已有索引不需重新加密，恢复码保持有效。旧密钥备份仍保留原口令，请在更换后重新备份。</p><label>{{saved?'当前恢复码':'原索引口令'}}<input v-model="password" type="password" autocomplete="off" required :disabled="busy"/></label><label class="index-check"><input v-model="saved" type="checkbox" :disabled="busy"/>使用恢复码验证</label><label>新索引口令<input v-model="newPassword" type="password" autocomplete="new-password" minlength="12" required :disabled="busy"/></label><label>确认新口令<input v-model="confirmation" type="password" autocomplete="new-password" required :disabled="busy"/></label></template>
  <template v-else-if="mode==='create'"><label>索引口令<input v-model="password" type="password" autocomplete="new-password" minlength="12" required autofocus :disabled="busy"/></label><label>确认口令<input v-model="confirmation" type="password" autocomplete="new-password" required :disabled="busy"/></label></template>
  <template v-else-if="mode==='recovery'"><p>请保存恢复码，忘记口令时可用它解锁。启用后请下载索引密钥备份；恢复到新环境需要备份文件和口令或恢复码。</p><label>恢复码<textarea :value="recovery" readonly spellcheck="false" autocomplete="off" aria-label="索引恢复码"/></label><label>粘贴恢复码以核对<input v-model="recoveryCheck" type="password" autocomplete="off" :disabled="busy" required/></label><label class="index-check"><input v-model="saved" type="checkbox" :disabled="busy"/>我已另行保存恢复码</label></template>
  <template v-else><label>{{saved?'恢复码':'索引口令'}}<input v-model="password" type="password" autocomplete="off" :disabled="busy" required autofocus/></label><label class="index-check"><input v-model="saved" type="checkbox" :disabled="busy"/>使用恢复码</label></template>
  <p v-if="error" role="alert">{{error}}</p><footer><button type="button" :disabled="busy" @click="close">取消</button><button type="submit" :disabled="busy">{{busy?'正在处理…':mode==='create'?'生成恢复码':mode==='recovery'?'确认并启用':mode==='restore'?'恢复并解锁':mode==='clear'?'确认清理':mode==='change'?'确认更换':'解锁'}}</button></footer>
 </form></div></Teleport>
</template>
<style scoped>
.attachment-index-protection{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:8px 0;color:var(--pc-muted);font-size:12px}.attachment-index-protection button{border:1px solid var(--pc-border);border-radius:5px;padding:5px 9px;background:var(--pc-surface,#fff);color:var(--pc-text)}.attachment-index-dialog{width:min(460px,90vw);max-height:85vh;overflow:auto}.attachment-index-dialog h2{font-size:18px}.attachment-index-dialog p{font-size:12px;line-height:1.7;color:var(--pc-muted)}.attachment-index-dialog label{display:flex;flex-direction:column;gap:6px;margin:14px 0;font-size:12px}.attachment-index-dialog input,.attachment-index-dialog textarea{padding:8px;border:1px solid var(--pc-border);border-radius:5px;background:var(--pc-surface,#fff);color:var(--pc-text)}.attachment-index-dialog textarea{font-family:monospace;resize:none}.attachment-index-dialog .index-check{flex-direction:row;align-items:center}.attachment-index-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.attachment-index-dialog footer button{padding:7px 12px;border:1px solid var(--pc-border);border-radius:5px;background:var(--pc-surface,#fff);color:var(--pc-text)}
</style>
