import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const read=file=>readFileSync(path.join(root,file),'utf8')
const version=JSON.parse(read('version.json')).version
for(const file of ['package.json','apps/desktop/package.json','apps/desktop/src-tauri/tauri.conf.json']){
 if(JSON.parse(read(file)).version!==version)throw Error(`Version mismatch: ${file}`)
}
const cargo=read('apps/desktop/src-tauri/Cargo.toml').match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1]
const locked=read('apps/desktop/src-tauri/Cargo.lock').match(/\[\[package\]\]\r?\nname = "note-flow-community-desktop"\r?\nversion = "([^"]+)"/)?.[1]
if(cargo!==version||locked!==version)throw Error('Community Cargo version mismatch')
console.log(`Community version consistent: ${version}`)
