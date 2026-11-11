import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, validateConfig, planForDay, dayKey } from '../src/schedule.mjs';
import { Store } from '../src/store.mjs';
import { Runner } from '../src/runner.mjs';

function config(n=10){return validateConfig({...defaults,message:'测试文字\n第二行',groups:Array.from({length:n},(_,i)=>`测试群${i+1}`)});}
const at=text=>Date.parse(`2026-11-11T${text}+08:00`);
async function fixture(t,c=config()){
  const dir=await mkdtemp(join(tmpdir(),'wechat-runner-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new Store(dir);await store.init();
  let now=at('07:00:00');const calls=[];
  const runner=new Runner({store,clock:()=>now,send:async(group)=>{calls.push(group.name);}});
  return {dir,store,runner,calls,c,setNow:value=>{now=at(value);}};
}

test('默认10群：14轮140条，07:00开始，20:09结束',()=>{
  const tasks=planForDay(config(),'2026-11-11');assert.equal(tasks.length,140);
  assert.equal(tasks[0].at,at('07:00:00'));assert.equal(tasks.at(-1).at,at('20:09:00'));
  assert.equal(tasks[9].at-tasks[8].at,60_000);assert.equal(new Set(tasks.map(t=>t.key)).size,140);
});
test('跨UTC日期仍按北京时间取日期',()=>{
  assert.equal(dayKey(new Date('2026-11-10T23:00:00Z')),'2026-11-11');
  assert.equal(dayKey(new Date('2026-11-11T16:00:00Z')),'2026-11-12');
});
test('拒绝重复群、跨整点重叠、非法配置',()=>{
  assert.throws(()=>validateConfig({...defaults,groups:['a',' a ']}),/重复/);
  assert.throws(()=>validateConfig({...config(30),intervalSeconds:1800}),/下一轮/);
  assert.throws(()=>validateConfig({...defaults,startHour:20,endHour:7}),/时间范围/);
  assert.throws(()=>validateConfig({...defaults,intervalSeconds:0}),/1–1800/);
  assert.throws(()=>validateConfig({...defaults,message:'a\0b'}),/空字符/);
});
test('模拟执行不调用微信，重复tick只记录一次',async t=>{
  const f=await fixture(t);f.runner.start(f.c,'dry');
  await f.runner.tick();await f.runner.tick();
  assert.equal(f.calls.length,0);assert.equal(Object.values(f.store.records).filter(r=>r.status==='simulated').length,1);
});
test('真实发送前已持久化预留，防止崩溃后重发',async t=>{
  const f=await fixture(t);let checked=false;
  f.runner.send=async()=>{
    const records=JSON.parse(await readFile(join(f.dir,'state.json'),'utf8'));
    assert.equal(Object.values(records)[0].status,'in_progress');checked=true;
  };
  f.runner.start(f.c,'real');await f.runner.tick();assert.equal(checked,true);
  const restarted=new Store(f.dir);await restarted.init();let duplicate=false;
  const next=new Runner({store:restarted,clock:()=>at('07:00:20'),send:async()=>{duplicate=true;}});
  next.start(f.c,'real');await next.tick();assert.equal(duplicate,false);
});
test('已预留但结果未知的任务不会自动重发',async t=>{
  const f=await fixture(t);const task=planForDay(f.c,'2026-11-11')[0];
  await f.store.record(`real/${task.key}`,{mode:'real',status:'in_progress',attemptedAt:at('07:00:00')});
  f.runner.start(f.c,'real');await f.runner.tick();assert.deepEqual(f.calls,[]);
});
test('07:05启动跳过前面5群，只执行当前群，不集中补发',async t=>{
  const f=await fixture(t);f.setNow('07:05:00');f.runner.start(f.c,'real');await f.runner.tick();
  assert.deepEqual(f.calls,['测试群6']);
  assert.equal(Object.values(f.store.records).filter(r=>r.status==='skipped').length,5);
});
test('第一群迟到30秒，第二群仍至少间隔60秒',async t=>{
  const f=await fixture(t);f.setNow('07:00:30');f.runner.start(f.c,'real');await f.runner.tick();
  f.setNow('07:01:00');await f.runner.tick();assert.equal(f.calls.length,1);
  f.setNow('07:01:30');await f.runner.tick();assert.deepEqual(f.calls,['测试群1','测试群2']);
});
test('错过45秒后跳过，而不是发送迟到消息',async t=>{
  const f=await fixture(t);f.setNow('07:00:46');f.runner.start(f.c,'real');await f.runner.tick();
  assert.deepEqual(f.calls,[]);assert.equal(Object.values(f.store.records)[0].status,'skipped');
});
test('20:09后仍会发完最后群，20:10以后没有新任务',async t=>{
  const f=await fixture(t);f.setNow('20:09:00');f.runner.start(f.c,'real');await f.runner.tick();
  assert.deepEqual(f.calls,['测试群10']);f.setNow('20:10:00');await f.runner.tick();assert.equal(f.calls.length,1);
});
test('异常停止整项任务，不重试当前群，也不继续后面的群',async t=>{
  const f=await fixture(t);let calls=0;
  f.runner.send=async()=>{calls++;throw new Error('群标题不匹配');};
  f.runner.start(f.c,'real');await f.runner.tick();
  assert.equal(f.runner.running,false);assert.match(f.runner.error,/群标题/);
  assert.equal(Object.values(f.store.records)[0].status,'uncertain');
  f.setNow('07:01:00');await f.runner.tick();assert.equal(calls,1);
});
test('并发tick只运行一个发送',async t=>{
  const f=await fixture(t);let release;let entered;
  const enteredPromise=new Promise(r=>{entered=r;});
  f.runner.send=async()=>{f.calls.push('send');entered();await new Promise(r=>{release=r;});};
  f.runner.start(f.c,'real');const first=f.runner.tick();await enteredPromise;
  await f.runner.tick();assert.equal(f.calls.length,1);release();await first;
});
test('停止会取消正在进行的操作并保留未知状态',async t=>{
  const f=await fixture(t);let entered;
  const enteredPromise=new Promise(r=>{entered=r;});
  f.runner.send=(_g,_c,signal)=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new Error('操作已中止')),{once:true});entered();
  });
  f.runner.start(f.c,'real');const tick=f.runner.tick();await enteredPromise;
  f.runner.stop();await tick;assert.equal(f.runner.running,false);
  assert.equal(Object.values(f.store.records)[0].status,'uncertain');
});
test('切换模拟模式不丢失真实模式的最后执行时间',async t=>{
  const f=await fixture(t);f.setNow('07:00:30');f.runner.start(f.c,'real');await f.runner.tick();f.runner.stop();
  f.runner.start(f.c,'dry');f.runner.stop();f.runner.start(f.c,'real');
  f.setNow('07:01:00');await f.runner.tick();assert.equal(f.calls.length,1);
  f.setNow('07:01:30');await f.runner.tick();assert.equal(f.calls.length,2);
});
test('模拟记录不会阻止同一时间点真实执行',async t=>{
  const f=await fixture(t);f.runner.start(f.c,'dry');await f.runner.tick();f.runner.stop();
  f.runner.start(f.c,'real');await f.runner.tick();assert.equal(f.calls.length,1);
});
test('损坏的状态文件不能静默清空后启动',async t=>{
  const f=await fixture(t);await writeFile(join(f.dir,'state.json'),'{broken');
  await assert.rejects(()=>new Store(f.dir).init(),SyntaxError);
});
test('配置布局必须有完整标题、输入区域和有效点击点',()=>{
  const layout={width:1000,height:800,title:{x:300,y:30,width:200,height:30},draft:{x:300,y:600,width:600,height:100},neutral:{x:900,y:40},editor:{x:350,y:650},send:{x:900,y:750}};
  assert.deepEqual(validateConfig({...defaults,layout}).layout,layout);
  assert.throws(()=>validateConfig({...defaults,layout:{...layout,editor:{x:3,y:3}}}),/输入点击点/);
  assert.throws(()=>validateConfig({...defaults,layout:{...layout,neutral:{x:330,y:40}}}),/标题框/);
});

