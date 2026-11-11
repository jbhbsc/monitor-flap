import { dayKey, planForDay } from './schedule.mjs';

export class Runner {
  constructor({store, send, clock = () => Date.now()}) {
    this.store=store; this.send=send; this.clock=clock;
    this.running=false; this.busy=false; this.mode='dry'; this.lastAttempt=0;
    this.error=null; this.abort=null; this.lastRealAttempt=0;
    this.kind='scheduled'; this.manualTasks=null;
    for (const r of Object.values(store.records)) {
      if (r.mode === 'real' && r.attemptedAt) this.lastRealAttempt=Math.max(this.lastRealAttempt,r.attemptedAt);
    }
  }
  start(config,mode) {
    if (this.running || this.busy) throw new Error('请先停止当前任务');
    if (!config.groups.length || !config.message.trim()) throw new Error('请先填写群名和发送文案');
    if (!['dry','real'].includes(mode)) throw new Error('模式无效');
    this.config=structuredClone(config); this.mode=mode; this.error=null; this.running=true;
    this.kind='scheduled';this.manualTasks=null;
    this.startedAt=this.clock();
    this.lastAttempt=mode==='real' ? this.lastRealAttempt : 0;
  }
  startManual(config,mode,requestId) {
    if(typeof requestId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(requestId))throw new Error('手动任务标识无效，请重新打开确认窗口');
    const prefix=`${mode}/manual/${requestId}/`;
    if(Object.keys(this.store.records).some(k=>k.startsWith(prefix)))throw new Error('这次手动任务已经执行或中断，不能重复提交；请核查日志');
    this.start(config,mode);
    this.kind='manual';
    this.manualTasks=this.config.groups.map((group,index)=>({
      key:`manual/${requestId}/${group.id}`,group,at:this.startedAt+index*config.intervalSeconds*1000,
    }));
  }
  stop() {
    this.running=false;
    this.abort?.abort();
  }
  async tick() {
    if (!this.running || this.busy) return;
    this.busy=true;
    try {
      const now=this.clock();
      const plan=this.kind==='manual'?this.manualTasks:planForDay(this.config,dayKey(new Date(now)));
      if(this.kind==='scheduled'){
        const expired=plan.filter(t=>t.at<=now&&now-t.at>this.config.graceSeconds*1000&&!this.store.records[`${this.mode}/${t.key}`]);
        await this.store.recordMany(expired.map(t=>[`${this.mode}/${t.key}`,{status:'skipped',mode:this.mode,group:t.group.name,scheduledAt:t.at}]));
      }
      for (const task of plan) {
        if (!this.running) break;
        if (task.at > now) break;
        const key=`${this.mode}/${task.key}`;
        if (this.store.records[key]) continue;
        if (now-this.lastAttempt < this.config.intervalSeconds*1000) break;
        // Durable reservation BEFORE any UI action. Unknown results are never retried.
        await this.store.record(key,{status:'in_progress',mode:this.mode,kind:this.kind,group:task.group.name,scheduledAt:task.at,attemptedAt:now});
        this.lastAttempt=now;
        if(this.mode==='real')this.lastRealAttempt=now;
        this.abort=new AbortController();
        try {
          if (this.running && this.mode==='real') await this.send(task.group,this.config,this.abort.signal);
          else if (!this.running) throw new Error('任务已停止');
          const status=this.mode==='dry' ? 'simulated' : 'submitted_unverified';
          await this.store.record(key,{...this.store.records[key],status});
          await this.store.log('info',(this.kind==='manual'?'手动 · ':'')+(this.mode==='dry'?'模拟执行（未操作微信）':'已执行发送，送达未核验'),{group:task.group.name,scheduledAt:task.at});
        } catch (error) {
          await this.store.record(key,{...this.store.records[key],status:'uncertain',error:error.message});
          throw error;
        } finally { this.abort=null; }
        break;
      }
      if(this.running&&this.kind==='manual'&&plan.every(t=>this.store.records[`${this.mode}/${t.key}`])){
        this.running=false;
        await this.store.log('info',`手动一轮已完成：${plan.length} 个群${this.mode==='dry'?'（模拟，未操作微信）':'，送达未核验'}`);
      }
    } catch (e) {
      this.running=false; this.error=e.message;
      await this.store.log('error',`任务已停止：${e.message}`).catch(()=>{});
    } finally { this.busy=false; }
  }
  status() {
    let progress=null;
    if(this.kind==='manual'&&this.manualTasks){
      const entries=this.manualTasks.map(task=>({task,record:this.store.records[`${this.mode}/${task.key}`]}));
      const completed=entries.filter(({record})=>['simulated','submitted_unverified'].includes(record?.status)).length;
      const active=entries.find(({record})=>record?.status==='in_progress');
      const uncertain=entries.find(({record})=>record?.status==='uncertain');
      const next=entries.find(({record})=>!record);
      progress={total:entries.length,completed,currentGroup:active?.task.group.name??null,
        failedGroup:uncertain?.task.group.name??null,nextGroup:next?.task.group.name??null,
        nextAt:next?Math.max(next.task.at,this.lastAttempt+this.config.intervalSeconds*1000):null,
        updatedAt:this.clock()};
    }
    return {running:this.running,busy:this.busy,mode:this.mode,kind:this.kind,error:this.error,progress};
  }
}
