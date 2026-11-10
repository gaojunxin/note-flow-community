import 'fake-indexeddb/auto'
import {afterEach, describe, expect, it} from 'vitest'
import {deleteDB} from 'idb'
import {createCommunityTasks, nextBasicOccurrence, parseBasicRepeatRule, basicOccurrenceUid} from '@note-flow/core/community'
import {createIndexedDbLocalHost} from '@note-flow/core/local-storage-web'
const context = {profileId: 'local', storageSchemaVersion: 1}
const source = {uid: 'source', startAt: '2024-01-31T09:00:00', dueAt: '2024-01-31T10:00:00', timezone: 'Asia/Shanghai', recurrenceRule: JSON.stringify({frequency: 'monthly', interval: 1})}
const resources: Array<{name: string; host: ReturnType<typeof createIndexedDbLocalHost>}> = []
afterEach(async () => {for (const {name, host} of resources.splice(0)) {await host.close(); await deleteDB(name)}})
describe('community basic recurrence', () => {
 it('retains monthly source anchor, duration and stable occurrence identity', async () => {
  const feb = nextBasicOccurrence(source, source)!
  expect(feb).toMatchObject({startAt: '2024-02-29T09:00:00', dueAt: '2024-02-29T10:00:00', ordinal: 2})
  const march = nextBasicOccurrence({...source, ...feb, uid: 'feb', recurrenceOrdinal: feb.ordinal, recurrenceOccurrenceKey: feb.occurrenceKey}, source)!
  expect(march.startAt).toBe('2024-03-31T09:00:00')
  expect(await basicOccurrenceUid('source', feb.occurrenceKey)).toBe(await basicOccurrenceUid('source', feb.occurrenceKey))
  expect(await basicOccurrenceUid('source', feb.occurrenceKey)).not.toBe(await basicOccurrenceUid('other', feb.occurrenceKey))
 })
 it('honors count/endDate, weekdays, all-day and invalid/unsupported rules', () => {
  const yearly = {...source, startAt: '2024-02-29', dueAt: null, allDay: true, recurrenceRule: JSON.stringify({frequency: 'yearly', interval: 1})}
  expect(nextBasicOccurrence(yearly, yearly)?.startAt).toBe('2025-02-28')
  const weekday = {...source, startAt: '2026-10-09T09:00:00', dueAt: null, recurrenceRule: JSON.stringify({frequency: 'weekdays', interval: 1})}
  expect(nextBasicOccurrence(weekday, weekday)?.startAt).toBe('2026-10-12T09:00:00')
  for (const extra of [{count: 1}, {endDate: '2024-02-28'}]) expect(nextBasicOccurrence({...source, recurrenceRule: JSON.stringify({frequency: 'monthly', interval: 1, ...extra})}, source)).toBeUndefined()
  expect(() => parseBasicRepeatRule(JSON.stringify({frequency:'yearly',interval:1,calendar:'lunar'}))).toThrow(expect.objectContaining({code:'CAPABILITY_UNAVAILABLE'}))
  expect(() => parseBasicRepeatRule(JSON.stringify({frequency:'daily',interval:1,unknownPolicy:true}))).toThrow(expect.objectContaining({code:'CAPABILITY_UNAVAILABLE'}))
  expect(() => nextBasicOccurrence({...source,startAt:'2024-02-30'},source)).toThrow()
 })
 it('keeps wall time across DST and rejects nonexistent time without guessing', () => {
  const spring = {...source,startAt:'2026-03-07T09:00:00',dueAt:null,timezone:'America/New_York',recurrenceRule:JSON.stringify({frequency:'daily',interval:1})}
  expect(nextBasicOccurrence(spring,spring)?.startAt).toBe('2026-03-08T09:00:00')
  expect(() => nextBasicOccurrence({...spring,startAt:'2026-03-07T02:30:00'},spring)).toThrow('夏令时')
 })
 it('completes/skips and creates actual next tasks with logs in one transaction', async () => {
  const name = `community-tasks-${crypto.randomUUID()}`, host = createIndexedDbLocalHost(name)
  resources.push({name,host})
  const tasks = createCommunityTasks(host,context)
  const initial = await tasks.create({...source,recurrenceRule:JSON.stringify({frequency:'monthly',interval:1,count:3})})
  const feb = await tasks.resolve(initial.entity.uid,initial.revision,'complete')
  expect(feb.next?.entity.startAt).toBe('2024-02-29T09:00:00')
  const march = await tasks.resolve(feb.next!.entity.uid,feb.next!.revision,'skip')
  expect(march.next?.entity.startAt).toBe('2024-03-31T09:00:00')
  expect((await tasks.resolve(march.next!.entity.uid,march.next!.revision,'complete')).next).toBeUndefined()
  expect((await tasks.list()).items).toHaveLength(3)
  expect((await host.listChanges(context)).items).toHaveLength(6)
 })
 it('preserves original task on unsupported rule and stale completion', async () => {
  const name = `community-tasks-${crypto.randomUUID()}`, host = createIndexedDbLocalHost(name)
  resources.push({name,host}); const tasks = createCommunityTasks(host,context)
  const task = await tasks.create({...source,recurrenceRule:JSON.stringify({frequency:'yearly',interval:1,calendar:'lunar'})})
  await expect(tasks.resolve(task.entity.uid,task.revision,'complete')).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'})
  expect((await tasks.get(task.entity.uid))?.entity.completed).toBeUndefined()
  expect((await host.listChanges(context)).items).toHaveLength(1)
  await expect(tasks.resolve(task.entity.uid,'stale','complete')).rejects.toMatchObject({code:'REVISION_CONFLICT'})
 })
})

