import type { VaultItem } from './vault'

export interface VaultOrganizationSuggestion {
  uid: string
  patch: Partial<VaultItem>
  reasons: string[]
}
const aliases: Record<string, keyof VaultItem> = {
  '账号':'username','用户名':'username',username:'username',login:'username',
  '邮箱':'email',email:'email','网址':'url',url:'url','主机':'host',host:'host','ip':'host',
  '数据库':'databaseName',database:'databaseName','密码':'password',password:'password','token':'password',
}
const labels: Partial<Record<keyof VaultItem,string>> = {username:'用户名',email:'邮箱',url:'网址',host:'主机',databaseName:'数据库',password:'密码 / Token'}
const importedCategory = (value: string) => !value.trim() || /^(Markdown 导入|导入|未分类)$/i.test(value.trim())

// Never replace existing values or discard source text. Ambiguous repeated fields need manual review.
export function suggestVaultOrganization(item: VaultItem): VaultOrganizationSuggestion {
  const patch: Partial<VaultItem> = {}, reasons: string[] = []
  const candidates = new Map<keyof VaultItem, Set<string>>()
  for (const raw of (item.notes || '').split(/\r?\n/)) {
    const match = raw.trim().replace(/^[-*+]\s+/, '').match(/^([^:：]{1,20})[:：]\s*(.+)$/)
    if (!match) continue
    const field = aliases[match[1].trim().toLowerCase()], value = match[2].trim()
    if (!field || !value) continue
    if (field === 'url') { try { if (!['https:','http:'].includes(new URL(value).protocol)) continue } catch { continue } }
    const values = candidates.get(field) || new Set<string>(); values.add(value); candidates.set(field, values)
  }
  const ambiguous = [...candidates.values()].some(values => values.size > 1) || ((item.notes || '').match(/^#{1,3}\s+/gm)?.length || 0) > 1
  for (const [field, values] of candidates) {
    if (ambiguous) break
    if (values.size !== 1 || item[field] || field === 'url' && item.urls?.length) continue
    Object.assign(patch, { [field]: [...values][0] }); reasons.push(`补全${labels[field]}`)
  }
  const title = item.title.trim().replace(/\s+/g, ' ')
  if (title && title !== item.title) { patch.title = title; reasons.push('规范标题空白') }
  if (importedCategory(item.category || '')) {
    const type = item.credentialType || 'login'
    const category = ({login:'登录账号',server:'服务器',database:'数据库',api_key:'API 凭据',cloud:'云平台',license:'软件授权',totp:'动态口令',recovery_codes:'恢复码',certificate:'证书',secure_note:'安全备注',custom:'其他'} as const)[type]
    patch.category = category; reasons.push('按凭据类型分类')
  }
  return { uid: item.uid, patch, reasons }
}

export function vaultDuplicateUids(items: readonly VaultItem[]): Set<string> {
  const groups = new Map<string, string[]>(), duplicates = new Set<string>()
  for (const item of items) {
    const target = item.host || item.url || item.urls?.[0]?.url || ''
    const account = item.username || item.email || item.accountName || ''
    // No passwords or tokens in duplicate keys; same target/account is only a review hint.
    if (!target || !account) continue
    const identity = JSON.stringify([item.credentialType || 'login', item.projectUid || '', item.areaUid || '', item.environment || '', target.trim(), account.trim()])
    const values = groups.get(identity) || []; values.push(item.uid); groups.set(identity, values)
  }
  for (const values of groups.values()) if (values.length > 1) for (const uid of values) duplicates.add(uid)
  return duplicates
}

export function vaultNeedsOrganization(item: VaultItem, duplicates: Set<string>): boolean {
  return !item.title.trim() || importedCategory(item.category || '') || duplicates.has(item.uid) || suggestVaultOrganization(item).reasons.length > 0
}
