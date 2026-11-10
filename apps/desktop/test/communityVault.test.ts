import 'fake-indexeddb/auto'
import {deleteDB} from 'idb'
import {afterEach,expect,it} from 'vitest'
import {createIndexedDbLocalHost} from '@note-flow/core/local-storage-web'
import {createCommunityVault} from '../src/community/vaultService'
const context={profileId:'vault-synthetic',storageSchemaVersion:1},password='synthetic-secret-12345'
const hosts:Array<{host:ReturnType<typeof createIndexedDbLocalHost>;name:string}>=[]
afterEach(async()=>{for(const {host,name} of hosts.splice(0)){await host.close();await deleteDB(name)}})
function setup(){const name=`vault-${crypto.randomUUID()}`,host=createIndexedDbLocalHost(name);hosts.push({host,name});return {host,vault:createCommunityVault(host,context)}}
it('encrypts CRUD and attachment bytes, rotates passwords, and restores full space backup',async()=>{
 const {host,vault}=setup();await vault.create(password)
 const item=await vault.put({title:'synthetic account',password:'synthetic-password',username:'sample'})
 const file=new File([new Uint8Array([0,255,32,10])],'synthetic.bin',{type:'application/octet-stream'})
 await vault.attach(item.uid,file)
 expect([...((await vault.attachments(item.uid))[0]!.bytes)]).toEqual([0,255,32,10])
 const snapshot=await host.exportWorkspace(context)
 expect(JSON.stringify(snapshot)).not.toContain('synthetic-password')
 expect(JSON.stringify(snapshot)).not.toContain('synthetic.bin')
 await vault.changePassword(password,'new-synthetic-secret-12345');vault.lock()
 await expect(vault.list()).rejects.toThrow('锁定')
 await expect(vault.unlock(password)).rejects.toThrow()
 await vault.unlock('new-synthetic-secret-12345');expect((await vault.list())[0]?.title).toBe('synthetic account')
 const restored=setup();const newContext={...context,profileId:'restored-space'};await restored.host.restoreWorkspace(newContext,snapshot);const recovered=createCommunityVault(restored.host,newContext);await recovered.unlock(password)
 expect((await recovered.list())[0]?.password).toBe('synthetic-password')
 expect([...(await recovered.attachments(item.uid))[0]!.bytes]).toEqual([0,255,32,10])
 await recovered.remove(item.uid);expect(await recovered.list()).toEqual([]);expect(await recovered.attachments(item.uid)).toEqual([])
})
it('rejects wrong password, damaged payload and foreign owner without any writes',async()=>{
 const {host,vault}=setup();await vault.create(password);const item=await vault.put({title:'keep',password:'keep-secret'});await vault.attach(item.uid,new File(['keep-bytes'],'synthetic.txt'))
 const backup=await vault.export(),before=await host.exportWorkspace(context),changes=(await host.listChanges(context)).items.length
 await expect(vault.restore(backup,'incorrect')).rejects.toThrow()
 const damaged=structuredClone(backup);damaged.items[0]!.ciphertext='AAAA'
 await expect(vault.restore(damaged,password)).rejects.toThrow()
 const damagedAttachment=structuredClone(backup);damagedAttachment.attachments![0]!.ciphertext='AAAA'
 await expect(vault.restore(damagedAttachment,password)).rejects.toThrow()
 const foreign=createCommunityVault(host,{...context,profileId:'other'})
 await expect(foreign.restore(backup,password)).rejects.toThrow()
 expect((await host.exportWorkspace(context)).entities).toEqual(before.entities)
 expect((await host.listChanges(context)).items).toHaveLength(changes)
 expect(await foreign.exists()).toBe(false)
})
