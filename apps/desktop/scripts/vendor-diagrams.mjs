import {createHash} from 'node:crypto'
import {cp,mkdir,readdir,readFile,rm,stat,writeFile} from 'node:fs/promises'
import {relative,resolve} from 'node:path'

const source=process.argv[2]
if(!source)throw new Error('Usage: npm run vendor:diagrams -- <reviewed drawio webapp directory>')
const root=resolve(import.meta.dirname,'..'),target=resolve(root,'public/vendor/diagrams'),entry=resolve(source,'index.html')
await stat(entry)
const expected=JSON.parse(await readFile(resolve(root,'src/canvas/diagrams/vendor-lock.json'),'utf8'))
const digest=createHash('sha256').update(await readFile(entry)).digest('hex')
if(expected.indexSha256!=='SET_AFTER_SECURITY_REVIEW'&&digest!==expected.indexSha256)throw new Error(`index.html checksum mismatch: ${digest}`)
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true})
const requiredDirectories=['images','img','js','math4','mxgraph','resources','shapes','stencils','styles']
for(const name of requiredDirectories)await cp(resolve(source,name),resolve(target,name),{recursive:true})
for(const name of ['favicon.ico','index.html'])await cp(resolve(source,name),resolve(target,name))
// Cloud connectors, collaboration transports, server artifacts, online templates
// and external plugins are intentionally not shipped. These optional bundles are
// also removed from the otherwise shared JS tree.
for(const name of ['integrate.min.js','onedrive','dropbox','simplepeer'])await rm(resolve(target,'js',name),{recursive:true,force:true})
const upstreamRoot=resolve(source,'../../..')
await cp(resolve(upstreamRoot,'LICENSE'),resolve(target,'LICENSE'))
const vendoredEntry=resolve(target,'index.html')
const html=await readFile(vendoredEntry,'utf8')
// diagrams.net loads its locale bundles (resources/*.txt) through XHR during
// bootstrap. Keep network access origin-confined instead of disabling XHR.
const csp="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
if(!/<head[\s>]/i.test(html))throw new Error('Unable to inject offline CSP: index.html has no head element')
const offlineHtml=html
  .replace(/\s*<meta\s+itemprop="image"[^>]*>/i,'')
  .replace(/\s*<link\s+rel="canonical"[^>]*>/i,'')
await writeFile(vendoredEntry,offlineHtml.replace(/<head([^>]*)>/i,`<head$1><meta http-equiv="Content-Security-Policy" content="${csp}">`))
const bridgeCsp=csp
  .replace("frame-src 'self'", "frame-src 'self' http://tauri.localhost https://tauri.localhost http://127.0.0.1:* http://localhost:* tauri: asset:")
let bridgeHtml=''
const bridgeJs=`(()=>{'use strict';const editor=document.getElementById('editor');const editorUrl='index.html?embed=1&proto=json&spin=1&configure=1&libraries=0&plugins=0&offline=1&local=1&picker=0&lang=zh';let nonce='',configured=null,pendingLoad=null,editorReady=false,sequence=0;const id=()=>('evt_'+String(++sequence).padStart(16,'0'));const send=(event,payload,requestId)=>{if(!nonce)return;parent.postMessage({protocol:1,event,nonce,requestId:requestId||id(),payload},'*')};const forward=value=>editor.contentWindow&&editor.contentWindow.postMessage(JSON.stringify(value),'*');const configure=()=>forward({action:'configure',config:{css:'',libraries:[],plugins:[],customFonts:[],fontCss:''}});const load=()=>forward({action:'load',xml:(pendingLoad&&pendingLoad.payload&&pendingLoad.payload.xml)||'',autosave:1});addEventListener('message',event=>{if(event.source===parent){const value=event.data;if(!value||value.protocol!==1||typeof value.nonce!=='string'||typeof value.requestId!=='string')return;nonce=value.nonce;if(value.action==='configure'){configured=value;if(editorReady){configure();send('ready',{},value.requestId)}return}if(value.action==='load'){pendingLoad=value;if(editorReady)load();return}if(value.action==='export'&&editorReady)forward({action:'export',format:(value.payload&&value.payload.format)||'xml',spinKey:'export'})}else if(event.source===editor.contentWindow){let value=event.data;try{if(typeof value==='string')value=JSON.parse(value)}catch{return}if(!value||typeof value.event!=='string')return;if(value.event==='configure'){configure();return}if(value.event==='init'){editorReady=true;if(pendingLoad)load();send('ready',{},configured&&configured.requestId);return}if(value.event==='save'||value.event==='autosave'){if(typeof value.xml==='string')send('save',{xml:value.xml},id());return}if(value.event==='export'){send('export',{data:typeof value.data==='string'?value.data:value.xml,format:value.format},id());return}if(value.event==='exit')return;if(value.event==='error')send('error',{message:String(value.message||'diagrams.net error')},id())}});editor.src=editorUrl})()\n`
bridgeHtml=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${bridgeCsp}"><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;overflow:hidden}</style></head><body><iframe id="editor" title="Offline diagrams.net editor" sandbox="allow-scripts allow-downloads allow-same-origin" referrerpolicy="no-referrer"></iframe><script>${bridgeJs}</script></body></html>\n`
await writeFile(resolve(target,'noteflow-bridge.html'),bridgeHtml)
await writeFile(resolve(target,'noteflow-bridge.js'),bridgeJs)
const manifest={available:true,version:expected.version,commit:expected.commit,sha256:digest,entry:'/vendor/diagrams/noteflow-bridge.html',license:'Apache-2.0'}
await writeFile(resolve(root,'src/canvas/diagrams/vendor-manifest.json'),`${JSON.stringify(manifest,null,2)}\n`)
const files=[]
async function collect(directory){for(const item of await readdir(directory,{withFileTypes:true})){const path=resolve(directory,item.name);if(item.isDirectory())await collect(path);else if(item.isFile()){const bytes=await readFile(path);files.push({path:relative(target,path).replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.byteLength})}}}
await collect(target);files.sort((a,b)=>a.path.localeCompare(b.path))
await writeFile(resolve(target,'noteflow-sbom.json'),`${JSON.stringify({component:'diagrams.net-webapp',version:expected.version,commit:expected.commit,license:expected.license,files},null,2)}\n`)
console.log(`Vendored diagrams.net ${expected.version}; index sha256=${digest}`)
