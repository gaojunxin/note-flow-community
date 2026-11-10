// Fresh local community browser only; no real account or existing records.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
const require=createRequire(import.meta.url),{chromium}=require(process.env.NOTEFLOW_PLAYWRIGHT_MODULE||'playwright-core')
const origin=process.env.NOTEFLOW_UI_ORIGIN||'http://127.0.0.1:5186';if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('Local community required')
const browser=await chromium.launch({executablePath:process.env.NOTEFLOW_CHROMIUM_PATH,args:['--no-sandbox']}),checks=[]
try{
 for(const action of ['open','submit','folder-undo','notes-undo','create']){
  console.log('checking',action);const context=await browser.newContext(),page=await context.newPage();await page.goto(`${origin}/#/notes`);await page.locator('.notes-workspace').waitFor()
  await page.evaluate(async()=>{window.s=document.querySelector('.notes-workspace').__vueParentComponent.setupState;window.f=(await import(performance.getEntriesByType('resource').map(e=>e.name).find(url=>url.includes('/community/adapters/folders.ts'))||'/src/community/adapters/folders.ts')).foldersService;window.a=await window.f.create('隔离原目录',null);window.b=await window.f.create('隔离目标',null);window.s.folders=await window.f.list();window.n=await window.s.notesStore.service().create({title:'隔离账号测试',content:'保留正文',type:'note',status:'active',folderId:window.a.id,folderUid:window.a.uid});await window.s.notesStore.acceptServer(window.n);window.s.notesStore.select(window.n.uid);window.writes=0})
  if(action==='folder-undo')await page.evaluate(async()=>{await window.s.openFolderDestination(window.a,window.b);await window.s.submitDestination()})
  if(action==='notes-undo')await page.evaluate(async()=>{await window.s.openNoteDestination([window.n],window.b);await window.s.submitDestination()})
  if(action==='submit'||action==='create')await page.evaluate(async()=>{await window.s.openNoteDestination([window.n],window.b)})
  await page.evaluate(action=>{const s=window.s;window.originalFlush=s.notesStore.flushPendingSaves;s.notesStore.flushPendingSaves=()=>new Promise(resolve=>window.release=resolve);const update=s.notesStore.updateEntity;s.notesStore.updateEntity=(...args)=>{window.writes++;return update(...args)};const move=window.f.move;window.f.move=(...args)=>{window.writes++;return move.apply(window.f,args)};if(action==='create'){const create=window.f.create;window.f.create=async(...args)=>{const folder=await create.apply(window.f,args);await new Promise(resolve=>window.release=resolve);return folder}}window.operation=action==='open'?s.openNoteDestination([window.n]):action==='submit'?s.submitDestination():action==='folder-undo'?s.undoFolderDestination():action==='notes-undo'?s.undoBulkNotes():s.createDestinationFolder('延迟创建')},action)
  await page.waitForFunction(()=>typeof window.release==='function',null,{timeout:5000}).catch(async error=>{console.log(await page.evaluate(()=>({destination:window.s.destination,scope:window.s.destinationScope,errors:window.s.destinationErrors,busy:window.s.destinationBusy})));throw error})
  await page.evaluate(async()=>{window.s.auth.user={...window.s.auth.user,userId:'disposable-other-owner'};await new Promise(resolve=>setTimeout(resolve,0));window.release();await window.operation})
  assert.equal(await page.getByRole('dialog',{name:'移动到…',exact:true}).count(),0)
  assert.equal(await page.evaluate(()=>window.writes),0)
  assert.equal(await page.evaluate(()=>!window.s.folderUndo&&!window.s.bulkUndo&&!window.s.organizationResult),true)
  checks.push(`${action}: owner switch during awaited operation prevents subsequent writes and stale dialog/undo/result`)
  await context.close()
 }
 await mkdir('artifacts/.build/organize-pc-owner',{recursive:true});await writeFile('artifacts/.build/organize-pc-owner/after.json',JSON.stringify({checks},null,2)+'\n');console.log(JSON.stringify({passed:checks.length,checks}))
}finally{await browser.close()}
