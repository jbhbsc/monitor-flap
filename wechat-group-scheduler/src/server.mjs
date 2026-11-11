import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { defaults, validateConfig, planForDay, layoutHash, roundMinutes } from './schedule.mjs';
import { Store, acquireLock } from './store.mjs';
import { Runner } from './runner.mjs';
import { bridge } from './bridge.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir=process.env.WECHAT_DATA_DIR||join(root,'data');
const release=await acquireLock(dataDir);
const store=new Store(dataDir);
try { await store.init(); } catch(e) { await release(); throw e; }
let config;
try { config=validateConfig(await store.read('config.json',defaults)); }
catch(e){await release();throw e;}
const token=randomBytes(32).toString('hex');
const port=Number(process.env.WECHAT_PORT||8787);
if(!Number.isInteger(port)||port<1024||port>65535){await release();throw new Error('WECHAT_PORT 无效');}
const origin=`http://127.0.0.1:${port}`;
const captures=new Map();
let operation=false;
let stopGeneration=0;
const bindingName=id=>`bindings/${id}.json`;
const revision=()=>createHash('sha256').update(JSON.stringify(config)).digest('hex');

async function preflight(c) {
  if(!c.layout)throw new Error('请先完成界面校准');
  const bindings=[];
  for(const group of c.groups){
    const binding=await store.read(bindingName(group.id),null);
    if(!binding||binding.layoutHash!==layoutHash(c.layout))throw new Error(`群「${group.name}」尚未绑定当前布局`);
    bindings.push(binding);
  }
  if(new Set(bindings.map(b=>b.titleHash)).size!==bindings.length)throw new Error('多个群的标题图像相同，无法区分；请设置不同群名并重新绑定');
}

const runner=new Runner({store,send:async(group,c,signal)=>{
  const binding=await store.read(bindingName(group.id),null);
  if(!binding||binding.layoutHash!==layoutHash(c.layout))throw new Error('绑定记录发生变化');
  await bridge('send',{group:group.name,message:c.message,layout:c.layout,binding},signal);
}});
// Crash reservations remain reserved. Restarts always require manually starting the runner.
for(const [key,record] of Object.entries(store.records)){
  if(record.status==='in_progress'){
    await store.record(key,{...record,status:'uncertain',error:'上次进程中断，发送结果未知，请人工核查；不会自动重试'});
    await store.log('error','检测到上次中断的任务，发送结果未知，请人工核查；不会自动重试',{group:record.group});
  }
}

