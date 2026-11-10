export interface AccountProfile { userName: string; nickName: string; email: string; phonenumber: string }
export function validateAccountProfile(value: AccountProfile) {
  if (!value.nickName.trim() || value.nickName.length > 30) return '昵称不能为空，最多 30 个字符'
  if (value.email && (value.email.length > 50 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))) return '请输入正确的邮箱地址'
  if (value.phonenumber && !/^[0-9+ -]{1,11}$/.test(value.phonenumber)) return '请输入正确的手机号码，最多 11 个字符'
  return ''
}
export function validateAccountUsername(value: string, current: string) {
  if (value.length < 2 || value.length > 20 || !/^[\p{L}\p{N}_.-]+$/u.test(value)) return '用户名需为 2–20 个字符，可使用文字、数字、下划线、点或短横线'
  if (value === current) return '新用户名与当前用户名相同'
  return ''
}
export function accountPasswordChecks(oldPassword: string, password: string, confirmation: string) {
  return { length: password.length >= 5 && password.length <= 20, different: Boolean(password && password !== oldPassword), matches: Boolean(confirmation && confirmation === password) }
}
export function validateAccountPassword(oldPassword: string, password: string, confirmation: string) {
  if (!oldPassword) return '请输入当前密码'
  const checks = accountPasswordChecks(oldPassword, password, confirmation)
  if (!checks.length) return '新密码长度需为 5–20 个字符'
  if (!checks.different) return '新密码不能与当前密码相同'
  if (!checks.matches) return '两次输入的新密码不一致'
  return ''
}
export function accountPasswordStrength(password: string) {
  if (!password) return { score: 0, label: '建议使用较长且不易猜测的密码' }
  const groups = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(pattern => pattern.test(password)).length
  const score = password.length >= 12 && groups >= 3 ? 3 : password.length >= 8 && groups >= 2 ? 2 : 1
  return { score, label: ['','较弱','一般','较强'][score] }
}
export function safeAccountAvatarPath(value: string | undefined) {
  if (!value || !/^\/profile\/avatar\/[a-zA-Z0-9_./-]+$/.test(value) || value.split('/').some(part => part === '..' || part === '.')) return ''
  return value
}
export function validateAccountAvatar(file: { size: number; type: string; name: string }) {
  if (!['image/png','image/jpeg'].includes(file.type) || !/\.(png|jpe?g)$/i.test(file.name)) return '请选择 JPG 或 PNG 图片'
  if (file.size > 5 * 1024 * 1024) return '头像图片不能超过 5 MB'
  if (!file.size) return '图片文件为空，请重新选择'
  return ''
}
