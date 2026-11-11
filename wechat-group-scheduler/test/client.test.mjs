import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { validateConfig, planForDay, roundMinutes } from '../src/schedule.mjs';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../public/app.js',import.meta.url),'utf8');

async function page({bound=false,manualError=null,configError=null,captureError=null,bindError=null,savedLayout=false,resetConfirmed=true,resetError=null}={}){
  const {window,document}=parseHTML(html);
  // The DOM library has no layout or native dialog UI; model those browser methods.
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{
    configurable:true,
    get(){return this.querySelector('option[selected]')?.value??this.querySelector('option')?.value??'';},
    set(value){for(const o of this.querySelectorAll('option')){if(o.value===value)o.setAttribute('selected','');else o.removeAttribute('selected');}},
  });
  let scrolled=false;
  document.getElementById('bindingSection').scrollIntoView=()=>{scrolled=true;};
  document.getElementById('capture').focus=()=>{};
  const dialog=document.getElementById('confirmDialog');
  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  const layout={width:1000,height:800,title:{x:300,y:30,width:200,height:30},draft:{x:300,y:600,width:600,height:100},neutral:{x:900,y:40},editor:{x:350,y:650},send:{x:900,y:750}};
  let config=validateConfig({groups:['甲群','乙群'],message:'前端回归测试，绝不发送',layout:savedLayout?layout:null});
  const calls=[],polls=[],bindings=new Map();
  document.getElementById('canvas').getContext=()=>Object.fromEntries(['drawImage','strokeRect','fillText','beginPath','arc','stroke'].map(k=>[k,()=>{}]));
  const runner={running:false,busy:false,mode:'dry',kind:'scheduled',error:null};
  const response=(value,ok=true)=>({ok,json:async()=>structuredClone(value)});
  const fetch=async(path,options)=>{
    const input=options?.body?JSON.parse(options.body):null;calls.push({path,input});
    if(path==='/api/session')return response({token:'test-only-token'});
    if(path==='/api/status')return response({config,revision:'test-revision',runner,bindings:Object.fromEntries(config.groups.map(g=>[g.id,bindings.get(g.id)??bound])),now:Date.now(),rounds:roundMinutes(config),plan:planForDay(config),logs:[]});
    if(path==='/api/config'){
      if(configError)return response({error:configError},false);
      config=validateConfig(input);return response({ok:true});
    }
    if(path==='/api/manual'){
      if(manualError)return response({error:manualError},false);
      Object.assign(runner,{running:true,kind:'manual',mode:input.mode});return response({ok:true});
    }
    if(path==='/api/capture')return captureError?response({error:captureError},false):response({id:'test-capture',width:1000,height:800,png:''});
    if(path==='/api/bind'){
      if(bindError)return response({error:bindError},false);
      config=validateConfig({...config,layout:input.layout});bindings.set(input.groupId,true);return response({ok:true});
    }
    if(path==='/api/bindings/reset'){
      if(resetError)return response({error:resetError},false);
      if(input.scope==='all'){
        for(const group of config.groups)bindings.set(group.id,false);
        config={...config,layout:null};
      }else bindings.set(input.groupId,false);
      return response({ok:true});
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  class TestImage{async decode(){}}
  const context=vm.createContext({document,fetch,crypto:{randomUUID},Image:TestImage,structuredClone,confirm:()=>resetConfirmed,setInterval:fn=>{polls.push(fn);},Intl,console});
  await vm.runInContext(`(async()=>{${script}\n})()`,context);
  return {get:id=>document.getElementById(id),calls,runner,polls,scrolled:()=>scrolled};
}

test('未绑定时点击手动发送：按钮旁显示明确原因，不启动真实发送',async()=>{
  const p=await page();assert.equal(p.get('manualSetup').hidden,false);
  await p.get('manualReal').onclick();
  assert.equal(p.get('manualFeedback').hidden,false);
  assert.match(p.get('manualFeedback').textContent,/尚未发送.*校准绑定/);
  assert.match(p.get('manualFeedback').textContent,/甲群、乙群/);
  assert.equal(p.get('manualReal').disabled,false);
  assert.equal(p.calls.some(c=>c.path==='/api/manual'),false);
  p.get('goToBinding').onclick();assert.equal(p.scrolled(),true);
  assert.notEqual(p.get('bindGroup').value,'');
});

test('已绑定时点击手动发送：显示核对窗口，确认后才提交一次',async()=>{
  const p=await page({bound:true});
  await p.get('manualReal').onclick();
  assert.equal(p.get('confirmDialog').open,true);
  assert.match(p.get('confirmGroups').textContent,/甲群/);
  assert.equal(p.calls.some(c=>c.path==='/api/manual'),false);
  await p.get('confirmReal').onclick();
  assert.equal(p.get('confirmDialog').open,false);
  const requests=p.calls.filter(c=>c.path==='/api/manual');assert.equal(requests.length,1);
  assert.equal(requests[0].input.mode,'real');assert.equal(p.runner.running,true);
});

test('确认窗口内服务端拒绝：错误显示在弹窗内，按钮恢复可操作',async()=>{
  const p=await page({bound:true,manualError:'校准记录已失效，请重新绑定'});
  await p.get('manualReal').onclick();await p.get('confirmReal').onclick();
  assert.equal(p.get('confirmDialog').open,true);assert.equal(p.get('confirmFeedback').hidden,false);
  assert.match(p.get('confirmFeedback').textContent,/校准记录已失效/);
  assert.equal(p.get('confirmReal').disabled,false);
});

test('保存配置失败：手动按钮旁显示失败，不提交发送请求',async()=>{
  const p=await page({configError:'结束时间不能早于开始时间'});
  await p.get('manualReal').onclick();
  assert.equal(p.get('manualFeedback').hidden,false);
  assert.match(p.get('manualFeedback').textContent,/结束时间/);
  assert.equal(p.calls.some(c=>c.path==='/api/manual'),false);
});

test('无需绑定也可手动模拟，按钮旁显示启动结果',async()=>{
  const p=await page();await p.get('manualDry').onclick();
  assert.equal(p.calls.filter(c=>c.path==='/api/manual').length,1);
  assert.equal(p.runner.mode,'dry');assert.equal(p.get('manualFeedback').hidden,false);
  assert.match(p.get('manualFeedback').textContent,/不会操作微信/);
});

test('勾选确认但五步未完成：绑定按钮旁明确列出缺失步骤',async()=>{
  const p=await page();await p.get('capture').onclick();p.get('bindConfirm').checked=true;
  await p.get('bind').onclick();
  assert.equal(p.get('bindFeedback').hidden,false);
  assert.match(p.get('bindFeedback').textContent,/尚未保存.*框选群标题.*点击发送按钮中心/);
  assert.equal(p.calls.some(c=>c.path==='/api/bind'),false);
  assert.equal(p.get('bind').disabled,false);
});

test('完成校准但未勾选确认：绑定按钮旁显示原因',async()=>{
  const p=await page({savedLayout:true});await p.get('capture').onclick();await p.get('bind').onclick();
  assert.equal(p.get('bindFeedback').hidden,false);assert.match(p.get('bindFeedback').textContent,/请先勾选/);
  assert.equal(p.calls.some(c=>c.path==='/api/bind'),false);
});

test('绑定成功：按钮旁显示保存的群名，下拉框与当前群状态同步更新',async()=>{
  const p=await page({savedLayout:true});await p.get('capture').onclick();p.get('bindConfirm').checked=true;
  await p.get('bind').onclick();
  assert.equal(p.calls.filter(c=>c.path==='/api/bind').length,1);
  assert.equal(p.get('bindFeedback').hidden,false);assert.match(p.get('bindFeedback').textContent,/已成功保存群「甲群」/);
  assert.match(p.get('selectedBindingStatus').textContent,/甲群.*已绑定/);
  assert.match(p.get('bindGroup').querySelector('option').textContent,/已绑定/);
  assert.equal(p.get('bind').disabled,false);assert.equal(p.get('bind').textContent,'保存这个群的绑定');
});

test('绑定失败：截图过期等服务端错误就近显示，按钮恢复',async()=>{
  const p=await page({savedLayout:true,bindError:'群或截图无效，请重新截图'});
  await p.get('capture').onclick();p.get('bindConfirm').checked=true;await p.get('bind').onclick();
  assert.equal(p.get('bindFeedback').hidden,false);assert.match(p.get('bindFeedback').textContent,/请重新截图/);
  assert.equal(p.get('bind').disabled,false);
});

test('获取截图失败：在截图按钮附近显示错误',async()=>{
  const p=await page({captureError:'微信没有处于前台'});await p.get('capture').onclick();
  assert.equal(p.get('captureFeedback').hidden,false);assert.match(p.get('captureFeedback').textContent,/微信没有处于前台/);
  assert.equal(p.get('capture').disabled,false);
});

test('重置当前群：确认后清空当前截图并同步绑定状态，保留文案',async()=>{
  const p=await page({bound:true,savedLayout:true});const message=p.get('message').value;
  await p.get('capture').onclick();await p.get('resetBinding').onclick();
  assert.equal(p.calls.filter(c=>c.path==='/api/bindings/reset').at(-1).input.scope,'current');
  assert.equal(p.get('calibration').hidden,true);assert.match(p.get('selectedBindingStatus').textContent,/尚未绑定/);
  assert.match(p.get('captureFeedback').textContent,/已重置群「甲群」/);assert.equal(p.get('message').value,message);
  assert.equal(p.get('resetBinding').disabled,false);
});

test('重置全部：清空布局后重新截图要求重新校准',async()=>{
  const p=await page({bound:true,savedLayout:true});await p.get('capture').onclick();
  await p.get('resetAllBindings').onclick();assert.match(p.get('captureFeedback').textContent,/已重置全部群/);
  await p.get('capture').onclick();assert.match(p.get('selectionInfo').textContent,/群标题：未设置/);
});

test('重置取消或服务端失败：保留绑定，并就近显示结果',async()=>{
  const cancelled=await page({bound:true,resetConfirmed:false});await cancelled.get('resetBinding').onclick();
  assert.equal(cancelled.calls.some(c=>c.path==='/api/bindings/reset'),false);
  assert.match(cancelled.get('captureFeedback').textContent,/已取消/);
  const failed=await page({bound:true,resetError:'请先停止当前任务'});await failed.get('resetAllBindings').onclick();
  assert.match(failed.get('captureFeedback').textContent,/请先停止/);assert.equal(failed.get('resetAllBindings').disabled,false);
});

test('手动任务结束后再次打开弹窗：确认按钮恢复，可以提交新一轮',async()=>{
  const p=await page({bound:true});await p.get('manualReal').onclick();await p.get('confirmReal').onclick();
  assert.equal(p.get('confirmReal').disabled,true);
  p.runner.running=false;
  await p.get('manualReal').onclick();
  assert.equal(p.get('confirmDialog').open,true);assert.equal(p.get('confirmReal').disabled,false);
  await p.get('confirmReal').onclick();
  const requests=p.calls.filter(c=>c.path==='/api/manual');assert.equal(requests.length,2);
  assert.notEqual(requests[0].input.requestId,requests[1].input.requestId);
});

test('手动进度展示等待时间和失败群，停止后确认按钮恢复',async()=>{
  const p=await page({bound:true});
  Object.assign(p.runner,{running:true,kind:'manual',mode:'real',progress:{total:2,completed:1,nextGroup:'乙群',nextAt:Date.now()+60_000}});
  await p.get('manualReal').onclick();
  assert.match(p.get('manualProgress').textContent,/1\/2.*乙群.*秒后开始/);
  assert.equal(p.get('confirmReal').disabled,true);
  Object.assign(p.runner,{running:false,error:'微信没有处于前台',progress:{total:2,completed:1,failedGroup:'乙群'}});
  await p.get('manualReal').onclick();
  assert.equal(p.get('confirmReal').disabled,false);
  assert.match(p.get('manualProgress').textContent,/乙群.*微信没有处于前台/);
});
