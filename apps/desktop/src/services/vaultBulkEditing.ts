import { normalizeVaultItem } from '@note-flow/core/vault'
import type { VaultItem } from './vault'

/** 批量列表仅允许修改管理字段，凭据内容必须通过单条编辑保存。 */
export const vaultBulkFields = ['status', 'scopeType', 'areaUid', 'projectUid', 'environment', 'category', 'tags'] as const
export type VaultBulkPatch = Partial<Pick<VaultItem, typeof vaultBulkFields[number]>>
export interface VaultBulkChange { uid: string; expectedUpdatedAt: string; patch: VaultBulkPatch }

/** 即使调用方传入额外属性，也不能借批量入口覆盖密码、标题或身份。 */
export function vaultBulkPatch(source: VaultBulkPatch): VaultBulkPatch {
  return Object.fromEntries(vaultBulkFields.filter(field => Object.hasOwn(source, field)).map(field => [field, source[field]]))
}

/** 只记录实际改变的字段，撤销时也只恢复本次操作拥有的字段。 */
export function vaultBulkChanges(originals: VaultItem[], drafts: VaultItem[]): VaultBulkChange[] {
  const baseline = new Map(originals.map(item => [item.uid, item]))
  return drafts.flatMap(item => {
    const original = baseline.get(item.uid)
    if (!original) return []
    const patch = Object.fromEntries(vaultBulkFields.filter(field => JSON.stringify(original[field]) !== JSON.stringify(item[field])).map(field => [field, item[field]]))
    return Object.keys(patch).length ? [{ uid: item.uid, expectedUpdatedAt: original.updatedAt, patch }] : []
  })
}

/** 复用管理字段校验，但只取本次修改字段，避免顺带修剪历史凭据或备注。 */
export function applyVaultBulkPatch(original:VaultItem,source:VaultBulkPatch):VaultItem {
  const patch=vaultBulkPatch(source),normalized=normalizeVaultItem({...original,...patch})
  const owned=Object.fromEntries(Object.keys(patch).map(field=>[field,normalized[field as keyof VaultItem]]))
  return {...original,...owned,updatedAt:normalized.updatedAt}
}
