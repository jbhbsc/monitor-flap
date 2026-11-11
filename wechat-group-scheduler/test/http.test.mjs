import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { layoutHash } from '../src/schedule.mjs';

test('本地HTTP：配置、模拟启动、停止、跨站保护和缺少绑定时拒绝真实发送',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wechat-http-'));
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
  const port=socket.address().port;await new Promise(r=>socket.close(r));
  const origin=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],{
    env:{...process.env,WECHAT_DATA_DIR:dir,WECHAT_PORT:String(port)},stdio:['ignore','pipe','pipe'],windowsHide:true,
  });
  let output='';child.stdout.on('data',s=>{output+=s;});child.stderr.on('data',s=>{output+=s;});
  t.after(async()=>{
    const closed=new Promise(r=>child.once('close',r));child.kill();await closed;
    await rm(dir,{recursive:true,force:true});
  });
  let ready=false;
  for(let i=0;i<100;i++){
    try{const res=await fetch(origin+'/api/session');if(res.ok){ready=true;break;}}catch{}
    if(child.exitCode!==null)throw new Error(output);
    await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(ready,true,output);
  const {token}=await(await fetch(origin+'/api/session')).json();
  const post=(path,data,headers={})=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token,...headers},body:JSON.stringify(data)});
  const html=await fetch(origin+'/');assert.equal(html.status,200);assert.match(await html.text(),/微信定时群聊助手/);
  let status=await(await fetch(origin+'/api/status')).json();assert.equal(status.runner.running,false);assert.equal(status.config.startHour,7);
  assert.equal((await post('/api/config',{}, {'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await post('/api/stop',{}, {Origin:'https://example.com'})).status,403);
  const c={...status.config,groups:['接口测试群A','接口测试群B'],message:'仅接口模拟，不发送'};
  assert.equal((await post('/api/config',c)).status,200);
  status=await(await fetch(origin+'/api/status')).json();assert.equal(status.plan.length,28);
  let response=await post('/api/start',{mode:'real',confirmation:'已确认群名和文案',revision:status.revision});
  assert.equal(response.status,400);assert.match((await response.json()).error,/校准/);
  assert.equal((await post('/api/start',{mode:'dry'})).status,200);
  assert.equal((await post('/api/config',c)).status,400);
  assert.equal((await post('/api/bindings/reset',{scope:'all',confirmed:true})).status,400);
  status=await(await fetch(origin+'/api/status')).json();assert.equal(status.runner.mode,'dry');assert.equal(status.runner.running,true);
  assert.equal((await post('/api/stop',{})).status,200);
  status=await(await fetch(origin+'/api/status')).json();assert.equal(status.runner.running,false);
  assert.equal((await post('/api/config',{...c,startMinute:35,endHour:7,endMinute:37,roundUnit:'minute',intervalSeconds:5})).status,200);
  status=await(await fetch(origin+'/api/status')).json();assert.equal(status.plan.length,6);assert.equal(status.rounds.length,3);
  assert.equal(status.plan[0].roundLabel,'07:35');assert.equal(status.plan.at(-1).roundLabel,'07:37');
  const groupId=status.config.groups[0].id;
  response=await post('/api/manual',{mode:'real',groupId,requestId:'http-manual-request1',confirmation:'已确认群名和文案',revision:status.revision});
  assert.equal(response.status,400);assert.match((await response.json()).error,/校准/);
  assert.equal((await post('/api/manual',{mode:'dry',groupId:'unknown',requestId:'http-manual-request1'})).status,400);
  assert.equal((await post('/api/manual',{mode:'dry',groupId,requestId:'http-manual-request1'})).status,200);
  status=await(await fetch(origin+'/api/status')).json();assert.equal(status.runner.kind,'manual');assert.equal(status.runner.mode,'dry');
  assert.equal((await post('/api/start',{mode:'dry'})).status,400);
  for(let i=0;i<30&&status.runner.running;i++){
    await new Promise(r=>setTimeout(r,100));status=await(await fetch(origin+'/api/status')).json();
  }
  assert.equal(status.runner.running,false);
  assert.equal(Object.values(status.records).filter(r=>r.kind==='manual'&&r.status==='simulated').length,1);
  assert.equal((await post('/api/manual',{mode:'dry',groupId,requestId:'http-manual-request1'})).status,400);
  const layout={width:1000,height:800,title:{x:300,y:30,width:200,height:30},draft:{x:300,y:600,width:600,height:100},neutral:{x:900,y:40},editor:{x:350,y:650},send:{x:900,y:750}};
  assert.equal((await post('/api/config',{...status.config,layout})).status,200);
  status=await(await fetch(origin+'/api/status')).json();
  const savedConfig=structuredClone(status.config),savedRecords=structuredClone(status.records);
  const binding={layoutHash:layoutHash(savedConfig.layout),titleHash:'offline-fixture',draftHash:'offline-draft'};
  for(const g of status.config.groups)await writeFile(join(dir,'bindings',`${g.id}.json`),JSON.stringify(binding));
  assert.equal((await post('/api/bindings/reset',{scope:'invalid',confirmed:true,revision:status.revision})).status,400);
  assert.equal((await post('/api/bindings/reset',{scope:'all',confirmed:false,revision:status.revision})).status,400);
  assert.equal((await post('/api/bindings/reset',{scope:'current',groupId:'../state',confirmed:true,revision:status.revision})).status,400);
  assert.equal((await post('/api/bindings/reset',{scope:'current',groupId,confirmed:true,revision:status.revision})).status,200);
  status=await(await fetch(origin+'/api/status')).json();
  assert.equal(status.bindings[groupId],false);assert.equal(status.bindings[status.config.groups[1].id],true);
  assert.deepEqual(status.config,savedConfig);assert.deepEqual(status.records,savedRecords);
  const orphanId='a'.repeat(24);await writeFile(join(dir,'bindings',`${orphanId}.json`),JSON.stringify(binding));
  assert.equal((await post('/api/bindings/reset',{scope:'all',confirmed:true,revision:status.revision})).status,200);
  status=await(await fetch(origin+'/api/status')).json();
  assert.equal(status.config.layout,null);assert.equal(Object.values(status.bindings).some(Boolean),false);
  assert.deepEqual(status.config,{...savedConfig,layout:null});assert.deepEqual(status.records,savedRecords);
  assert.equal(JSON.parse(await readFile(join(dir,'bindings',`${orphanId}.json`),'utf8')),null);
  assert.equal((await fetch(origin+'/data/config.json')).status,404);
});
