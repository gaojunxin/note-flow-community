/** 在 PDF.js 执行前补齐旧版 WKWebView 的 Promise 能力；页面与 worker 各自安装。 */
export function installPdfPromiseCompatibility(){
  const constructor=Promise as PromiseConstructor & {withResolvers?:unknown}
  if(typeof constructor.withResolvers==='function')return
  Object.defineProperty(constructor,'withResolvers',{
    configurable:true,writable:true,
    value:function<T>(this:PromiseConstructor){
      let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(reason?:unknown)=>void
      // 使用调用方构造器，保持 Promise 子类的构造及结算语义；不覆盖已有原生实现。
      const promise=new this<T>((accept,fail)=>{resolve=accept;reject=fail})
      return{promise,resolve,reject}
    },
  })
}

installPdfPromiseCompatibility()
