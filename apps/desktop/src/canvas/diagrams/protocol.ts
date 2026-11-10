export const DIAGRAMS_PROTOCOL_VERSION=1
export const DIAGRAMS_MAX_MESSAGE_BYTES=8*1024*1024
export const DIAGRAMS_DEFAULT_TIMEOUT_MS=15_000

export type DiagramsHostAction='configure'|'load'|'export'
export type DiagramsEditorEvent='ready'|'save'|'export'|'error'|'dirty'

export interface DiagramsEnvelope {
  protocol:1
  action?:DiagramsHostAction
  event?:DiagramsEditorEvent
  nonce:string
  requestId:string
  payload?:unknown
}

export interface DiagramsSession {
  origin:string
  source:MessageEventSource
  nonce:string
  maxBytes?:number
}

const ID=/^[A-Za-z0-9_-]{12,128}$/
const inboundEvents=new Set<DiagramsEditorEvent>(['ready','save','export','error','dirty'])
const outboundActions=new Set<DiagramsHostAction>(['configure','load','export'])

function byteLength(value:unknown){return new TextEncoder().encode(JSON.stringify(value)).byteLength}
function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)}

export function createDiagramsNonce():string{
  const bytes=new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')
}

export function createDiagramsRequestId():string{return `req_${createDiagramsNonce().slice(0,24)}`}

export function validateDiagramsMessageEvent(event:Pick<MessageEvent,'origin'|'source'|'data'>,session:DiagramsSession):DiagramsEnvelope{
  if(event.origin!==session.origin)throw new Error('diagrams message origin rejected')
  if(event.source!==session.source)throw new Error('diagrams message source rejected')
  if(byteLength(event.data)>(session.maxBytes??DIAGRAMS_MAX_MESSAGE_BYTES))throw new Error('diagrams message exceeds size limit')
  if(!isRecord(event.data))throw new Error('diagrams message must be an object')
  const data=event.data
  if(data.protocol!==DIAGRAMS_PROTOCOL_VERSION)throw new Error('diagrams protocol version rejected')
  if(data.nonce!==session.nonce)throw new Error('diagrams message nonce rejected')
  if(typeof data.requestId!=='string'||!ID.test(data.requestId))throw new Error('diagrams requestId rejected')
  if(typeof data.event!=='string'||!inboundEvents.has(data.event as DiagramsEditorEvent))throw new Error('diagrams event rejected')
  if('action'in data)throw new Error('diagrams editor cannot send host actions')
  return data as unknown as DiagramsEnvelope
}

export function createDiagramsCommand(action:DiagramsHostAction,nonce:string,payload?:unknown,requestId=createDiagramsRequestId()):DiagramsEnvelope{
  if(!outboundActions.has(action))throw new Error('diagrams action rejected')
  if(!ID.test(nonce)||!ID.test(requestId))throw new Error('diagrams command identity rejected')
  const message:DiagramsEnvelope={protocol:DIAGRAMS_PROTOCOL_VERSION,action,nonce,requestId,payload}
  if(byteLength(message)>DIAGRAMS_MAX_MESSAGE_BYTES)throw new Error('diagrams command exceeds size limit')
  return message
}

export function waitForDiagramsReply<T>(requestId:string,timeoutMs=DIAGRAMS_DEFAULT_TIMEOUT_MS):{promise:Promise<T>;resolve:(value:T)=>void;reject:(reason:unknown)=>void}{
  let timer:ReturnType<typeof setTimeout>
  let resolvePromise!:(value:T)=>void,rejectPromise!:(reason:unknown)=>void
  const promise=new Promise<T>((resolve,reject)=>{resolvePromise=resolve;rejectPromise=reject;timer=setTimeout(()=>reject(new Error(`diagrams request timed out: ${requestId}`)),timeoutMs)})
  return {promise,resolve:value=>{clearTimeout(timer);resolvePromise(value)},reject:reason=>{clearTimeout(timer);rejectPromise(reason)}}
}
