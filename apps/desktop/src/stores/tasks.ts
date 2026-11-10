import {accountLifecycleRevision} from '../services/accountStorage'
import { defineStore } from 'pinia'
import { tasksService, taskDataScope, type TaskEntity } from '../services/tasks'

function captureTaskBinding(loadedScope:string,loadedSession:number){const scope=taskDataScope(),session=accountLifecycleRevision();if(loadedScope&&loadedScope!==scope||loadedSession>=0&&loadedSession!==session)throw Error('任务列表属于已切换的账号或空间，请先重新加载');return()=>{if(scope!==taskDataScope()||session!==accountLifecycleRevision())throw Error('任务请求所属账号或空间已切换，请回原空间核对结果')}}
const requests=new WeakMap<object,{scope:string;session:number;promise:Promise<void>}>()

export const useTasksStore = defineStore('tasks', {
  state: () => ({ tasks: [] as TaskEntity[], loading: false, refreshing:false, error: '', loadedAt:0, loadedScope:'',loadedSession:-1, revision:0 }),
  actions: {
    async load(options:{force?:boolean}={}) {
      const scope=taskDataScope(),session=accountLifecycleRevision()
      if(this.loadedScope!==scope||this.loadedSession!==session){this.tasks=[];this.loadedAt=0;this.loadedScope=scope;this.loadedSession=session;this.revision++}
      const pending=requests.get(this)
      if(pending?.scope===scope&&pending.session===session)return pending.promise
      if(!options.force&&this.loadedAt&&Date.now()-this.loadedAt<5000)return
      const revision=this.revision
      this.loading=!this.loadedAt;this.refreshing=true;this.error=''
      const request={scope,session,promise:Promise.resolve()}
      request.promise=(async()=>{
        try{
          const values=await tasksService.list()
          if(session===accountLifecycleRevision()&&scope===taskDataScope()&&scope===this.loadedScope&&revision===this.revision){this.tasks=values;this.loadedAt=Date.now()}
        }catch(source){if(session===accountLifecycleRevision()&&scope===this.loadedScope)this.error=source instanceof Error?source.message:'任务加载失败'}
        finally{if(requests.get(this)===request){this.loading=false;this.refreshing=false;requests.delete(this)}}
      })()
      requests.set(this,request)
      return request.promise
    },
    acceptBackgroundRefresh(tasks:TaskEntity[]){this.revision++;this.tasks=tasks;this.loadedScope=taskDataScope();this.loadedSession=accountLifecycleRevision();this.loadedAt=Date.now();this.error=''},
    async create(task: Partial<TaskEntity>) { const assertBinding=captureTaskBinding(this.loadedScope,this.loadedSession); const saved = await tasksService.create(task); assertBinding();this.revision++;this.loadedAt=0; this.tasks.unshift(saved); return saved },
    async update(task: TaskEntity) { const assertBinding=captureTaskBinding(this.loadedScope,this.loadedSession); const saved = await tasksService.update(task); assertBinding();this.revision++;this.loadedAt=0; const index = this.tasks.findIndex(item => item.uid === saved.uid); if (index >= 0) this.tasks[index] = saved; return saved },
    async complete(task: TaskEntity, completed: boolean) { const assertBinding=captureTaskBinding(this.loadedScope,this.loadedSession); const saved = await tasksService.complete(task, completed); assertBinding();this.revision++;this.loadedAt=0; const index = this.tasks.findIndex(item => item.uid === saved.uid); if (index >= 0) this.tasks[index] = saved },
    async organize(task: TaskEntity, tagIds: number[]) { const assertBinding=captureTaskBinding(this.loadedScope,this.loadedSession); const saved = await tasksService.organize(task, tagIds); assertBinding();this.revision++;this.loadedAt=0; const index = this.tasks.findIndex(item => item.uid === saved.uid); if (index >= 0) this.tasks[index] = saved; return saved },
    async remove(task: TaskEntity) { const assertBinding=captureTaskBinding(this.loadedScope,this.loadedSession); await tasksService.remove(task); assertBinding();this.revision++;this.loadedAt=0; this.tasks = this.tasks.filter(item => item.uid !== task.uid) }
  }
})
