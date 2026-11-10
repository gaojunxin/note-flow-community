import 'fake-indexeddb/auto'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {createCommunityStorage} from '../src/community/platformStorage'
const mobile=vi.hoisted(()=>({native:false,request:vi.fn()}))
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>mobile.native},registerPlugin:()=>({request:mobile.request})}))
const context={profileId:'platform-test',storageSchemaVersion:1}
afterEach(()=>{vi.unstubAllGlobals();mobile.native=false;mobile.request.mockReset()})
describe('community platform storage selection',()=>{
 it('routes the desktop window to the single native command',async()=>{
  const invoke=vi.fn().mockResolvedValue({items:[],hasMore:false,nextSequence:0})
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{},__TAURI__:{core:{invoke}}})
  const host=createCommunityStorage('never-open-web')
  expect((await host.listChanges(context)).items).toEqual([])
  expect(invoke).toHaveBeenCalledWith('community_local_request',{input:{profileId:'platform-test',operation:'listChanges',args:{after:0,limit:50}}})
  await host.close()
 })
 it('fails visibly when desktop transport is missing instead of opening a second database',async()=>{
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{}})
  const host=createCommunityStorage('never-open-web')
  await expect(host.listChanges(context)).rejects.toThrow('社区桌面本地仓储接口不可用')
  await host.close()
 })
 it('preserves native revision conflicts for the repository caller',async()=>{
  vi.stubGlobal('window',{__TAURI_INTERNALS__:{},__TAURI__:{core:{invoke:vi.fn().mockRejectedValue({code:'REVISION_CONFLICT'})}}})
  const host=createCommunityStorage('never-open-web')
  await expect(host.listChanges(context)).rejects.toMatchObject({code:'REVISION_CONFLICT'})
  await host.close()
 })
 it('routes Android to the public plugin without exposing paths or SQL',async()=>{
  mobile.native=true;mobile.request.mockResolvedValue({result:{items:[],hasMore:false,nextSequence:0}})
  const host=createCommunityStorage('never-open-web')
  expect((await host.listChanges(context)).items).toEqual([])
  expect(mobile.request).toHaveBeenCalledWith({input:JSON.stringify({profileId:'platform-test',operation:'listChanges',args:{after:0,limit:50}})})
  await host.close()
 })
 it('reports missing Android native storage and does not silently fall back',async()=>{
  mobile.native=true;mobile.request.mockRejectedValue({code:'UNIMPLEMENTED'})
  const host=createCommunityStorage('never-open-web')
  await expect(host.listChanges(context)).rejects.toMatchObject({code:'STORAGE_ERROR'})
  await host.close()
 })

})
