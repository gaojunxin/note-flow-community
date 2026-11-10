import {readFileSync,readdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
import type {Plugin} from 'vite'

export function pdfAssets():Plugin{
  const assets=new Map<string,string>()
  // npm工作区会提升依赖，按模块解析定位，不能假定应用有独立node_modules。
  const packageUrl=pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  assets.set('/pdfjs/LICENSE',fileURLToPath(new URL('LICENSE',packageUrl)))
  for(const directory of ['cmaps','standard_fonts','wasm']){
    const root=new URL(`${directory}/`,packageUrl)
    for(const entry of readdirSync(root,{withFileTypes:true})){
      if(!entry.isFile())continue
      const name=entry.name
      assets.set(`/pdfjs/${directory}/${name}`,fileURLToPath(new URL(name,root)))
    }
  }
  return{
    name:'pdf-preview-assets',
    configureServer(server){server.middlewares.use((request,response,next)=>{
      const route=request.url?.split('?')[0]||'',path=assets.get(route)
      if(!path)return next()
      response.setHeader('Content-Type',route.endsWith('.wasm')?'application/wasm':route.endsWith('.js')?'text/javascript':'application/octet-stream')
      response.end(readFileSync(path))
    })},
    generateBundle(){for(const [route,path] of assets)this.emitFile({type:'asset',fileName:route.slice(1),source:readFileSync(path)})}
  }
}
