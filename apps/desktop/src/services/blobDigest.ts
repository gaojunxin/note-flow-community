import {digest as sha256} from 'lib0/hash/sha256'
/** Hashing files also works in LAN HTTP browsers without SubtleCrypto. */
export async function blobDigest(blob:Blob){
 const bytes=await blob.arrayBuffer()
 const result=globalThis.crypto?.subtle?new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)):sha256(new Uint8Array(bytes))
 return Array.from(result,value=>value.toString(16).padStart(2,'0')).join('')
}
