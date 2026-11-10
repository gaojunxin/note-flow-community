import type { AccountProfile } from '@note-flow/core'
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { accountPasswordChecks, accountPasswordStrength, validateAccountProfile, validateAccountUsername, validateAccountPassword, validateAccountAvatar } from '@note-flow/core'
import api from '../services/api'
import { activeProfileId } from '../services/profiles'
import { getDesktopServerUrl } from '../services/serverConfig'
import { useAuthStore } from '../stores/auth'

export function useAccountEditor() {
  const auth = useAuthStore()
  // 表单属于加载它的账号、服务与本地profile；异步响应回来后也须核对，不能更新切换后的表单。
  const sessionFingerprint = () => JSON.stringify([auth.user?.userId || '', Boolean(auth.token), activeProfileId(), getDesktopServerUrl()])
  let loadedSession = ''
  function assertSession() { if (!loadedSession || loadedSession !== sessionFingerprint()) throw new Error('账号或服务已切换，请重新进入账号设置') }
  const form = reactive({ userName: '', nickName: '', email: '', phonenumber: '' })
  const saved = ref<AccountProfile>({ ...form })
  const username = ref(''), usernamePassword = ref('')
  const passwords = reactive({ oldPassword: '', newPassword: '', confirmation: '' })
  const loading = ref(false), loaded = ref(false), busy = ref(''), message = ref(''), tone = ref('info')
  const avatarPath = ref(auth.user?.avatar || ''), avatarFile = ref<File | null>(null), avatarPreview = ref('')
  const profileDirty = computed(() => (['nickName','email','phonenumber'] as const).some(key => form[key] !== saved.value[key]) || Boolean(avatarFile.value))
  const profileError = computed(() => validateAccountProfile(form))
  const usernameError = computed(() => validateAccountUsername(username.value.trim(), saved.value.userName))
  const passwordChecks = computed(() => accountPasswordChecks(passwords.oldPassword, passwords.newPassword, passwords.confirmation))
  const passwordStrength = computed(() => accountPasswordStrength(passwords.newPassword))
  const passwordError = computed(() => validateAccountPassword(passwords.oldPassword, passwords.newPassword, passwords.confirmation))
  const report = (value: string, kind = 'error') => { message.value = value; tone.value = kind }
  function clearAvatar() { if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value); avatarPreview.value = ''; avatarFile.value = null }
  function selectAvatar(event: Event) {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
    if (!file) return
    const error = validateAccountAvatar(file)
    if (error) { report(error); return }
    clearAvatar(); avatarFile.value = file; avatarPreview.value = URL.createObjectURL(file); message.value = ''
  }
  function discardProfile() { Object.assign(form, saved.value); clearAvatar(); message.value = '' }
  async function load() {
    if (!auth.token) { report('连接服务器并登录后，可以管理个人资料和账号安全'); return }
    loading.value = true; message.value = ''; const capturedSession=sessionFingerprint()
    try {
      const response = await api.get('/system/user/profile/account')
      if(capturedSession !== sessionFingerprint()) throw new Error('账号或服务已切换，请重新进入账号设置')
      loadedSession=capturedSession
      const value = response.data.data
      Object.assign(form, { userName: value.userName || '', nickName: value.nickName || '', email: value.email || '', phonenumber: value.phonenumber || '' })
      saved.value = { ...form }; username.value = form.userName; loaded.value = true
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      const status = (error as {status?:number;response?:{status?:number}} | null)?.status ?? (error as {response?:{status?:number}} | null)?.response?.status
      report(status===404 || /No static resource\s+\/?system\/user\/profile\/account\.?$/i.test(detail.trim())
        ? '当前服务器暂不支持账号资料，请更新服务器后重试'
        : detail || '资料加载失败')
    }
    finally { loading.value = false }
  }
  async function refresh(messageText: string) {
    try { await auth.fetchUser(); report(messageText, 'success') }
    catch { report(`${messageText}。账号显示暂未刷新，可重新进入此页面`, 'info') }
  }
  async function saveProfile() {
    if (!loaded.value || busy.value || !profileDirty.value) return
    if (profileError.value) { report(profileError.value); return }
    busy.value = 'profile'; message.value = ''; let profileSaved = false
    try {
      assertSession()
      if ((['nickName','email','phonenumber'] as const).some(key => form[key] !== saved.value[key])) {
        for (const key of (['nickName','email','phonenumber'] as const)) {
          if(form[key] === saved.value[key]) continue
          await api.patch('/system/user/profile/account', { field:key, value:form[key], expectedValue:saved.value[key] })
          assertSession()
          saved.value = { ...saved.value, [key]:form[key] }; profileSaved = true
        }
      }
      if (avatarFile.value) {
        assertSession()
        const data = new FormData(); data.append('avatarfile', avatarFile.value)
        const response = await api.post('/system/user/profile/avatar', data)
        assertSession()
        avatarPath.value = response.data.imgUrl || avatarPath.value
        clearAvatar()
      }
      await refresh('个人资料已保存')
    } catch (error) { report(`${profileSaved ? '资料已保存，头像未更新：' : ''}${error instanceof Error ? error.message : '保存失败'}`) }
    finally { busy.value = '' }
  }
  async function rename() {
    if (!loaded.value || busy.value) return
    if (usernameError.value || !usernamePassword.value) { report(usernameError.value || '请输入当前密码'); return }
    busy.value = 'username'; message.value = ''
    try {
      assertSession()
      await api.patch('/system/user/profile/account', { field:'userName', value:username.value.trim(), expectedValue:saved.value.userName, oldPassword:usernamePassword.value })
      assertSession()
      saved.value = { ...saved.value, userName: username.value.trim() }; form.userName = saved.value.userName; usernamePassword.value = ''
      await refresh('用户名已修改，下次登录请使用新用户名')
    } catch (error) { report(error instanceof Error ? error.message : '用户名修改失败') }
    finally { busy.value = '' }
  }
  async function changePassword() {
    if (!loaded.value || busy.value) return
    if (passwordError.value) { report(passwordError.value); return }
    busy.value = 'password'; message.value = ''
    try {
      assertSession()
      await api.put('/system/user/profile/updatePwd', { oldPassword: passwords.oldPassword, newPassword: passwords.newPassword })
      assertSession()
      Object.assign(passwords, { oldPassword: '', newPassword: '', confirmation: '' })
      report('密码已修改，下次登录请使用新密码', 'success')
    } catch (error) { report(error instanceof Error ? error.message : '密码修改失败') }
    finally { busy.value = '' }
  }
  onBeforeUnmount(clearAvatar)
  return { auth, form, saved, username, usernamePassword, passwords, loading, loaded, busy, message, tone, avatarPath, avatarPreview, profileDirty, profileError, usernameError, passwordError, passwordChecks, passwordStrength, load, saveProfile, discardProfile, selectAvatar, clearAvatar, rename, changePassword }
}
