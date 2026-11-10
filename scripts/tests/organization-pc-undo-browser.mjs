// Disposable local community records only; checks actual workspace undo and persisted state.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir,writeFile } from 'node:fs/promises'
const require=createRequire(import.meta.url),{chromium}=require(process.env.NOTEFLOW_PLAYWRIGHT_MODULE||'playwright-core')
const origin=process.env.NOTEFLOW_UI_ORIGIN||'http://127.0.0.1:5186'
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('Local community required')
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_CHROMIUM_PATH,args:['--no-sandbox']}),checks=[]
try {
 const page=await browser.newPage();await page.goto(`${origin}/#/notes`);await page.locator('.notes-workspace').waitFor()
 await page.evaluate(async()=>{window.s=document.querySelector('.notes-workspace').__vueParentComponent.setupState;window.f=(await import('/src/community/adapters/folders.ts')).foldersService;window.target=await window.f.create('撤销审计专用目录',null);window.s.folders=await window.f.list()})
 for(const action of ['pin','organize','pending','archive','move']) {
  const result=await page.evaluate(async action=>{
   const s=window.s,service=s.notesStore.service();const original=await service.create({title:`撤销专用 ${action}`,content:'原始正文',type:'note',status:'active',pinned:false,organizationStatus:'pending'})
   await s.notesStore.acceptServer(original)
   const later={content:'后续编辑必须保留',pinned:true,organizationStatus:'organized',organizedAt:'2026-10-10T01:00:00.000Z',status:'archived',folderId:window.target.id,folderUid:window.target.uid}
   await s.notesStore.updateEntity(original,later);s.bulkUndo={action,items:[original]};await s.undoBulkNotes()
   const rows=[...await service.list('active'),...await service.list('archived')];return {original,saved:rows.find(n=>n.uid===original.uid),later,undo:s.bulkUndo}
  },action)
  assert.equal(result.saved.content,result.later.content)
  assert.equal(result.saved.pinned,action==='pin'?result.original.pinned:result.later.pinned)
  assert.equal(result.saved.organizationStatus,['organize','pending'].includes(action)?result.original.organizationStatus:result.later.organizationStatus)
  assert.equal(result.saved.status,action==='archive'?result.original.status:result.later.status)
  assert.equal(result.saved.folderUid,action==='move'?(result.original.folderUid||null):result.later.folderUid)
  assert.equal(result.undo,undefined)
  checks.push(`${action}: undo restores its own fields and preserves subsequent body/status/folder/pin/organization edits`)
 }
 await page.evaluate(async()=>{const s=window.s,n=await s.notesStore.service().create({title:'撤销草稿失败专用',content:'保留草稿',type:'note',status:'active'});await s.notesStore.acceptServer(n);s.bulkUndo={action:'pin',items:[n]};window.flush=s.notesStore.flushPendingSaves;s.notesStore.flushPendingSaves=async()=>{throw Error('模拟草稿保存失败')};window.writes=0;window.update=s.notesStore.updateEntity;s.notesStore.updateEntity=(...args)=>{window.writes++;return window.update(...args)}})
 await page.getByRole('button',{name:'撤销上次操作',exact:true}).click();await page.getByRole('alert').filter({hasText:'模拟草稿保存失败'}).waitFor()
 assert.equal(await page.evaluate(()=>window.writes),0);assert.equal(await page.evaluate(()=>!!window.s.bulkUndo&&!window.s.bulkBusy),true)
 await page.evaluate(()=>window.s.notesStore.flushPendingSaves=window.flush)
 await page.getByRole('button',{name:'重试撤销失败项',exact:true}).click();await page.getByRole('button',{name:'撤销上次操作',exact:true}).waitFor({state:'hidden'})
 checks.push('Draft save failure: zero undo writes, visible error, retained retry and successful recovery')
 await mkdir('artifacts/.build/organize-pc-undo',{recursive:true});await writeFile('artifacts/.build/organize-pc-undo/results.json',JSON.stringify({checks},null,2)+'\n');console.log(JSON.stringify({passed:checks.length,checks}))
}finally{await browser.close()}