it('protects original advanced bytes, explicit conversion backups and full export', async () => {
 const name = `community-rules-${crypto.randomUUID()}`, host = createIndexedDbLocalHost(name)
 resources.push({name,host}); const tasks = createCommunityTasks(host,context)
 const raw = ' {"frequency":"yearly", "interval":1,"calendar":"lunar","future":{"keep":true}} '
 const original = await tasks.create({...source, recurrenceRule:raw,recurrenceSourceUid:'legacy-series',recurrenceOccurrenceKey:'2024-01-31T09:00:00@Asia/Shanghai',recurrenceOrdinal:7,unknownField:{retain:42}})
 const ordinary = await tasks.convertToOrdinary(original.entity.uid,original.revision)
 expect(ordinary.entity.recurrenceRule).toBeNull()
 expect(ordinary.entity.unknownField).toEqual({retain:42})
 expect(ordinary.entity.recurrenceOriginalBackups).toEqual([{recurrenceRule:raw,recurrenceSourceUid:'legacy-series',recurrenceOccurrenceKey:'2024-01-31T09:00:00@Asia/Shanghai',recurrenceOrdinal:7}])
 const snapshot = await host.exportWorkspace(context)
 expect(JSON.stringify(snapshot)).toContain('recurrenceOriginalBackups')
 expect((await tasks.get(original.entity.uid))?.entity.recurrenceOriginalBackups).toEqual(ordinary.entity.recurrenceOriginalBackups)
 await expect(tasks.convertToOrdinary(original.entity.uid,original.revision)).rejects.toMatchObject({code:'REVISION_CONFLICT'})
})
it('rejects later pre-generated history before first open occurrence without writes',async()=>{
 const name=`community-history-${crypto.randomUUID()}`,host=createIndexedDbLocalHost(name)
 resources.push({name,host});const tasks=createCommunityTasks(host,context)
 await tasks.create({...source})
 const later=await tasks.create({...source,uid:'later',recurrenceSourceUid:source.uid,startAt:'2024-02-29T09:00:00',recurrenceOrdinal:2})
 await expect(tasks.resolve(later.entity.uid,later.revision,'skip')).rejects.toMatchObject({code:'INVALID_CHANGE'})
 expect((await tasks.get(later.entity.uid))?.entity.abandonedAt).toBeUndefined()
 expect((await host.listChanges(context)).items).toHaveLength(2)
})
it('rejects saving calendar-only projections',async()=>{
 const name=`community-preview-${crypto.randomUUID()}`,host=createIndexedDbLocalHost(name)
 resources.push({name,host});const tasks=createCommunityTasks(host,context)
 await expect(tasks.create({...source,recurrencePreview:true})).rejects.toMatchObject({code:'INVALID_CHANGE'})
 expect((await tasks.list()).items).toHaveLength(0)
 expect((await host.listChanges(context)).items).toHaveLength(0)
})
