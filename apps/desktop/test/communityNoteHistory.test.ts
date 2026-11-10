import 'fake-indexeddb/auto'
import {beforeEach, afterEach, expect, it, vi} from 'vitest'
import {createPcNotesService, getCommunityWorkspace} from '../src/community/adapters/notes'
import {COMMUNITY_PROFILE_KEY} from '../src/community/workspace'
import {createNoteHistory, historyStamp, revisionStorage} from '../src/services/noteHistory'
import {noteOrganizationService} from '../src/community/adapters/noteOrganization'
const preferences = new Map<string,string>()
vi.stubGlobal('localStorage', {getItem:(key:string)=>preferences.get(key)??null, setItem:(key:string,value:string)=>preferences.set(key,value)})
vi.stubGlobal('window', {})
beforeEach(()=>preferences.set(COMMUNITY_PROFILE_KEY, crypto.randomUUID()))
afterEach(()=>vi.restoreAllMocks())
it('preserves both original bodies before an atomic manual merge', async()=>{
 const service = createPcNotesService()
 const source = await service.create({title:'Synthetic source', content:'Source original'})
 const target = await service.create({title:'Synthetic target', content:'Target original'})
 await noteOrganizationService.merge({sourceUid:source.uid, targetUid:target.uid, sourceVersion:source.version, targetVersion:target.version, title:'Merged', content:'Combined synthetic body'})
 const history = createNoteHistory(`community-${preferences.get(COMMUNITY_PROFILE_KEY)}`)
 expect((await history.list(source.uid))[0]).toMatchObject({content:source.content, reason:'delete'})
 expect((await history.list(target.uid))[0]).toMatchObject({content:target.content, reason:'edit'})
 expect((await service.get(source.uid))?.deleted).toBe(true)
 expect((await service.get(target.uid))?.content).toBe('Combined synthetic body')
})
it('rolls back the target write when source deletion fails inside the merge transaction', async()=>{
 const service = createPcNotesService()
 const source = await service.create({title:'Synthetic source', content:'Source intact'})
 const target = await service.create({title:'Synthetic target', content:'Target intact'})
 const workspace = await getCommunityWorkspace(), original = workspace.host.transaction.bind(workspace.host)
 const transaction = vi.spyOn(workspace.host,'transaction').mockImplementation((context, work)=>original(context, tx=>work({...tx, delete:async()=>{throw Error('Synthetic merge delete failure')}})))
 try {await expect(noteOrganizationService.merge({sourceUid:source.uid, targetUid:target.uid, title:'Merged', content:'Must roll back'})).rejects.toThrow('Synthetic merge delete failure')}
 finally {transaction.mockRestore()}
 expect(await service.get(source.uid)).toMatchObject({content:source.content, deleted:false})
 expect((await service.get(target.uid))?.content).toBe(target.content)
})
it('does not merge when either history write fails or a concurrent edit changes a captured revision', async()=>{
 const service = createPcNotesService()
 const source = await service.create({title:'Synthetic source', content:'Keep source'})
 const target = await service.create({title:'Synthetic target', content:'Keep target'})
 const request = {sourceUid:source.uid, targetUid:target.uid, title:'Merged', content:'Must not replace'}
 const append = revisionStorage.append.bind(revisionStorage)
 let calls = 0
 const fault = vi.spyOn(revisionStorage,'append').mockImplementation(async(value,limit)=>{
  if (++calls === 2) throw Error('Synthetic second history failure')
  await append(value,limit)
 })
 await expect(noteOrganizationService.merge(request)).rejects.toThrow('Synthetic second history failure')
 expect(await service.get(source.uid)).toMatchObject({content:source.content, deleted:false})
 expect((await service.get(target.uid))?.content).toBe(target.content)
 fault.mockRestore()
 const workspace = await getCommunityWorkspace()
 const race = vi.spyOn(revisionStorage,'append').mockImplementation(async(value,limit)=>{
  await append(value,limit)
  if (value.noteUid === target.uid) {
   const current = (await workspace.notes.get(target.uid))!
   // Keep the numeric version unchanged: protection must use the actual local revision.
   await workspace.notes.update({...current.entity, content:'Concurrent newer body'}, current.revision)
  }
 })
 try {await expect(noteOrganizationService.merge(request)).rejects.toThrow('笔记已变化')}
 finally {race.mockRestore()}
 expect(await service.get(source.uid)).toMatchObject({content:source.content, deleted:false})
 expect((await service.get(target.uid))?.content).toBe('Concurrent newer body')
})
it('captures edited and deleted versions and restores historical content through the community service', async()=>{
 const service = createPcNotesService(), original = await service.create({title:'Synthetic original', content:'Synthetic first body'})
 const profile = preferences.get(COMMUNITY_PROFILE_KEY)!, history = createNoteHistory(`community-${profile}`)
 const edited = await service.update({...original, content:'Synthetic second body'})
 expect((await history.list(original.uid))[0].content).toBe(original.content)
 await expect(service.update({...original, content:'Stale'})).rejects.toThrow('已变化')
 expect(await history.list(original.uid)).toHaveLength(1)
 const deleted = await service.remove(edited)
 expect((await history.list(original.uid))[0]).toMatchObject({content:edited.content, reason:'delete'})
 const restored = await service.update({...deleted, deleted:false})
 const revision = (await history.list(original.uid)).find(row=>row.content===original.content)!
 const historical = await history.restore(restored, revision.id, historyStamp(restored), service.update)
 expect(historical.content).toBe(original.content)
 expect((await service.get(original.uid))?.content).toBe(original.content)
})
it('does not edit or delete the note if its recovery history cannot be persisted', async()=>{
 const service = createPcNotesService(), original = await service.create({title:'Synthetic quota', content:'Keep this body'})
 vi.spyOn(revisionStorage,'append').mockRejectedValue(new DOMException('Synthetic history quota','QuotaExceededError'))
 await expect(service.update({...original, content:'Must not save'})).rejects.toThrow('Synthetic history quota')
 await expect(service.remove(original)).rejects.toThrow('Synthetic history quota')
 expect(await service.get(original.uid)).toMatchObject({content:original.content, deleted:false})
})
it('rejects a profile switch during history persistence before modifying the original workspace', async()=>{
 const service = createPcNotesService(), original = await service.create({title:'Synthetic scope', content:'Keep original'})
 const workspace = await getCommunityWorkspace(), append = revisionStorage.append.bind(revisionStorage)
 vi.spyOn(revisionStorage,'append').mockImplementation(async(value,limit)=>{
  await append(value,limit)
  preferences.set(COMMUNITY_PROFILE_KEY, crypto.randomUUID())
 })
 await expect(service.update({...original, content:'Wrong scope'})).rejects.toThrow('空间已切换')
 expect((await workspace.notes.get(original.uid))?.entity.content).toBe(original.content)
 expect(await service.get(original.uid)).toBeUndefined()
})
