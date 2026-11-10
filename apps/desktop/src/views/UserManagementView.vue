<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { userAdminService, type ManagedRole, type ManagedUser, type ManagedUserDetail } from '../services/userAdmin'
import { repairMojibake } from '../utils/textEncoding'

const props=defineProps<{embedded?:boolean}>()
const router = useRouter()
const auth = useAuthStore()
const users = ref<ManagedUser[]>([])
const roles = ref<ManagedRole[]>([])
const query = ref('')
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const error = ref('')
const dialog = ref<'create' | 'edit' | 'reset' | null>(null)
const resetTarget = ref<ManagedUser | null>(null)
const createDraft = reactive({ userName: '', nickName: '', email: '', password: '', roleId: 0 })
const editDraft = ref<ManagedUserDetail | null>(null)
const resetPassword = ref('')

const visibleUsers = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return users.value
  return users.value.filter(user => `${user.userName} ${displayName(user)} ${user.email || ''}`.toLowerCase().includes(needle))
})

function displayName(user: ManagedUser) {
  return repairMojibake(user.nickName || user.userName)
}

function roleNames(user: ManagedUser) {
  return user.roles?.map(role => roleLabel(role)).join('、') || '未分配角色'
}

function roleLabel(role: ManagedRole) {
  return repairMojibake(role.roleName || role.roleKey)
}

function canOperate(user: ManagedUser) {
  return String(user.userId) !== auth.user?.userId && user.userId !== 1
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [result, availableRoles] = await Promise.all([userAdminService.list(), userAdminService.roles()])
    users.value = result.rows
    roles.value = availableRoles
    if (!createDraft.roleId) createDraft.roleId = availableRoles.find(role => role.roleKey !== 'admin')?.roleId ?? availableRoles[0]?.roleId ?? 0
    const details = await Promise.allSettled(result.rows.map(user => userAdminService.detail(user.userId)))
    users.value = result.rows.map((user, index) => {
      const detail = details[index]
      return detail.status === 'fulfilled' ? { ...user, roles: detail.value.user.roles } : user
    })
  } catch (source) {
    error.value = source instanceof Error ? source.message : '用户列表加载失败'
  } finally { loading.value = false }
}

function openCreate() {
  Object.assign(createDraft, { userName: '', nickName: '', email: '', password: '', roleId: roles.value.find(role => role.roleKey !== 'admin')?.roleId ?? roles.value[0]?.roleId ?? 0 })
  message.value = ''
  error.value = ''
  dialog.value = 'create'
}

function openReset(user: ManagedUser) {
  resetTarget.value = user
  resetPassword.value = ''
  message.value = ''
  error.value = ''
  dialog.value = 'reset'
}

async function openEdit(user: ManagedUser) {
  if (!canOperate(user)) return
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await userAdminService.detail(user.userId)
    editDraft.value = { ...result.user, nickName: repairMojibake(result.user.nickName || result.user.userName) }
    if (result.roles.length) roles.value = result.roles
    dialog.value = 'edit'
  } catch (source) { error.value = source instanceof Error ? source.message : '用户详情加载失败' }
  finally { saving.value = false }
}

async function createUser() {
  if (!createDraft.userName.trim() || !createDraft.nickName.trim() || createDraft.password.length < 8 || !createDraft.roleId) return
  saving.value = true
  error.value = ''
  try {
    await userAdminService.create({
      userName: createDraft.userName.trim(),
      nickName: createDraft.nickName.trim(),
      email: createDraft.email.trim() || undefined,
      password: createDraft.password,
      roleIds: [createDraft.roleId]
    })
    dialog.value = null
    message.value = `用户 ${createDraft.userName.trim()} 已创建`
    await load()
  } catch (source) { error.value = source instanceof Error ? source.message : '创建用户失败' }
  finally { saving.value = false }
}

