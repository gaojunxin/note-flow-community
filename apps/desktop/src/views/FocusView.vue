<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {ElButton} from 'element-plus'
import {useRouter} from 'vue-router'
import {focusTimer,prepareFocusTimer} from '../services/focusTimer'
import {isDesktopClient} from '../services/serverConfig'
import {appLock} from '../services/appLock'
const router=useRouter(),surface=ref<HTMLElement>(),fullscreen=ref(false),loading=ref(true),ready=ref(false),error=ref('')
const label=computed(()=>({focus:'专注',short_break:'短休息',long_break:'长休息'}[focusTimer.session?.sessionType||focusTimer.kind]||'专注'))
const time=computed(()=>{const seconds=focusTimer.remainingSeconds;return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`})
async function prepare(){loading.value=true;error.value='';try{await prepareFocusTimer();ready.value=true}catch(value){ready.value=false;error.value=value instanceof Error?value.message:'无法读取专注设置'}finally{loading.value=false}}
function applyFullscreen(value:boolean){fullscreen.value=value;document.body.classList.toggle('focus-immersive',value)}
async function setFullscreen(value:boolean){
 try{if(isDesktopClient()){const {getCurrentWindow}=await import('@tauri-apps/api/window');await getCurrentWindow().setFullscreen(value);applyFullscreen(value)}else if(value){await surface.value!.requestFullscreen();applyFullscreen(true)}else{if(document.fullscreenElement)await document.exitFullscreen();applyFullscreen(false)}}catch{error.value=value?'无法进入全屏，请重试。':'无法退出全屏，请使用 Esc 或系统全屏按钮。'}
}
function fullscreenChanged(){if(!isDesktopClient())applyFullscreen(document.fullscreenElement===surface.value)}
function keydown(event:KeyboardEvent){if(event.key==='Escape'&&fullscreen.value){event.preventDefault();void setFullscreen(false)}else if(event.key==='F11'){event.preventDefault();void setFullscreen(!fullscreen.value)}}
watch(appLock.locked,locked=>{if(locked&&fullscreen.value)void setFullscreen(false)})
onMounted(()=>{void prepare();document.addEventListener('fullscreenchange',fullscreenChanged);window.addEventListener('keydown',keydown)})
onBeforeUnmount(()=>{document.removeEventListener('fullscreenchange',fullscreenChanged);window.removeEventListener('keydown',keydown);if(fullscreen.value)void setFullscreen(false);document.body.classList.remove('focus-immersive')})
</script>
<template><main ref="surface" class="focus-page" :class="{'is-fullscreen':fullscreen}">
 <header v-if="!fullscreen" class="focus-page-header"><h1>专注</h1><ElButton text @click="router.push({path:'/focus/records',query:router.currentRoute.value.query})">记录与选项</ElButton></header>
 <section class="focus-center" aria-label="专注计时"><p class="focus-phase">{{label}}{{focusTimer.session&&!focusTimer.running?' · 已暂停':''}}</p><output class="focus-clock" role="timer" aria-live="off" :aria-label="`剩余 ${time}`">{{time}}</output>
 <div class="focus-actions"><ElButton type="primary" :disabled="focusTimer.saving||focusTimer.pending||(!focusTimer.session&&(loading||!ready))" @click="focusTimer.toggle()">{{focusTimer.running?'暂停':focusTimer.session?'继续':'开始专注'}}</ElButton><ElButton v-if="focusTimer.session" :loading="focusTimer.saving" @click="focusTimer.finish()">{{focusTimer.pending?'重试保存':'完成'}}</ElButton></div>
 <p v-if="error||focusTimer.error" class="focus-error" role="alert">{{error||focusTimer.error}} <ElButton v-if="error" text @click="prepare">重试</ElButton></p>
 </section><footer class="focus-page-footer"><ElButton text @click="setFullscreen(!fullscreen)">{{fullscreen?'退出全屏 · Esc':'全屏专注'}}</ElButton></footer>
</main></template>
<style scoped>
.focus-page{box-sizing:border-box;min-height:calc(100dvh - 110px);display:flex;flex-direction:column;background:var(--pc-bg,#f5f7f4);color:var(--pc-text);padding:20px 28px}.focus-page-header{display:flex;align-items:center;justify-content:space-between}.focus-page-header h1{margin:0;font-size:16px;font-weight:600}.focus-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:360px;padding:48px 0}.focus-phase{font-size:14px;color:var(--pc-muted);margin:0 0 24px}.focus-clock{font-family:ui-sans-serif,system-ui,sans-serif;font-size:clamp(72px,11vw,128px);font-variant-numeric:tabular-nums;font-weight:600;letter-spacing:.02em;line-height:1.15;color:var(--pc-primary)}.focus-actions{display:flex;gap:12px;margin-top:36px}.focus-actions :deep(.el-button+.el-button){margin-left:0}.focus-page-footer{display:flex;justify-content:flex-end}.focus-error{max-width:520px;color:var(--pc-danger,#b34747);font-size:12px;text-align:center}.focus-page.is-fullscreen,.focus-page:fullscreen{position:fixed;inset:0;z-index:2000;min-height:100dvh;padding:28px 36px}.is-fullscreen .focus-clock{font-size:clamp(96px,15vw,200px)}
</style>
<style>
body.focus-immersive .pc-sidebar,body.focus-immersive .pc-topbar,body.focus-immersive .network-banner{display:none!important}body.focus-immersive .pc-app-shell{grid-template-columns:1fr!important}body.focus-immersive .pc-workspace{margin:0!important;padding:0!important}
</style>
