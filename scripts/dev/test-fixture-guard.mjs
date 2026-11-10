import path from 'node:path'

/** 开发夹具绕过应用路由，仅允许显式启用的本机验收进程访问；不能用它承载用户登录空间。 */
export function guardTestFixtureRequest(request,response,next,{enabled=false,appRoot='' }={}){
 let pathname=(request.url||'/').split('?')[0]
 try{for(let i=0;i<3;i++){const decoded=decodeURIComponent(pathname);if(decoded===pathname)break;pathname=decoded}}catch{response.statusCode=400;response.end('Bad request');return}
 pathname=path.posix.normalize(pathname.replaceAll('\\','/'))
 const testRoot=path.resolve(appRoot,'test').replaceAll('\\','/')
 const protectedPath=pathname==='/test'||pathname.startsWith('/test/')||pathname.startsWith('/__card-demo/')||pathname.startsWith('/@fs/'+testRoot)||pathname.startsWith('/@fs'+testRoot)||pathname.includes('/test/fixtures/')||pathname.includes('/artifacts/')
 if(!protectedPath)return next()
 const remote=request.socket?.remoteAddress,loopback=remote==='127.0.0.1'||remote==='::1'||remote==='::ffff:127.0.0.1'
 if(enabled&&loopback)return next()
 response.statusCode=403;response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','text/plain; charset=utf-8');response.end('测试夹具不对外开放，请使用应用登录入口。')
}
export function testFixtureGuard(appRoot){return {name:'local-test-fixture-boundary',enforce:'pre',configureServer(server){server.middlewares.use((request,response,next)=>guardTestFixtureRequest(request,response,next,{appRoot,enabled:process.env.NOTEFLOW_ENABLE_TEST_FIXTURES==='true'}))}}}