async function changeStatus(user: ManagedUser) {
  if (!canOperate(user)) return
  const next = user.status === '0' ? '1' : '0'
  error.value = ''
  message.value = ''
  try {
    await userAdminService.changeStatus(user.userId, next)
    user.status = next
    message.value = `${displayName(user)} 已${next === '0' ? '启用' : '停用'}`
  } catch (source) { error.value = source instanceof Error ? source.message : '账号状态修改失败' }
}

async function updateUser() {
  if (!editDraft.value || !editDraft.value.nickName.trim() || !editDraft.value.roleIds.length) return
  saving.value = true
  error.value = ''
  try {
    editDraft.value.nickName = editDraft.value.nickName.trim()
    editDraft.value.email = editDraft.value.email?.trim() || ''
    editDraft.value.phonenumber = editDraft.value.phonenumber?.trim() || ''
    await userAdminService.update(editDraft.value)
    message.value = `${editDraft.value.nickName} 的资料已更新`
    dialog.value = null
    await load()
  } catch (source) { error.value = source instanceof Error ? source.message : '用户资料更新失败' }
  finally { saving.value = false }
}

async function submitReset() {
  if (!resetTarget.value || resetPassword.value.length < 8) return
  saving.value = true
  error.value = ''
  try {
    await userAdminService.resetPassword(resetTarget.value.userId, resetPassword.value)
    message.value = `${displayName(resetTarget.value)} 的临时密码已更新`
    dialog.value = null
    resetPassword.value = ''
  } catch (source) { error.value = source instanceof Error ? source.message : '密码重置失败' }
  finally { saving.value = false }
}

import {confirmDialog} from '../services/productDialog'
async function requestLeave(){if(saving.value)return false;if(!dialog.value)return true;return confirmDialog({title:'离开用户管理？',message:'当前表单尚未提交，离开将放弃本次输入。',confirmText:'离开',cancelText:'继续编辑'})}
defineExpose({requestLeave})
onMounted(load)
</script>