test('旧配置兼容：没有分钟和单位时仍按整点每小时执行，保留原去重键',()=>{
  const c=validateConfig({startHour:7,endHour:20,groups:['旧群'],message:'旧文案'});
  assert.equal(c.startMinute,0);assert.equal(c.endMinute,0);assert.equal(c.roundUnit,'hour');
  assert.equal(planForDay(c,'2026-11-11')[0].key,`2026-11-11/7/${c.groups[0].id}`);
});
test('按小时保留起始分钟，以结束时间为轮次启动上限',()=>{
  const c=validateConfig({...config(2),startMinute:35,endHour:9,endMinute:40});
  const tasks=planForDay(c,'2026-11-11');assert.equal(tasks.length,6);
  assert.equal(tasks[0].at,at('07:35:00'));assert.equal(tasks[2].at,at('08:35:00'));
  assert.equal(tasks.at(-1).at,at('09:36:00'));assert.equal(tasks.at(-1).roundLabel,'09:35');
});
test('按分钟每分钟一轮，包含结束分钟，轮内按秒偏移',()=>{
  const c=validateConfig({...config(3),roundUnit:'minute',startMinute:35,endHour:7,endMinute:37,intervalSeconds:5});
  const tasks=planForDay(c,'2026-11-11');assert.equal(tasks.length,9);
  assert.equal(tasks[0].at,at('07:35:00'));assert.equal(tasks[3].at,at('07:36:00'));
  assert.equal(tasks.at(-1).at,at('07:37:10'));assert.equal(new Set(tasks.map(t=>t.key)).size,9);
});
test('按分钟跨小时排列，小时模式切换后同一轮保持同一去重键',()=>{
  const c=validateConfig({...config(1),roundUnit:'minute',startHour:7,startMinute:59,endHour:8,endMinute:1});
  const tasks=planForDay(c,'2026-11-11');assert.equal(tasks.length,3);assert.equal(tasks[1].at,at('08:00:00'));
  const hourly=planForDay(validateConfig({...config(1),startHour:8,endHour:8}),'2026-11-11')[0];
  assert.equal(tasks[1].key,hourly.key);
});
test('校验分钟范围、同日时间、轮次重叠及跨午夜尾部',()=>{
  assert.throws(()=>validateConfig({...config(),roundUnit:'minute'}),/少于60秒/);
  assert.doesNotThrow(()=>validateConfig({...config(),roundUnit:'minute',intervalSeconds:5}));
  assert.throws(()=>validateConfig({...config(),startMinute:60}),/时间范围/);
  assert.throws(()=>validateConfig({...config(),startHour:7,startMinute:35,endHour:7,endMinute:34}),/时间范围/);
  assert.throws(()=>validateConfig({...config(2),startHour:23,startMinute:59,endHour:23,endMinute:59}),/跨到次日/);
  assert.throws(()=>validateConfig({...config(),roundUnit:'seconds'}),/轮次单位/);
});
test('分钟模式不会补发上轮过期群，当前轮照常执行',async t=>{
  const c=validateConfig({...config(2),roundUnit:'minute',intervalSeconds:5});
  const f=await fixture(t,c);f.runner.start(c,'real');await f.runner.tick();
  f.setNow('07:01:00');await f.runner.tick();assert.deepEqual(f.calls,['测试群1','测试群1']);
  assert.equal(Object.values(f.store.records).filter(r=>r.status==='skipped').length,1);
});
test('手动发送不受每天时段限制，按间隔执行一轮后自动停止',async t=>{
  const f=await fixture(t,config(2));f.setNow('21:00:00');
  f.runner.startManual(f.c,'real','manual-request-0001');await f.runner.tick();assert.deepEqual(f.calls,['测试群1']);
  assert.equal(f.runner.status().kind,'manual');assert.equal(f.runner.running,true);
  assert.equal(f.runner.status().progress.completed,1);assert.equal(f.runner.status().progress.nextGroup,'测试群2');
  assert.equal(f.runner.status().progress.nextAt,at('21:01:00'));
  f.setNow('21:00:59');await f.runner.tick();assert.equal(f.calls.length,1);
  f.setNow('21:01:00');await f.runner.tick();assert.deepEqual(f.calls,['测试群1','测试群2']);
  assert.equal(f.runner.running,false);assert.match(f.store.logs.at(-1).message,/手动一轮已完成/);
  assert.equal(f.runner.status().progress.completed,2);assert.equal(f.runner.status().progress.nextGroup,null);
});
test('手动模拟不操作微信，迟到也继续处理本轮剩余群',async t=>{
  const f=await fixture(t,validateConfig({...config(2),intervalSeconds:1}));
  f.runner.startManual(f.c,'dry','manual-request-0002');await f.runner.tick();
  f.setNow('07:03:00');await f.runner.tick();assert.deepEqual(f.calls,[]);
  assert.equal(Object.values(f.store.records).filter(r=>r.status==='simulated').length,2);
  assert.equal(f.runner.running,false);
});
test('手动请求重复提交或重启后重提同一标识，不会再次发送',async t=>{
  const f=await fixture(t,config(1));f.runner.startManual(f.c,'real','manual-request-0003');await f.runner.tick();
  assert.throws(()=>f.runner.startManual(f.c,'real','manual-request-0003'),/已经执行或中断/);
  const restored=new Store(f.dir);await restored.init();
  const next=new Runner({store:restored,send:async()=>{throw new Error('不应该调用');}});
  assert.throws(()=>next.startManual(f.c,'real','manual-request-0003'),/已经执行或中断/);
  assert.equal(f.calls.length,1);
});
test('手动与定时互斥，手动异常立即停止剩余发送',async t=>{
  const f=await fixture(t,config(2));f.runner.startManual(f.c,'real','manual-request-0004');
  assert.throws(()=>f.runner.start(f.c,'dry'),/请先停止/);
  f.runner.send=async()=>{throw new Error('手动群标题不匹配');};await f.runner.tick();
  assert.equal(f.runner.running,false);assert.match(f.runner.error,/不匹配/);
  assert.equal(Object.values(f.store.records).filter(r=>r.status==='uncertain').length,1);
});
