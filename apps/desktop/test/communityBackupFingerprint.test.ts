import {describe, expect, it} from 'vitest'
import {fingerprintBackupValue as fingerprint} from '../src/community/backupFingerprint'

function streamedBlob(bytes: Uint8Array, chunkSize: number, declaredBytes = bytes.byteLength) {
  const blob = new Blob([new Uint8Array(declaredBytes)], {type:'application/octet-stream'})
  Object.defineProperty(blob, 'arrayBuffer', {value:()=>{throw Error('Whole attachment read forbidden')}})
  Object.defineProperty(blob, 'stream', {value:()=>{
    let offset = 0
    return new ReadableStream<Uint8Array>({pull(controller) {
      if (offset >= bytes.length) {controller.close(); return}
      controller.enqueue(bytes.subarray(offset, offset + chunkSize)); offset += chunkSize
    }})
  }})
  return blob
}
describe('community backup streaming comparison', () => {
 it('streams an 8 MiB synthetic attachment without whole-file arrayBuffer and ignores stream chunk boundaries', async () => {
  const bytes = new Uint8Array(8 * 1024 * 1024)
  bytes[0] = 17; bytes[bytes.length - 1] = 93
  const first = await fingerprint({file:streamedBlob(bytes, 16384)})
  expect(await fingerprint({file:streamedBlob(bytes, 65537)})).toBe(first)
  bytes[bytes.length - 1] = 94
  expect(await fingerprint({file:streamedBlob(bytes, 32768)})).not.toBe(first)
 })
 it('retains value types, array boundaries, unknown keys and actual typed-array slices', async () => {
  const values = [null, undefined, false, 'false', 1, '1', 1n, [], {}, [1,2], ['1','2'], new Uint8Array([1,2]), new Uint8Array([1,2]).buffer, new Blob([new Uint8Array([1,2])]), new Date('2026-10-16T00:00:00Z')]
  const hashes = await Promise.all(values.map(fingerprint))
  expect(new Set(hashes).size).toBe(values.length)
  expect(await fingerprint({b:2, a:'中文'})).toBe(await fingerprint({a:'中文', b:2}))
  expect(await fingerprint(new Uint8Array([0,1,2,3]).subarray(1,3))).toBe(await fingerprint(new Uint8Array([1,2])))
  expect(await fingerprint(JSON.parse('{"__proto__":"data"}'))).not.toBe(await fingerprint({}))
 })
 it('rejects truncated and excessive streams, cycles, nonfinite values and unsupported objects', async () => {
  await expect(fingerprint(streamedBlob(new Uint8Array([1,2]), 1, 3))).rejects.toThrow('读取不完整')
  await expect(fingerprint(streamedBlob(new Uint8Array([1,2,3]), 2, 2))).rejects.toThrow('长度异常')
  const cycle: Record<string,unknown> = {}; cycle.self = cycle
  await expect(fingerprint(cycle)).rejects.toThrow('循环引用')
  await expect(fingerprint(Infinity)).rejects.toThrow('不支持')
  await expect(fingerprint(new Map())).rejects.toThrow('非普通对象')
  const shared = {kept:true}
  expect(await fingerprint([shared,shared])).toBe(await fingerprint([{kept:true},{kept:true}]))
 })
})
