import 'fake-indexeddb/auto'
import {expect, it, vi} from 'vitest'
const mock = vi.hoisted(()=>({scope:'', complete:vi.fn()}))
vi.mock('../src/services/aiClientConfig', ()=>({aiLocalScope:()=>mock.scope, aiClientConfig:()=>({channel:'local',model:'synthetic'}), directAiCompletion:mock.complete}))
vi.mock('../src/services/clientContext',()=>({clientOwnerScope:()=>mock.scope}))
vi.mock('../src/services/accountStorage',()=>({readAccountSetting:()=>'{"userId":"synthetic"}',accountLifecycleRevision:()=>0}))
import {stageCommunityLearning, captureCommunityLearning, type CommunityLearningBackup} from '../src/community/learningBackup'
import {localLearningService} from '../src/services/localAiLearning'
import type {LearningSession} from '@note-flow/core/ai-learning'
const preferences = new Map<string,string>()
vi.stubGlobal('localStorage', {getItem:(key:string)=>preferences.get(key)??null, setItem:(key:string,value:string)=>preferences.set(key,value)})
vi.stubGlobal('window', new EventTarget())
const session = (uid:string,revision:number,input=''):LearningSession=>({uid,revision,title:'Synthetic discussion',input,draft:'',draftSources:[],messages:[]})
it('keeps canonical sessions, recovers divergent or cache-only discussions as usable copies, and preserves compatible edits', async()=>{
 const target = crypto.randomUUID(); mock.scope = `community-${target}`
 const canonical = session('synthetic-conflict',4,'Canonical input')
 const compatible = session('synthetic-compatible',3,'Old input')
 const cached = session(canonical.uid,2,'Cached input')
 cached.draft = 'Unsubmitted conflicting draft'
 cached.messages = [{uid:'synthetic-partial',version:1,role:'assistant',content:'Synthetic cached partial',status:'pending'}]
 const source:CommunityLearningBackup = {schema:'note-flow-community-learning',version:1,scope:'community-synthetic-source',sessions:[canonical,compatible],operations:[],actions:{drafts:[],operations:[]},cache:{sessions:[cached,{...compatible,input:'Compatible unsent input',draft:'Compatible draft'},session('synthetic-cache-only',1,'Cache-only input')],selectedUid:cached.uid,input:'Newest visible input',draft:cached.draft,sources:[],pendingSend:{uid:'old-send',signature:'old-send'}}}
 const original = structuredClone(source)
 await stageCommunityLearning(source,target)
 const result = await captureCommunityLearning(target)
 expect(result.sessions).toHaveLength(4)
 expect(result.sessions.find(row=>row.uid===canonical.uid)).toEqual(canonical)
 expect(result.sessions.find(row=>row.uid===compatible.uid)).toMatchObject({revision:3,input:'Compatible unsent input',draft:'Compatible draft'})
 const selected = result.cache!.sessions.find(row=>row.uid===result.cache!.selectedUid)!
 expect(selected.uid).not.toBe(canonical.uid)
 expect(selected).toMatchObject({revision:1,input:'Newest visible input',draft:cached.draft,messages:[{status:'interrupted',finishReason:'process_exit',content:'Synthetic cached partial'}]})
 expect(result.sessions.some(row=>row.input==='Cache-only input'&&row.uid!=='synthetic-cache-only')).toBe(true)
 expect(result.cache!.pendingSend).toBeUndefined()
 expect(result.cache!.epoch).toBe((await localLearningService.epoch()).syncEpoch)
 expect(result.operations).toEqual([])
 const edited = await localLearningService.edit(selected.uid,{revision:selected.revision,input:'Synthetic continued editing'})
 expect(edited).toMatchObject({revision:2,input:'Synthetic continued editing'})
 expect((await localLearningService.get(canonical.uid)).input).toBe('Canonical input')
 expect(source).toEqual(original)
 expect(mock.complete).not.toHaveBeenCalled()
})
