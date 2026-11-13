<script setup lang="ts">
import {ElButton,ElDialog} from 'element-plus'
import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/el-dialog.css'
import 'element-plus/theme-chalk/el-overlay.css'
import 'element-plus/theme-chalk/el-button.css'
import {clearWorkspaceDerivedIndexes} from '../services/workspaceDerivedReset'
import {clientOwnerScope} from '../services/clientContext'

import {onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {attachmentIndexProtectionState,prepareAttachmentIndexProtection,unlockAttachmentIndexProtection,lockAttachmentIndexProtection,exportAttachmentIndexKey,restoreAttachmentIndexKey,changeAttachmentIndexPassword} from '../services/attachmentIndexProtection'
import {saveLocalExport} from '../services/localFileExport'
import {accountLifecycleRevision} from '../services/accountStorage'
import {appLock} from '../services/appLock'
// 调用方仅控制设置弹窗显隐；组件需持续挂载以监听密钥和账号失效，change 回传当前索引可用状态。
const props=defineProps<{ownerId:string;settingsOpen?:boolean}>(),emit=defineEmits<{change:[state:{configured:boolean;unlocked:boolean}];'update:settingsOpen':[value:boolean]}>()
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
 <ElDialog :model-value="settingsOpen" title="搜索设置" width="min(520px, calc(100vw - 32px))" align-center append-to-body @update:model-value="emit('update:settingsOpen',$event)">
  <template #header="{titleId}">
   <div class="settings-heading">
    <span class="settings-heading-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></svg></span>
    <div><h2 :id="titleId">搜索设置</h2><p>管理本机附件的搜索方式与索引保护</p></div>
   </div>
  </template>
  <div class="search-settings-content">
   <section class="settings-index-card">
    <div class="index-status"><h3><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2"/></svg>加密搜索索引</h3><span class="index-state" :class="{'index-state--ready':unlocked}"><i/>{{configured?(unlocked?'已解锁':'已锁定'):'未启用'}}</span></div>
    <p class="index-card-description">{{configured?(unlocked?'索引已就绪，可复用已提取的文字，加快重复搜索。':'解锁后可复用已保存的索引，也可以直接扫描本机文件。'):'保存已提取的文字，减少重复解析。无需启用，也能搜索附件正文。'}}</p>
    <div class="index-primary-actions">
     <ElButton v-if="!unlocked" type="primary" :disabled="appLock.locked.value" @click="open">{{configured?'解锁索引':'启用加密索引'}}</ElButton>
     <ElButton v-else @click="lock">锁定索引</ElButton>
     <ElButton v-if="!configured" text @click="backupPicker?.click()">恢复索引密钥</ElButton>
    </div>
    <div class="index-privacy-note"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 8 3v6c0 4-5 7-8 9-3-2-8-5-8-9V6Z"/><path d="m8 12 3 3 5-6"/></svg><span>仅保护搜索缓存，不改变原附件和笔记的存储方式。</span></div>
   </section>
   <section class="settings-toggle-row">
    <div><h3>使用加密索引加速搜索</h3><p>{{configured?'关闭后直接读取本机文件，不删除已有索引。':'启用加密索引后可使用；未启用时直接扫描文件。'}}</p></div><slot/>
   </section>
   <section v-if="configured" class="search-settings-section">
    <h3 class="settings-section-label">密钥与缓存管理</h3>
    <div class="index-maintenance-actions">
     <ElButton text @click="downloadKey">备份索引密钥</ElButton>
     <ElButton text @click="close();mode='change'">更换索引口令</ElButton>
     <ElButton text type="danger" @click="close();mode='clear'">清理索引缓存</ElButton>
    </div>
   </section>
   <input ref="backupPicker" type="file" accept=".json,application/json" hidden @change="importKey"/>
   <p v-if="error&&!mode" class="index-settings-error" role="alert">{{error}}</p>
   <section class="search-settings-section">
    <div class="settings-section-heading"><h3>支持的附件正文</h3><span>仅限本机副本</span></div>
    <dl class="index-supported-types"><div><dt><span class="index-format">TXT</span><span>文本与结构化文件<small>TXT · Markdown · CSV · JSON</small></span></dt><dd>≤ 2 MiB</dd></div><div><dt><span class="index-format">PDF</span><span>文字型 PDF</span></dt><dd>≤ 10 MiB / 100 页</dd></div><div><dt><span class="index-format">DOCX</span><span>Word 文档</span></dt><dd>≤ 10 MiB</dd></div></dl>
    <p class="index-support-note">在“附件”标签中主动搜索，不自动下载远端文件。暂不支持图片 OCR、扫描型 PDF 识别与旧版 DOC。</p>
   </section>
  </div>
  <template #footer><div class="settings-footer"><span>设置即时生效</span><ElButton @click="emit('update:settingsOpen',false)">完成</ElButton></div></template>
 </ElDialog>
 <ElDialog :model-value="Boolean(mode)" :title="mode==='create'?'启用本机附件加密索引':mode==='recovery'?'保存恢复码':mode==='restore'?'恢复索引密钥':mode==='clear'?'清理索引缓存':mode==='change'?'更换索引口令':'解锁附件索引'" width="min(460px, calc(100vw - 32px))" append-to-body :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="value=>{if(!value&&!busy)close()}">
 <form class="attachment-index-dialog" @submit.prevent="submit">

  <p>只加密本机生成的搜索索引，原始附件和笔记保持现有存储方式。口令和恢复码不会发送给服务器或 AI。</p>
  <p v-if="mode==='clear'">将清除当前账号生成的附件索引，并锁定本窗口的索引会话。原始附件、笔记及受包裹密钥会保留。重新解锁并搜索后会建立新的索引。</p>
  <template v-else-if="mode==='change'"><p>已有索引不需重新加密，恢复码保持有效。旧密钥备份仍保留原口令，请在更换后重新备份。</p><label>{{saved?'当前恢复码':'原索引口令'}}<input v-model="password" type="password" autocomplete="off" required :disabled="busy"/></label><label class="index-check"><input v-model="saved" type="checkbox" :disabled="busy"/>使用恢复码验证</label><label>新索引口令<input v-model="newPassword" type="password" autocomplete="new-password" minlength="12" required :disabled="busy"/></label><label>确认新口令<input v-model="confirmation" type="password" autocomplete="new-password" required :disabled="busy"/></label></template>
  <template v-else-if="mode==='create'"><label>索引口令<input v-model="password" type="password" autocomplete="new-password" minlength="12" required autofocus :disabled="busy"/></label><label>确认口令<input v-model="confirmation" type="password" autocomplete="new-password" required :disabled="busy"/></label></template>
  <template v-else-if="mode==='recovery'"><p>请保存恢复码，忘记口令时可用它解锁。启用后请下载索引密钥备份；恢复到新环境需要备份文件和口令或恢复码。</p><label>恢复码<textarea :value="recovery" readonly spellcheck="false" autocomplete="off" aria-label="索引恢复码"/></label><label>粘贴恢复码以核对<input v-model="recoveryCheck" type="password" autocomplete="off" :disabled="busy" required/></label><label class="index-check"><input v-model="saved" type="checkbox" :disabled="busy"/>我已另行保存恢复码</label></template>
  <template v-else><label>{{saved?'恢复码':'索引口令'}}<input v-model="password" type="password" autocomplete="off" :disabled="busy" required autofocus/></label><label class="index-check"><input v-model="saved" type="checkbox" :disabled="busy"/>使用恢复码</label></template>
  <p v-if="error" role="alert">{{error}}</p><footer><button class="pc-action pc-action--secondary" type="button" :disabled="busy" @click="close">取消</button><button class="pc-action pc-action--secondary" type="submit" :disabled="busy">{{busy?'正在处理…':mode==='create'?'生成恢复码':mode==='recovery'?'确认并启用':mode==='restore'?'恢复并解锁':mode==='clear'?'确认清理':mode==='change'?'确认更换':'解锁'}}</button></footer>
 </form></ElDialog>
</template>
<style scoped>
.settings-heading{display:flex;align-items:center;gap:12px;padding:4px 24px 8px 4px}
.settings-heading-icon{display:grid;place-items:center;flex:none;width:42px;height:42px;border-radius:12px;background:var(--pc-primary-soft);color:var(--pc-primary)}
.settings-heading-icon svg{width:22px;height:22px}
.settings-heading h2{margin:0;font-size:18px;font-weight:600;color:var(--pc-text)}
.settings-heading p{margin:5px 0 0;font-size:12px;line-height:1.5;color:var(--pc-muted)}
.search-settings-content{display:grid;gap:20px;max-height:calc(100dvh - 240px);overflow-y:auto;padding:4px;color:var(--pc-text)}
.search-settings-content h3{margin:0;font-size:13px;font-weight:600}
.settings-index-card{padding:18px;border:1px solid var(--pc-border);border-radius:12px;background:var(--pc-primary-soft)}
.index-status{display:flex;align-items:center;justify-content:space-between;gap:12px}
.index-status h3{display:flex;align-items:center;gap:8px;font-size:14px}
.index-status h3 svg{width:18px;height:18px;color:var(--pc-primary)}
.index-state{display:inline-flex;align-items:center;gap:5px;flex:none;padding:3px 8px;border:1px solid var(--pc-border);border-radius:12px;background:var(--pc-surface);color:var(--pc-muted);font-size:11px}
.index-state i{width:5px;height:5px;border-radius:50%;background:currentColor}
.index-state--ready{color:var(--pc-primary)}
.index-card-description{margin:12px 0 16px;font-size:12px;line-height:1.8;color:var(--pc-muted)}
.index-primary-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.index-primary-actions>.el-button+.el-button,.index-maintenance-actions>.el-button+.el-button{margin-left:0}
.index-privacy-note{display:flex;align-items:flex-start;gap:6px;margin-top:16px;padding-top:12px;border-top:1px solid var(--pc-border);color:var(--pc-muted);font-size:11px;line-height:1.7}
.index-privacy-note svg{flex:none;width:14px;height:14px;margin-top:2px}
.settings-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 2px 20px;border-bottom:1px solid var(--pc-border)}
.settings-toggle-row>div{min-width:0}
.settings-toggle-row p{margin:6px 0 0;font-size:12px;line-height:1.7;color:var(--pc-muted)}
.search-settings-section{min-width:0}
.settings-section-label{color:var(--pc-muted)}
.index-maintenance-actions{display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:8px}
.index-maintenance-actions>.el-button{padding-left:0;padding-right:8px;font-size:12px}
.settings-section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}
.settings-section-heading>span{font-size:11px;color:var(--pc-muted)}
.index-supported-types{margin:12px 0 0;font-size:12px}
.index-supported-types>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--pc-border)}
.index-supported-types>div:last-child{border-bottom:0}
.index-supported-types dt{display:flex;align-items:center;gap:10px;min-width:0}
.index-supported-types dt small{display:block;margin-top:4px;font-size:10px;color:var(--pc-muted)}
.index-format{display:grid;place-items:center;flex:none;width:40px;height:32px;border:1px solid var(--pc-border);border-radius:7px;background:var(--pc-surface);font-size:9px;font-weight:600;color:var(--pc-muted)}
.index-supported-types dd{flex:none;margin:0;font-size:11px;color:var(--pc-muted);white-space:nowrap}
.index-support-note{margin:10px 0 0;font-size:11px;line-height:1.8;color:var(--pc-muted)}
.index-settings-error{margin:0;color:var(--pc-danger);font-size:12px}
.settings-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 4px 0;border-top:1px solid var(--pc-border)}
.settings-footer>span{font-size:11px;color:var(--pc-muted)}
@media(max-width:480px){.settings-heading p{font-size:11px}.settings-index-card{padding:14px}.index-supported-types>div{gap:8px}.index-supported-types dd{font-size:10px}.index-format{width:32px}.index-supported-types dt{gap:6px}.index-status h3{font-size:13px}.settings-heading-icon{width:36px;height:36px}}
.attachment-index-dialog{max-height:70vh;overflow:auto}
.attachment-index-dialog input,.attachment-index-dialog textarea{box-sizing:border-box;width:100%}
.attachment-index-dialog .index-check input{width:16px;height:16px;flex:none;margin:0}
.attachment-index-dialog h2{font-size:18px}.attachment-index-dialog p{font-size:12px;line-height:1.7;color:var(--pc-muted)}.attachment-index-dialog label{display:flex;flex-direction:column;gap:6px;margin:14px 0;font-size:12px}.attachment-index-dialog input,.attachment-index-dialog textarea{padding:8px;border:1px solid var(--pc-border);border-radius:5px;background:var(--pc-surface,#fff);color:var(--pc-text)}.attachment-index-dialog textarea{font-family:monospace;resize:none}.attachment-index-dialog .index-check{flex-direction:row;align-items:center}.attachment-index-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.attachment-index-dialog footer button{padding:7px 12px;border:1px solid var(--pc-border);border-radius:5px;background:var(--pc-surface,#fff);color:var(--pc-text)}
</style>
