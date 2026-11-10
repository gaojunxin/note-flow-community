import {testFixtureGuard} from '../../scripts/dev/test-fixture-guard.mjs'
import {defineConfig,normalizePath} from 'vite'
import vue from '@vitejs/plugin-vue'
import {pdfAssets} from './scripts/pdfAssets'
import {resolve as pathResolve,dirname} from 'node:path'
import {createRequire} from 'node:module'
import {readFileSync,readdirSync} from 'node:fs'
import {createHash} from 'node:crypto'

const resolve=(...paths:string[])=>normalizePath(pathResolve(...paths))

export default defineConfig({
  cacheDir: 'node_modules/.vite-community',
  resolve: {alias: [{find: '@note-flow/core/task-recurrence', replacement: resolve(__dirname,'../../packages/core/src/community/taskRecurrencePreview.ts')},{find: /^@note-flow\/core$/, replacement: resolve(__dirname,'../../packages/core/src/community/index.ts')}]},
  define: {'import.meta.env.VITE_NOTE_FLOW_EDITION': JSON.stringify('community')},
  plugins: [testFixtureGuard(__dirname),vue(),pdfAssets(), {
    name: 'community-public-hosts',
    enforce: 'pre',
    resolveId(source,importer) {
      if(source==='/ji-yu-icon.png')return resolve(__dirname,'public/ji-yu-icon.png')
      if(!importer||!source.startsWith('.'))return null
      const clean=importer.split('?')[0],candidate=resolve(dirname(clean),source),srcRoot=resolve(__dirname,'src')
      const map=JSON.parse(readFileSync(resolve(srcRoot,'community/host-map.json'),'utf8')) as Record<string,string>
      for(const [original,host] of Object.entries(map)){const absolute=resolve(srcRoot,original);if(candidate===absolute||candidate+'.ts'===absolute||candidate+'.vue'===absolute)return resolve(srcRoot,host)}
      return null
    },
  }, {
    name: 'community-source-boundary',
    enforce: 'pre',
    load(id) {
      const source=normalizePath(id.split('?')[0]),root=resolve(__dirname,'../..')
      if(source.startsWith(resolve(root,'private')+'/')||source.startsWith(resolve(root,'backend')+'/'))throw new Error(`Private module in community build: ${source}`)
      // 开发主仓库与公开导出必须使用同一门面字节，不能从原路径加载高级实现。
      const templates=(JSON.parse(readFileSync(resolve(root,'community/client-export-manifest.json'),'utf8')).templates??{}) as Record<string,string>
      for(const [template,target] of Object.entries(templates))if(target.startsWith('apps/desktop/src/')&&source===resolve(root,target))return readFileSync(resolve(root,template),'utf8')
      return null
    },
    generateBundle(_options, bundle) {
      const root = resolve(__dirname, '../..')
      const manifest = JSON.parse(readFileSync(resolve(root, 'community/client-export-manifest.json'), 'utf8')) as {files:string[],templates?:Record<string,string>}
      // 完整开发仓库使用社区裁剪模板；独立导出中的文件已经替换，使用同一目标路径。
      const vendorTemplates = Object.fromEntries(Object.entries(manifest.templates ?? {}).filter(([,target])=>target.startsWith('apps/desktop/public/vendor/diagrams/')).map(([source,target])=>[target,source]))
      const selectedClient = [...new Set([...manifest.files,...Object.values(manifest.templates??{})])]
      const allowedApp = new Set(selectedClient.map(file => resolve(root, file)))
      const allowedCore = new Set((JSON.parse(readFileSync(resolve(root, 'community/export-manifest.json'), 'utf8')).files as string[]).map(file => resolve(root, 'packages/core', file)))
      const unreviewed:string[]=[]
      for (const id of this.getModuleIds()) {
        const source = normalizePath(id.split('?')[0])
        if (source.startsWith(resolve(root, 'private') + '/') || source.startsWith(resolve(root, 'backend') + '/')) throw new Error(`Private module in community build: ${source}`)
        if (source.startsWith(resolve(root, 'packages/core/src') + '/') && !allowedCore.has(source)) unreviewed.push(source)
        if (source.startsWith(resolve(root, 'apps/desktop/src') + '/') && !allowedApp.has(source)) unreviewed.push(source)
      }
      if(unreviewed.length)throw new Error('Unreviewed modules in community build:\n'+unreviewed.join('\n'))
      for (const file of selectedClient.filter(file => file.startsWith('apps/desktop/public/vendor/diagrams/'))) {
        const fileName = file.slice('apps/desktop/public/'.length)
        this.emitFile({type:'asset',fileName,source:readFileSync(resolve(root,vendorTemplates[file]??file))})
      }
      // Web归属原文随分发产物交付，不能只在开发仓库内保留。
      const noticeAssets:string[]=[]
      for(const file of [...new Set(['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md',...selectedClient.filter(file=>file.startsWith('docs/third-party/'))])]) {
        const template=Object.entries(manifest.templates??{}).find(([,target])=>target===file)?.[0]
        this.emitFile({type:'asset',fileName:file,source:readFileSync(resolve(root,template??file))})
        noticeAssets.push('/'+file)
      }
      // 记录本次Rollup实际纳入的依赖模块；不把安装树误称为实际分发，也不覆盖静态vendor、字体和系统库。
      const includedPackages=new Map<string,{name:string,version:string,license:unknown,modules:string[]}>()
      for(const id of this.getModuleIds()) {
        if(!this.getModuleInfo(id)?.isIncluded)continue
        const file=normalizePath(id.split('?')[0]).replace(/^\0/,'')
        const offset=file.lastIndexOf('/node_modules/')
        if(offset<0)continue
        const suffix=file.slice(offset+'/node_modules/'.length)
        const name=suffix.startsWith('@')?suffix.split('/').slice(0,2).join('/'):suffix.split('/')[0]
        const directory=file.slice(0,offset+'/node_modules/'.length)+name
        try {
          const info=JSON.parse(readFileSync(resolve(directory,'package.json'),'utf8'))
          const key=info.name+'@'+info.version
          const entry=includedPackages.get(key)??{name:info.name,version:info.version,license:info.license??null,modules:[]}
          entry.modules.push(suffix.slice(name.length+1))
          includedPackages.set(key,entry)
        }catch{throw new Error('Cannot identify included community dependency: '+suffix)}
      }
      const dependencyModules='docs/third-party/bundled-modules.json'
      this.emitFile({type:'asset',fileName:dependencyModules,source:JSON.stringify({scope:'当前Rollup纳入模块；不覆盖预编译vendor、字体、平台库或完整许可证结论',packages:[...includedPackages.values()].sort((a,b)=>a.name.localeCompare(b.name))},null,2)+'\n'})
      noticeAssets.push('/'+dependencyModules)
      const fontAssets:string[]=[]
      const fontRoot=resolve(dirname(createRequire(resolve(__dirname,'./package.json')).resolve('@excalidraw/excalidraw')),'fonts')
      function emitFonts(directory:string,prefix='') {for(const entry of readdirSync(directory,{withFileTypes:true})){const relative=prefix+entry.name;if(entry.isDirectory())emitFonts(resolve(directory,entry.name),relative+'/');else{const fileName='assets/excalidraw/fonts/'+relative;const sourcePath=relative==='Liberation/LiberationSans-Regular.woff2'?resolve(root,'apps/desktop/public/vendor/fonts/liberation-2.1.5/LiberationSans-Regular.woff2'):resolve(directory,entry.name);thisPlugin.emitFile({type:'asset',fileName,source:readFileSync(sourcePath)});fontAssets.push('/'+fileName)}}}
      const thisPlugin=this
      emitFonts(fontRoot)
      const liberationLicense='assets/excalidraw/fonts/Liberation/LICENSE.txt'
      this.emitFile({type:'asset',fileName:liberationLicense,source:readFileSync(resolve(root,'apps/desktop/public/vendor/fonts/liberation-2.1.5/source/LICENSE'))})
      fontAssets.push('/'+liberationLicense)
      // Vite emits the HTML after this hook; include the known entry explicitly.
      const assets = [...new Set(['/community.html', ...noticeAssets, ...fontAssets, ...Object.keys(bundle).map(file => `/${file}`), ...selectedClient.filter(file => file.startsWith('apps/desktop/public/vendor/diagrams/')).map(file => '/' + file.slice('apps/desktop/public/'.length))])]
      const cacheName = `noteflow-community-${createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0,16)}`
      this.emitFile({type:'asset',fileName:'community-sw.js',source:`
const CACHE = ${JSON.stringify(cacheName)};
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('noteflow-community-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method !== 'GET' || url.origin !== self.location.origin || !ASSETS.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    if(event.request.mode === 'navigate') {
      try { return await fetch(event.request); } catch { return await cache.match(url.pathname) || Response.error(); }
    }
    return await cache.match(url.pathname) || fetch(event.request);
  }));
});
`})
    },
  }],
  publicDir: false,
  build: {
    outDir: 'dist-community',
    rollupOptions: {input: resolve(__dirname, 'community.html')},
  },
  server: {port: 5176, strictPort: true},
  preview: {port: 4176, strictPort: true},
})