<template>
  <div class="user-admin-page" :class="{page:!props.embedded,embedded:props.embedded}">
    <header class="user-admin-head">
      <button v-if="!props.embedded" class="back-button" @click="router.push('/settings')">← 返回设置</button>
      <div><h1>用户管理</h1><p>管理服务器账号、角色和登录权限。</p></div>
      <button class="primary-action" :disabled="!roles.length" @click="openCreate">＋ 新增用户</button>
    </header>

    <section class="surface user-admin-panel">
      <div class="user-admin-tools"><label>⌕<input v-model="query" placeholder="搜索用户名、姓名或邮箱"></label><small>账号离职请停用，暂不支持删除</small><span>共 {{users.length}} 个用户</span><button :disabled="loading" @click="load">{{loading?'刷新中…':'刷新'}}</button></div>
      <p v-if="message" class="user-admin-message">{{message}}</p>
      <p v-if="error" class="user-admin-message error">{{error}}</p>
      <p v-if="loading&&!users.length" class="user-admin-empty">正在加载用户…</p>
      <p v-else-if="!visibleUsers.length" class="user-admin-empty">{{query?'没有匹配的用户':'还没有用户'}}</p>
      <div v-else class="user-admin-table">
        <div class="user-admin-row table-head"><span>用户</span><span>角色</span><span>状态</span><span>创建时间</span><span>操作</span></div>
        <article v-for="user in visibleUsers" :key="user.userId" class="user-admin-row">
          <span class="user-identity"><i>{{Array.from(displayName(user))[0]}}</i><b>{{displayName(user)}}<small>{{user.userName}}{{user.email?` · ${user.email}`:''}}</small></b></span>
          <span>{{roleNames(user)}}</span><span><em :class="{disabled:user.status==='1'}">{{user.status==='0'?'正常':'已停用'}}</em></span><time>{{user.createTime||'—'}}</time>
          <span class="user-actions"><button :disabled="!canOperate(user)" @click="openEdit(user)">编辑</button><button :disabled="!canOperate(user)" @click="openReset(user)">重置密码</button><button :class="{danger:user.status==='0'}" :disabled="!canOperate(user)" @click="changeStatus(user)">{{user.status==='0'?'停用':'启用'}}</button></span>
        </article>
      </div>
    </section>

    <div v-if="dialog" class="pc-modal-backdrop" @click.self="!saving&&(dialog=null)">
      <form v-if="dialog==='create'" class="pc-task-dialog user-admin-dialog" @submit.prevent="createUser">
        <div class="section-heading"><div><h2>新增用户</h2><p>创建后即可使用该账号连接同步服务</p></div><button type="button" :disabled="saving" @click="dialog=null">×</button></div>
        <div class="dialog-grid"><label>登录用户名<input v-model="createDraft.userName" autofocus maxlength="30" autocomplete="off" required></label><label>显示名称<input v-model="createDraft.nickName" maxlength="30" required></label><label>邮箱（可选）<input v-model="createDraft.email" type="email" maxlength="50"></label><label>角色<select v-model.number="createDraft.roleId" required><option v-for="role in roles" :key="role.roleId" :value="role.roleId">{{roleLabel(role)}}</option></select></label></div>
        <label>临时密码<input v-model="createDraft.password" type="password" minlength="8" maxlength="20" autocomplete="new-password" required><small>8–20 位，请通过安全渠道交给用户</small></label>
        <p v-if="error" class="user-admin-message error">{{error}}</p><div class="dialog-actions"><button type="button" :disabled="saving" @click="dialog=null">取消</button><button class="primary-action" :disabled="saving||createDraft.password.length<8||!createDraft.roleId">{{saving?'创建中…':'创建用户'}}</button></div>
      </form>
      <form v-else-if="dialog==='edit'&&editDraft" class="pc-task-dialog user-admin-dialog" @submit.prevent="updateUser">
        <div class="section-heading"><div><h2>编辑用户</h2><p>登录用户名不可修改，高级权限请在 Web 管理端配置</p></div><button type="button" :disabled="saving" @click="dialog=null">×</button></div>
        <div class="dialog-grid"><label>登录用户名<input :value="editDraft.userName" disabled></label><label>显示名称<input v-model="editDraft.nickName" autofocus maxlength="30" required></label><label>邮箱<input v-model="editDraft.email" type="email" maxlength="50"></label><label>手机号<input v-model="editDraft.phonenumber" maxlength="11"></label></div>
        <label>角色<select v-model.number="editDraft.roleIds[0]" required><option v-for="role in roles" :key="role.roleId" :value="role.roleId">{{roleLabel(role)}}</option></select><small>PC 端日常管理暂支持一个主角色</small></label>
        <p v-if="error" class="user-admin-message error">{{error}}</p><div class="dialog-actions"><button type="button" :disabled="saving" @click="dialog=null">取消</button><button class="primary-action" :disabled="saving||!editDraft.nickName.trim()||!editDraft.roleIds.length">{{saving?'保存中…':'保存修改'}}</button></div>
      </form>
      <form v-else class="pc-task-dialog user-admin-dialog" @submit.prevent="submitReset">
        <div class="section-heading"><div><h2>重置密码</h2><p>为 {{resetTarget?displayName(resetTarget):''}} 设置新的临时密码</p></div><button type="button" :disabled="saving" @click="dialog=null">×</button></div>
        <label>新临时密码<input v-model="resetPassword" type="password" minlength="8" maxlength="20" autocomplete="new-password" autofocus required><small>8–20 位，界面不会保存或再次显示密码</small></label>
        <p v-if="error" class="user-admin-message error">{{error}}</p><div class="dialog-actions"><button type="button" :disabled="saving" @click="dialog=null">取消</button><button class="primary-action" :disabled="saving||resetPassword.length<8">{{saving?'保存中…':'更新密码'}}</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.user-admin-head{display:flex!important;justify-content:space-between;align-items:center!important;margin-bottom:10px!important}.user-admin-head .back-button{align-self:auto}.user-admin-head .primary-action{padding:8px 12px}.user-admin-tools>small{color:#946b25;font-size:9px;white-space:nowrap}
.user-admin-page{max-width:1180px;margin:auto}.user-admin-head{display:grid;grid-template-columns:auto 1fr auto;align-items:end;gap:22px;margin-bottom:24px}.user-admin-head>div small{color:var(--pc-primary);font-weight:700;letter-spacing:.12em}.user-admin-head h1{margin:5px 0;font-size:26px}.user-admin-head p{margin:0;color:var(--pc-muted)}.back-button{align-self:start;border:0;background:transparent;color:var(--pc-muted);cursor:pointer}.user-admin-panel{overflow:hidden}.user-admin-tools{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--pc-border)}.user-admin-tools label{display:flex;flex:1;align-items:center;gap:8px;max-width:420px;padding:8px 11px;border:1px solid var(--pc-border);border-radius:9px}.user-admin-tools input{width:100%;border:0;outline:0}.user-admin-tools span{margin-left:auto;color:var(--pc-muted);font-size:11px}.user-admin-tools button,.user-actions button{padding:7px 10px;border:1px solid var(--pc-border);border-radius:7px;background:#fff;cursor:pointer}.user-admin-row{display:grid;grid-template-columns:minmax(230px,1.5fr) minmax(120px,1fr) 80px 150px 240px;align-items:center;gap:12px;min-height:64px;padding:0 16px;border-bottom:1px solid #edf1ee;font-size:11px}.user-admin-row.table-head{min-height:38px;background:#f8faf8;color:var(--pc-muted);font-size:9px}.user-identity{display:flex;align-items:center;gap:10px}.user-identity i{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:var(--pc-primary-soft);color:var(--pc-primary);font-style:normal;font-weight:700}.user-identity b{display:grid;gap:3px}.user-identity small{color:var(--pc-muted);font-weight:400}.user-admin-row em{display:inline-block;padding:3px 8px;border-radius:12px;background:#e5f3eb;color:#27714e;font-style:normal}.user-admin-row em.disabled{background:#edf1ee;color:#68766e}.user-admin-row time{color:var(--pc-muted)}.user-actions{display:flex;gap:7px}.user-actions .danger{color:#aa4545}.user-actions button:disabled{cursor:not-allowed;opacity:.45}.user-admin-message{margin:12px 16px 0;color:var(--pc-primary);font-size:11px}.user-admin-message.error{color:#b54545}.user-admin-empty{padding:70px;text-align:center;color:var(--pc-muted)}.user-admin-dialog label small{color:var(--pc-muted);font-size:9px}.primary-action{padding:9px 14px;border:0;border-radius:8px;background:var(--pc-primary);color:#fff;cursor:pointer}.primary-action:disabled{opacity:.5;cursor:not-allowed}@media(max-width:980px){.user-admin-row{grid-template-columns:minmax(200px,1fr) 100px 70px 210px}.user-admin-row>time{display:none}.user-admin-head{grid-template-columns:1fr auto}.user-admin-head>.back-button{grid-column:1/-1}.dialog-grid{grid-template-columns:1fr}}
.user-admin-page.embedded{max-width:none;margin:0;padding:0;min-width:0}.embedded .user-admin-head{margin-bottom:24px!important}.embedded .user-admin-head h1{font-size:24px;margin:0 0 8px}.embedded .user-admin-head p{font-size:13px;line-height:1.6}.user-admin-table{overflow-x:auto}.user-admin-row{min-width:850px}.user-admin-tools{flex-wrap:wrap}.user-admin-tools>small{white-space:normal}.embedded .user-admin-tools label{min-width:160px}
</style>
