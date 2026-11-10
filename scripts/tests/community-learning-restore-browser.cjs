// Fresh browser context, community dev host and synthetic records only.
const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/gaojunxin/code/data-platform/dp-ui/node_modules/playwright-core')
const base=process.env.COMMUNITY_TEST_URL||'http://127.0.0.1:5199'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname))
;(async()=>{const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/home/gaojunxin/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-sandbox']});try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];let mutations=0
 await context.route('**/*',route=>{const r=route.request();if(['POST','PUT','PATCH','DELETE'].includes(r.method()))mutations++;return new URL(r.url()).origin===base?route.continue():route.abort()})
 page.on('pageerror',error=>errors.push(error.message))
 await page.goto(base+'/test/fixtures/community-learning-restore.html')
 const question=page.locator('.learning-question-label textarea')
 await question.waitFor({timeout:60000})
 await page.waitForFunction(()=>document.querySelector('.learning-question-label textarea')?.value==='Synthetic restored question',{},{timeout:15000}).catch(async error=>{console.error(JSON.stringify(await page.evaluate(()=>{const profile=localStorage.getItem('note-flow-community-profile-v1'),raw=localStorage.getItem(`note-flow-ai-local:v1:community-${profile}`),cache=raw?JSON.parse(raw):null;return{cachedSessions:cache?.sessions?.length,epoch:cache?.epoch,inputLength:cache?.input?.length,visibleInputLength:document.querySelector('.learning-question-label textarea')?.value?.length}})));throw error})
 await question.fill('Synthetic continued question')
 await page.reload();await question.waitFor({timeout:60000})
 await page.waitForFunction(()=>document.querySelector('.learning-question-label textarea')?.value==='Synthetic continued question',{},{timeout:15000})
 const state=await page.evaluate(()=>{const profile=localStorage.getItem('note-flow-community-profile-v1'),cache=JSON.parse(localStorage.getItem(`note-flow-ai-local:v1:community-${profile}`));return{input:cache.input,draft:cache.draft,pending:Boolean(cache.pendingSend||cache.operation),selected:cache.sessions.find(row=>row.uid===cache.selectedUid)?.title}})
 assert.equal(state.input,'Synthetic continued question');assert.equal(state.draft,'Synthetic restored draft');assert.equal(state.pending,false);assert.match(state.selected,/恢复草稿/);assert.deepEqual(errors,[]);assert.equal(mutations,0)
 console.log('PASS: actual community AI panel preserves restored and edited synthetic drafts across reload, selects a recovered discussion and sends zero HTTP mutations. Browser dev fixture only; not native acceptance.')
}finally{await browser.close()}})().catch(error=>{console.error(error.message);process.exitCode=1})
