<script setup lang="ts">
import {ref,watch} from 'vue'
import {appLock,APP_LOCK_IDLE_OPTIONS,type AppLockRecord} from '../services/appLock'
const pin=ref(''),confirmation=ref(''),current=ref(''),acknowledged=ref(false),busy=ref(false),error=ref(''),message=ref('')
const prepared=ref<{record:AppLockRecord;recoveryCode:string}|null>(null)
const enabled=appLock.enabled,config=appLock.config
async function run(action:()=>Promise<void>|void){busy.value=true;error.value='';message.value='';try{await action()}catch(source){error.value=source instanceof Error?source.message:'软件锁设置失败'}finally{busy.value=false}}
async function prepare(){await run(async()=>{if(pin.value!==confirmation.value)throw Error('两次 PIN 不一致');prepared.value=await appLock.prepare(pin.value);pin.value='';confirmation.value=''})}
function enable(){void run(()=>{if(!prepared.value||!acknowledged.value)return;appLock.enable(prepared.value.record);prepared.value=null;acknowledged.value=false;message.value='软件锁已启用，下次启动需要解锁'})}
async function change(){await run(async()=>{if(pin.value!==confirmation.value)throw Error('两次 PIN 不一致');await appLock.changePin(current.value,pin.value);current.value='';pin.value='';confirmation.value='';message.value='PIN 已更新，原恢复码仍有效'})}
async function disable(){await run(async()=>{await appLock.disable(current.value);current.value='';message.value='软件锁已关闭'})}
watch(appLock.locked,locked=>{if(locked){pin.value='';confirmation.value='';current.value='';prepared.value=null;acknowledged.value=false;error.value='';message.value=''}})
</script>
<template>
 <section class="app-lock-settings" aria-labelledby="app-lock-settings-title"><header><div><h2 id="app-lock-settings-title">软件锁</h2><p>保护整个窗口的内容显示。当前客户端独立设置，PIN 在本机校验；保险箱继续使用独立主密码加密。</p></div><span>{{enabled?'已启用':'未启用'}}</span></header>
 <template v-if="!enabled">
  <div v-if="!prepared" class="app-lock-fields"><label>设置 PIN<input v-model="pin" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password" placeholder="6 至 12 位数字" :disabled="busy"></label><label>确认 PIN<input v-model="confirmation" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password" :disabled="busy"></label><button :disabled="busy||!pin||!confirmation" @click="prepare">{{busy?'准备中…':'设置软件锁'}}</button></div>
  <div v-else class="app-lock-recovery"><strong>保存恢复码</strong><p>恢复码仅在这次设置中显示。忘记 PIN 时可用它解锁，请保存在应用外。</p><code>{{prepared.recoveryCode}}</code><label><input v-model="acknowledged" type="checkbox">已将恢复码保存到应用外</label><button :disabled="busy||!acknowledged" @click="enable">启用软件锁</button><button :disabled="busy" @click="prepared=null;acknowledged=false">取消</button></div>
 </template>
 <template v-else-if="config">
  <div class="app-lock-policy"><label>闲置后锁定<select aria-label="闲置后锁定" :value="config.idleMinutes" @change="appLock.policy(Number(($event.target as HTMLSelectElement).value),config.lockOnBackground)"><option v-for="minutes in APP_LOCK_IDLE_OPTIONS" :key="minutes" :value="minutes">{{minutes?`${minutes} 分钟`:'仅手动锁定'}}</option></select></label><label><input type="checkbox" :checked="config.lockOnBackground" @change="appLock.policy(config.idleMinutes,($event.target as HTMLInputElement).checked)">切换到后台时锁定</label><button @click="appLock.lock()">立即锁定软件</button></div>
  <details><summary>修改 PIN 或关闭软件锁</summary><div class="app-lock-fields"><label>当前 PIN<input v-model="current" type="password" inputmode="numeric" maxlength="12" autocomplete="off" :disabled="busy"></label><label>新 PIN<input v-model="pin" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password" :disabled="busy"></label><label>确认新 PIN<input v-model="confirmation" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password" :disabled="busy"></label><button :disabled="busy||!current||!pin||!confirmation" @click="change">更新 PIN</button><button :disabled="busy||!current" @click="disable">关闭软件锁</button></div></details>
 </template>
 <p v-if="error" role="alert" class="app-lock-error">{{error}}</p><p v-if="message" role="status">{{message}}</p>
 </section>
</template>
<style scoped>
.app-lock-settings{padding:20px 0;border-bottom:1px solid var(--pc-border)}header{display:flex;align-items:start;justify-content:space-between;gap:16px}h2{margin:0;font-size:15px}p{font-size:12px;color:var(--pc-muted);line-height:1.7}header>span{font-size:12px;white-space:nowrap;color:var(--pc-muted)}.app-lock-fields,.app-lock-policy{display:flex;flex-wrap:wrap;align-items:end;gap:12px;margin:14px 0}label{display:flex;flex-direction:column;gap:6px;font-size:12px}.app-lock-policy label:has(input[type=checkbox]),.app-lock-recovery label{flex-direction:row;align-items:center}input:not([type=checkbox]),select{max-width:210px;padding:8px;border:1px solid var(--pc-border);border-radius:7px;background:var(--pc-surface,#fff);color:inherit}button{padding:8px 12px;border:1px solid var(--pc-border);border-radius:7px;background:var(--pc-surface,#fff);color:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}summary{font-size:12px;cursor:pointer}.app-lock-recovery code{display:block;overflow-wrap:anywhere;padding:14px;background:var(--pc-primary-soft);border-radius:8px;margin:10px 0;user-select:all}.app-lock-recovery label{margin:14px 0}.app-lock-recovery button{margin-right:8px}.app-lock-error{color:#b42318}
</style>
