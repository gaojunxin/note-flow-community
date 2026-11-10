<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../services/api'
import { DESKTOP_SERVER_KEY, getDesktopServerUrl, isDesktopClient, setDesktopServerUrl } from '../services/serverConfig'
import { useAuthStore } from '../stores/auth'
import { useNotesStore } from '../stores/notes'

import { currentProfile } from '../services/profiles'
import { pausePcSync } from '../services/syncResetGuard'

const migrateServer = ref(false)
const originalBinding = currentProfile()?.serverBinding
const migrationAvailable = computed(() => desktop && Boolean(originalBinding) && serverUrl.value.replace(/\/+$/, '') !== originalBinding?.serverUrl)

const username = ref('')
const password = ref('')
const captchaEnabled = ref(false)
const captchaCode = ref('')
const captchaUuid = ref('')
const captchaImage = ref('')
const loadingCaptcha = ref(false)
const submitting = ref(false)
const error = ref('')
const desktop = isDesktopClient()
const serverUrl = ref(getDesktopServerUrl())
const connectedServer = ref('')
const auth = useAuthStore()
const notes = useNotesStore()
const route = useRoute()
const router = useRouter()

async function loadCaptcha() {
  if (desktop && !getDesktopServerUrl()) return false
  if (loadingCaptcha.value) return
  loadingCaptcha.value = true
  try {
    const { data: result } = await api.get<{ captchaEnabled?: boolean; uuid?: string; img?: string }>('/captchaImage')
    captchaEnabled.value = Boolean(result.captchaEnabled)
    captchaUuid.value = result.uuid || ''
    captchaImage.value = result.img ? `data:image/png;base64,${result.img}` : ''
    captchaCode.value = ''
    error.value = ''
    return true
  } catch (source) {
    captchaEnabled.value = false
    error.value = source instanceof Error ? source.message : '验证码加载失败'
    return false
  } finally { loadingCaptcha.value = false }
}

async function connectServer() {
  const resume = await pausePcSync()
  try {
    const previous = getDesktopServerUrl()
    const saved = setDesktopServerUrl(serverUrl.value)
    serverUrl.value = saved
    if (previous && previous !== saved) auth.clearSession()
    const reachable = await loadCaptcha()
    connectedServer.value = reachable ? saved : ''
    return reachable
  } finally { resume() }
}

async function connectFromButton() {
  error.value = ''
  try { await connectServer() }
  catch (source) { error.value = source instanceof Error ? source.message : '服务器连接失败' }
}

async function submit() {
  if (submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    if (desktop && serverUrl.value !== connectedServer.value) {
      if (!await connectServer()) return
      if (captchaEnabled.value) throw new Error('服务器已连接，请填写验证码后登录')
    }
    await auth.login({ username: username.value.trim(), password: password.value, ...(captchaEnabled.value ? { code: captchaCode.value.trim(), uuid: captchaUuid.value } : {}) }, { migrateServer: migrationAvailable.value && migrateServer.value })
    if(desktop){localStorage.setItem('note-flow-pc-sync-enabled','true');window.dispatchEvent(new Event('note-flow:sync-preference'));await notes.runSync().catch(()=>undefined)}
    const preferred = route.query.connect==='1'?'/settings':localStorage.getItem('note-flow-pc-start-page') || '/home'
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : preferred
    await router.replace(redirect)
  } catch (source) {
    error.value = source instanceof Error ? source.message : '登录失败'
    if (captchaEnabled.value) await loadCaptcha()
  } finally { submitting.value = false }
}

onMounted(async() => { if (!desktop) await loadCaptcha();else if (localStorage.getItem(DESKTOP_SERVER_KEY)) connectedServer.value=await loadCaptcha()?serverUrl.value:'' })
</script>

<template>
  <main class="pc-login-page">
    <section class="pc-login-intro">
      <img class="pc-login-mark" src="/ji-yu-icon.png" alt="迹语" />
      <small>JIYU · 迹语</small>
      <h1>让想法留下轨迹</h1>
      <p>在笔记、任务与专注之间，建立属于你的安静工作空间。</p>
    </section>
    <div class="pc-login-panel">
    <form class="pc-login-card" @submit.prevent="submit">
      <div><small>{{desktop?'可选同步':'欢迎回来'}}</small><h2>{{desktop?'连接迹语服务':'登录迹语'}}</h2><p>{{desktop?'本地数据会保留，并在连接后安全同步':'使用你的私有部署账号继续'}}</p></div>
      <label v-if="desktop"><span>服务器地址</span><div class="pc-server-field"><input v-model="serverUrl" type="url" autocomplete="url" placeholder="例如 https://sync.example.com" required /><button type="button" :disabled="loadingCaptcha" @click="connectFromButton">连接</button></div></label>
      <label v-if="migrationAvailable"><span>服务器迁移</span><div><input v-model="migrateServer" type="checkbox" /> 原数据库已迁移，保留当前本地空间</div><small>原地址：{{ originalBinding?.serverUrl }}。登录后核对原账号和同步世代，保留本地数据与待同步更改。</small></label>
      <label><span>账号</span><input v-model="username" autocomplete="username" placeholder="请输入账号" required autofocus /></label>
      <label><span>密码</span><input v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" required /></label>
      <label v-if="captchaEnabled"><span>验证码</span><div class="pc-captcha"><input v-model="captchaCode" autocomplete="off" placeholder="请输入验证码" required /><button type="button" :disabled="loadingCaptcha" @click="loadCaptcha"><img v-if="captchaImage" :src="captchaImage" alt="刷新验证码" /><span v-else>刷新</span></button></div></label>
      <button class="pc-login-submit" :disabled="submitting">{{ submitting ? '正在登录…' : '进入工作台' }}</button>
      <p v-if="error" class="pc-login-error" role="alert">{{ error }}</p>
      <small class="pc-login-footnote">{{desktop ? (connectedServer ? `客户端连接：${connectedServer}` : '请先连接你的迹语服务器') : '当前网页由同源迹语服务安全连接'}}</small>
    </form>
    <div v-if="desktop" class="pc-local-entry">
      <button type="button" @click="router.replace('/home')">暂不登录，仅在本机使用 <span aria-hidden="true">→</span></button>
      <small>之后可在设置中连接服务器并同步</small>
    </div>
    </div>
  </main>
</template>

<style scoped>
.pc-login-panel{align-self:center;width:min(420px,calc(100% - 80px));margin:auto;padding:32px 0}
.pc-login-panel .pc-login-card{width:100%;margin:0}
.pc-local-entry{display:grid;justify-items:center;gap:7px;margin-top:18px;text-align:center}
.pc-local-entry button{min-height:44px;padding:8px 16px;border:0;border-radius:8px;background:transparent;color:var(--pc-primary);font-size:13px;font-weight:550;cursor:pointer}
.pc-local-entry button:hover{background:rgba(79,151,113,.09)}
.pc-local-entry button:focus-visible{outline:2px solid var(--pc-primary);outline-offset:3px}
.pc-local-entry button span{margin-left:5px}
.pc-local-entry small{color:var(--pc-muted);font-size:11px;line-height:1.6}
</style>