async function status(){
  const bindings={};
  for(const group of config.groups){
    const b=await store.read(bindingName(group.id),null);
    bindings[group.id]=Boolean(b&&b.layoutHash===layoutHash(config.layout));
  }
  return {config,revision:revision(),bindings,runner:runner.status(),logs:store.logs.slice(-100),
    records:store.records,now:Date.now(),rounds:roundMinutes(config),plan:planForDay(config),platform:process.platform};
}
function reply(res,code,body,type='application/json; charset=utf-8'){
  res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Referrer-Policy':'no-referrer'});
  res.end(type.startsWith('application/json')?JSON.stringify(body):body);
}
async function body(req){
  let text='';for await(const chunk of req){text+=chunk;if(text.length>100_000)throw new Error('请求体过大');}
  return JSON.parse(text||'{}');
}
const server=http.createServer(async(req,res)=>{
  try{
    // Loopback only, exact Host and Origin, plus per-process token for every mutation.
    if(req.headers.host!==`127.0.0.1:${port}`)return reply(res,403,{error:'请通过本机 127.0.0.1 访问'});
    if(req.headers.origin&&req.headers.origin!==origin)return reply(res,403,{error:'不允许跨站请求'});
    const path=new URL(req.url,origin).pathname;
    if(req.method==='GET'){
      if(path==='/api/session')return reply(res,200,{token});
      if(path==='/api/status')return reply(res,200,await status());
      const assets={'/':['index.html','text/html; charset=utf-8'],'/bootstrap.js':['bootstrap.js','text/javascript; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
      if(assets[path])return reply(res,200,await readFile(join(root,'public',assets[path][0])),assets[path][1]);
      return reply(res,404,{error:'未找到页面'});
    }
    if(req.method!=='POST')return reply(res,405,{error:'方法不支持'});
    if(req.headers['x-csrf-token']!==token)return reply(res,403,{error:'请刷新本地页面后重试'});
    const input=await body(req);
    if(path==='/api/stop'){
      stopGeneration++;
      runner.stop();await store.log('info','用户已停止任务；已开始的发送请核查结果');
      return reply(res,200,{ok:true});
    }
    if(operation)return reply(res,409,{error:'另一项操作正在执行，请稍候'});
    operation=true;
    try{
      if(path==='/api/start'||path==='/api/manual'){
        if(runner.running||runner.busy)throw new Error('请先停止当前任务，再启动定时或手动发送');
        const generation=stopGeneration;
        let taskConfig=config;
        if(path==='/api/manual'&&input.groupId&&input.groupId!=='all'){
          const group=config.groups.find(g=>g.id===input.groupId);
          if(!group)throw new Error('请选择有效的手动发送群');
          taskConfig={...config,groups:[group]};
        }
        if(input.mode==='real'){
          if(input.confirmation!=='已确认群名和文案')throw new Error('请先核对群名单和文案');
          if(input.revision!==revision())throw new Error('配置已变化，请刷新并重新核对');
          await preflight(taskConfig);
        }
        if(generation!==stopGeneration)throw new Error('启动已取消');
        if(path==='/api/manual'){
          runner.startManual(taskConfig,input.mode,input.requestId);
          await store.log('info',`手动一轮已启动：${taskConfig.groups.length} 个群${input.mode==='dry'?'（模拟，不操作微信）':''}`);
        }else{
          runner.start(taskConfig,input.mode);
          await store.log('info',input.mode==='real'?'真实发送任务已启动':'模拟任务已启动（不操作微信）');
        }
      }else{
        if(runner.running||runner.busy)throw new Error('请先停止定时任务，再修改配置或校准');
        if(path==='/api/config'){
          const next=validateConfig(input);
          await store.write('config.json',next);config=next;
          await store.log('info','配置已保存');
        }else if(path==='/api/bindings/reset'){
          if(!['current','all'].includes(input.scope))throw new Error('请选择重置当前群或全部绑定');
          if(input.confirmed!==true)throw new Error('请确认要重置的绑定范围');
          if(input.revision!==revision())throw new Error('配置已变化，请刷新后重试');
          const group=input.scope==='current'?config.groups.find(g=>g.id===input.groupId):null;
          if(input.scope==='current'&&!group)throw new Error('请选择有效的群聊');
          if(group){
            await store.resetBindings(group.id);
          }else{
            await store.resetBindings();
            const next=validateConfig({...config,layout:null});
            await store.write('config.json',next);config=next;
          }
          captures.clear();
          await store.log('info',group?`已重置群「${group.name}」的绑定`:'已重置全部群绑定和校准布局');
        }else if(path==='/api/capture'){
          for(const [id,s] of captures)if(Date.now()-s.createdAt>600_000)captures.delete(id);
          if(captures.size>=5)captures.delete(captures.keys().next().value);
          const shot=await bridge('capture');
          const id=randomBytes(12).toString('hex');
          captures.set(id,{...shot,createdAt:Date.now()});
          return reply(res,200,{id,...shot});
        }else if(path==='/api/bind'){
          const group=config.groups.find(g=>g.id===input.groupId);
          const shot=captures.get(input.captureId);
          if(!group||!shot||Date.now()-shot.createdAt>600_000)throw new Error('群或截图无效，请重新截图');
          if(!input.confirmed)throw new Error('请确认截图中的会话是指定群聊且输入框为空');
          const next=validateConfig({...config,layout:input.layout});
          if(next.layout.width!==shot.width||next.layout.height!==shot.height)throw new Error('截图尺寸不一致');
          const hashes=await bridge('bind',{png:shot.png,layout:next.layout});
          for(const other of config.groups){
            if(other.id===group.id)continue;
            const b=await store.read(bindingName(other.id),null);
            if(b&&b.titleHash===hashes.titleHash)throw new Error(`标题与「${other.name}」相同，无法区分；请检查截图或修改重名群`);
          }
          await store.write(bindingName(group.id),{group:group.name,layoutHash:layoutHash(next.layout),titleHash:hashes.titleHash,draftHash:hashes.draftHash,draftProfile:hashes.draftProfile,boundAt:new Date().toISOString()});
          await store.write('config.json',next);config=next;
          await store.log('info',`已绑定群「${group.name}」`);
        }else return reply(res,404,{error:'接口不存在'});
      }
      reply(res,200,{ok:true});
    }finally{operation=false;}
  }catch(e){reply(res,400,{error:e.message});}
});
const timer=setInterval(()=>{
  for(const [id,s] of captures)if(Date.now()-s.createdAt>600_000)captures.delete(id);
  void runner.tick();
},1000);
server.on('error',async e=>{clearInterval(timer);await release();console.error(e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
  console.log(`\n微信定时群聊助手\n打开 ${origin}\n默认停止；不会自动发送消息。关闭此窗口即停止服务。\n`);
});
let exiting=false;
async function shutdown(){
  if(exiting)return;exiting=true;runner.stop();clearInterval(timer);
  server.close();
  // Wait for an aborted bridge and its durable state record before removing lock.
  const timeout=Date.now()+5000;while(runner.busy&&Date.now()<timeout)await new Promise(r=>setTimeout(r,50));
  await release();process.exit(0);
}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
