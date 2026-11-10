import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {tmpdir} from 'node:os'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const target=process.env.CARGO_TARGET_DIR||path.join(tmpdir(),'noteflow-community-native-target')
const env={...process.env,CARGO_TARGET_DIR:target}
function run(command,args,cwd=root){
 const result=spawnSync(command,args,{cwd,env,stdio:'inherit',shell:false})
 if(result.error)throw result.error
 if(result.status!==0)process.exit(result.status??1)
}
const manifest=path.join(root,'packages/native-local-core/Cargo.toml')
run('cargo',['test','--locked','--manifest-path',manifest])
run('cargo',['build','--locked','--manifest-path',manifest,'--example','json_bridge'])
env.NOTEFLOW_NATIVE_LOCAL_BRIDGE=path.join(target,'debug/examples',process.platform==='win32'?'json_bridge.exe':'json_bridge')
const vitest=createRequire(path.join(root,'apps/desktop/package.json')).resolve('vitest/vitest.mjs')
run(process.execPath,[vitest,'run','--config','vitest.native.config.ts'],path.join(root,'apps/desktop'))
