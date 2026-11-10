import 'fake-indexeddb/auto'
import {beforeEach, afterEach, expect, it, vi} from 'vitest'
// Match the community build's service host mapping, rather than the official vault DB.
vi.mock('../src/services/vault', async()=>import('../src/community/adapters/vault'))
import {createLocalBackup, restoreLocalBackup} from '../src/community/adapters/localBackup'
import {createVault, saveVaultMetadataBatch, saveVaultItem, saveVaultAttachment, unlockVault, listVaultItems, readVaultAttachment, exportVault, changeVaultMasterPassword, hasVault} from '../src/community/adapters/vault'
import {getCommunityWorkspace} from '../src/community/runtime'
import {clearVaultSession} from '../src/services/vaultSession'
import {COMMUNITY_PROFILE_KEY} from '../src/community/workspace'
import {encodePortableValue} from '@note-flow/core/community'
const preferences = new Map<string,string>()
vi.stubGlobal('localStorage', {getItem:(key:string)=>preferences.get(key)??null, setItem:(key:string,value:string)=>preferences.set(key,value)})
vi.stubGlobal('location', {origin:'http://synthetic-vault.invalid'})
vi.stubGlobal('window', new EventTarget())
beforeEach(()=>preferences.set(COMMUNITY_PROFILE_KEY,crypto.randomUUID()))
afterEach(()=>vi.restoreAllMocks())
async function fixture() {
 const profile = preferences.get(COMMUNITY_PROFILE_KEY)!, password = 'Synthetic vault master password'
 const key = await createVault(profile,password)
 const item = await saveVaultItem(profile,key,{title:'Synthetic account',password:'Synthetic item secret'})
 const file = await saveVaultAttachment(profile,item.uid,key,new File([new Uint8Array([0,128,255])],'synthetic-vault.bin'))
 return {profile,password,item,file,backup:await createLocalBackup()}
}
it('rejects a workspace change while reading its vault record', async()=>{
 const {profile} = await fixture(), workspace = await getCommunityWorkspace(), original = workspace.host.transaction.bind(workspace.host)
 vi.spyOn(workspace.host,'transaction').mockImplementation(async(context,work)=>{
  const result = await original(context,work)
  preferences.set(COMMUNITY_PROFILE_KEY,crypto.randomUUID())
  return result
 })
 await expect(hasVault(profile)).rejects.toThrow('空间已切换')
})
it('does not return an unlocked key after switching workspaces during key derivation', async()=>{
 const {profile,password} = await fixture(), original = crypto.subtle.deriveKey.bind(crypto.subtle)
 vi.spyOn(crypto.subtle,'deriveKey').mockImplementation(async(...args)=>{
  const result = await original(...args)
  preferences.set(COMMUNITY_PROFILE_KEY,crypto.randomUUID())
  return result
 })
 await expect(unlockVault(profile,password)).rejects.toThrow('空间已切换')
})
it('does not return an unlocked key after a lock event during key derivation', async()=>{
 const {profile,password} = await fixture(), original = crypto.subtle.deriveKey.bind(crypto.subtle)
 vi.spyOn(crypto.subtle,'deriveKey').mockImplementation(async(...args)=>{
  const result = await original(...args)
  clearVaultSession()
  return result
 })
 await expect(unlockVault(profile,password)).rejects.toThrow('会话变化')
})
it('does not save an attachment in either workspace after the file read switches profiles', async()=>{
 const {profile,password,item,backup} = await fixture(), key = await unlockVault(profile,password), next = crypto.randomUUID()
 const file = new File([new Uint8Array([1,2])],'synthetic-late.bin')
 Object.defineProperty(file,'arrayBuffer',{value:async()=>{preferences.set(COMMUNITY_PROFILE_KEY,next);return new Uint8Array([1,2]).buffer}})
 await expect(saveVaultAttachment(profile,item.uid,key,file)).rejects.toThrow('空间已切换')
 expect(await hasVault(next)).toBe(false)
 preferences.set(COMMUNITY_PROFILE_KEY,profile)
 expect((await exportVault(profile)).attachments).toEqual(backup.vault!.attachments)
})
it('rolls back a credential write if the profile changes after put but before transaction completion', async()=>{
 const {profile,password,item,backup} = await fixture(), key = await unlockVault(profile,password)
 const workspace = await getCommunityWorkspace(), original = workspace.host.transaction.bind(workspace.host)
 const transaction = vi.spyOn(workspace.host,'transaction').mockImplementation((context,work)=>original(context,tx=>work({...tx,put:async(...args)=>{
  const result = await tx.put(...args)
  preferences.set(COMMUNITY_PROFILE_KEY,crypto.randomUUID())
  return result
 }})))
 try {await expect(saveVaultItem(profile,key,{...item,password:'Must not be saved'})).rejects.toThrow('空间已切换')}
 finally {transaction.mockRestore()}
 preferences.set(COMMUNITY_PROFILE_KEY,profile)
 expect((await exportVault(profile)).items).toEqual(backup.vault!.items)
})
it('restores the actual UI vault and attachments with original AAD and allows independent password rotation', async()=>{
 const {profile,password,item,file,backup} = await fixture()
 expect(JSON.stringify(backup)).not.toContain(password)
 expect(JSON.stringify(backup)).not.toContain(item.password)
 await restoreLocalBackup(await encodePortableValue(backup))
 const target = preferences.get(COMMUNITY_PROFILE_KEY)!
 await expect(unlockVault(target,'Wrong synthetic password')).rejects.toThrow('主密码不正确')
 const key = await unlockVault(target,password)
 expect((await listVaultItems(target,key))[0].password).toBe(item.password)
 expect([...(await readVaultAttachment(target,item.uid,file.uid,key)).bytes]).toEqual([0,128,255])
 expect((await exportVault(target)).ownerId).toBe(backup.vault!.ownerId)
 await changeVaultMasterPassword(target,password,'Synthetic replacement master password')
 await expect(unlockVault(target,password)).rejects.toThrow()
 const nextKey = await unlockVault(target,'Synthetic replacement master password')
 expect([...(await readVaultAttachment(target,item.uid,file.uid,nextKey)).bytes]).toEqual([0,128,255])
 preferences.set(COMMUNITY_PROFILE_KEY,profile)
 const originalKey = await unlockVault(profile,password)
 expect((await listVaultItems(profile,originalKey))[0].password).toBe(item.password)
 expect((await exportVault(profile)).meta).toEqual(backup.vault!.meta)
})
it('rejects malformed vault attachment ownership before publishing a new profile', async()=>{
 const {profile,item,backup} = await fixture()
 const shadow = structuredClone(backup)
 shadow.vault = null
 const active = shadow.workspace.entities.find(row=>row.entityType==='vault'&&row.entityUid==='vault')!
 ;(active.value.backup as NonNullable<typeof backup.vault>).attachments![0].itemKey = `foreign-owner:${item.uid}`
 await expect(restoreLocalBackup(shadow)).rejects.toThrow('保险箱')
 expect(preferences.get(COMMUNITY_PROFILE_KEY)).toBe(profile)
 backup.vault!.attachments![0].itemKey = `foreign-owner:${item.uid}`
 await expect(restoreLocalBackup(backup)).rejects.toThrow('保险箱')
 expect(preferences.get(COMMUNITY_PROFILE_KEY)).toBe(profile)
})

// 社区版批量编辑必须走整份保险箱版本校验，凭据及附件保持原样。
it('saves metadata as one community vault revision and rejects stale batches',async()=>{
 const {profile,password,item,file}=await fixture(),key=await unlockVault(profile,password)
 const second=await saveVaultItem(profile,key,{title:'Synthetic second',password:'second secret'})
 await expect(saveVaultMetadataBatch(profile,key,[{uid:item.uid,expectedUpdatedAt:item.updatedAt,patch:{status:'archived'}},{uid:second.uid,expectedUpdatedAt:'stale',patch:{status:'archived'}}])).rejects.toThrow('记录已变化')
 expect((await listVaultItems(profile,key)).every(value=>value.status!=='archived')).toBe(true)
 await saveVaultMetadataBatch(profile,key,[item,second].map(value=>({uid:value.uid,expectedUpdatedAt:value.updatedAt,patch:{status:'archived',category:'synthetic batch'}})))
 expect((await listVaultItems(profile,key)).find(value=>value.uid===item.uid)).toMatchObject({status:'archived',category:'synthetic batch',password:'Synthetic item secret'})
 expect([...((await readVaultAttachment(profile,item.uid,file.uid,key)).bytes)]).toEqual([0,128,255])
})
