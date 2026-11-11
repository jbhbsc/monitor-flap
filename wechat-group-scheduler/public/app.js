const $=id=>document.getElementById(id);
const fmt=(n,seconds=false)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',...(seconds?{second:'2-digit'}:{}),hourCycle:'h23'}).format(n);
let token='',state=null,loaded=false,shot=null,image=null,layout=null,step='title',drag=null,busy=false,pendingReal=null,actionFeedback=null,lastManualError=null;
const timeText=(hour,minute)=>`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
const steps=['title','draft','neutral','editor','send'];
const help={title:'拖动框选完整群标题，尽量紧贴文字。必须包含能区分群聊的名称。',draft:'拖动框选整个空白文字输入区域，不含发送按钮、工具栏。',neutral:'点击一处完全空白、没有功能的位置。运行时会点击这里使输入框失焦，不能选群标题或任何按钮。',editor:'点击输入区域内部，用于放置文字光标。',send:'点击微信“发送”按钮中心。不要选择关闭、表情或其他按钮。'};
function feedback(id,text,bad=false){const el=$(id);el.textContent=text;el.className=`feedback ${bad?'bad':''}`;el.hidden=false;}
function notice(text,bad=false){
  $('notice').textContent=text;$('notice').className=bad?'bad':'';$('notice').hidden=false;
  if(actionFeedback)feedback(actionFeedback,text,bad);
}
async function api(path,data){
  const res=await fetch(path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(data)});
  const value=await res.json();if(!res.ok)throw new Error(value.error||'请求失败');return value;
}
async function action(fn,{button=null,feedbackId=null,label='正在处理…'}={}){
  if(busy){if(feedbackId)feedback(feedbackId,'正在处理上一项操作，请稍候。');return;}
  busy=true;actionFeedback=feedbackId;
  const original=button?$(button).textContent:null;
  if(button){$(button).disabled=true;$(button).dataset.pending='true';$(button).textContent=label;}
  if(feedbackId)feedback(feedbackId,label);
  try{await fn();await refresh();}
  catch(e){notice(e.message,true);}
  finally{
    busy=false;actionFeedback=null;
    if(button){delete $(button).dataset.pending;$(button).textContent=original;$(button).disabled=Boolean(state?.runner.running||state?.runner.busy);}
  }
}
function readConfig(){
  if(!/^\d{2}:\d{2}$/.test($('startTime').value)||!/^\d{2}:\d{2}$/.test($('endTime').value))throw new Error('请选择完整的开始和结束时间');
  const [startHour,startMinute]=$('startTime').value.split(':').map(Number),[endHour,endMinute]=$('endTime').value.split(':').map(Number);
  return {...state.config,groups:$('groups').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),message:$('message').value,startHour,startMinute,endHour,endMinute,roundUnit:$('roundUnit').value,intervalSeconds:Number($('interval').value)};
}
$('roundUnit').onchange=()=>{
  const count=$('groups').value.split(/\r?\n/).filter(s=>s.trim()).length;
  if($('roundUnit').value==='minute'&&(count-1)*Number($('interval').value)>=60){
    $('interval').value=Math.min(5,Math.max(1,Math.floor(59/(count-1))));
    notice(`已切换每分钟一轮，群间隔调整为 ${$('interval').value} 秒，保存前可继续修改。实际发送耗时较长时会跳过过期任务。`);
  }
};
async function save(){await api('/api/config',readConfig());notice('配置已保存。');}
$('configForm').addEventListener('submit',e=>{e.preventDefault();void action(save);});
$('dryStart').onclick=()=>action(async()=>{await save();await api('/api/start',{mode:'dry'});notice('模拟任务已启动：只按时间记录执行，不会操作微信。');});
async function prepareReal(kind){
  await save();await refresh();
  if(!state.config.groups.length||!state.config.message.trim())throw new Error('请先填写群名单和文案');
  const groupId=kind==='manual'?$('manualGroup').value:'all';
  const groups=state.config.groups.filter(g=>groupId==='all'||g.id===groupId);
  if(!groups.length)throw new Error('请选择有效的发送目标');
  const missing=groups.filter(g=>!state.bindings[g.id]);if(missing.length)throw new Error(`尚未发送：请先完成群校准绑定「${missing.map(g=>g.name).join('、')}」。点击下方“前往校准与绑定”；仅测试按钮和流程可用“手动模拟一轮”。`);
  const c=state.config;
  $('confirmTitle').textContent=kind==='manual'?'核对手动发送':'核对真实定时发送';
  $('confirmSummary').textContent=kind==='manual'?`立即发送一轮：${groups.length} 个群，群间隔 ${c.intervalSeconds} 秒。与上一条真实发送也保持该间隔，不启动每日定时任务。`:`北京时间每天 ${timeText(c.startHour,c.startMinute)} 至 ${timeText(c.endHour,c.endMinute)}，${c.roundUnit==='minute'?'每分钟':'每小时'}一轮，${groups.length} 个群，群间隔 ${c.intervalSeconds} 秒。`;
  $('confirmGroups').textContent=groups.map((g,i)=>`${i+1}. ${g.name}`).join('\n');
  $('confirmMessage').textContent=c.message;
  $('confirmReal').textContent=kind==='manual'?'确认并手动发送一轮':'确认并启动真实定时发送';
  $('confirmReal').disabled=false;
  pendingReal={kind,groupId,requestId:crypto.randomUUID(),revision:state.revision};
  $('confirmFeedback').hidden=true;$('confirmDialog').showModal();
  notice('请在确认窗口核对群名和文案，点击确认后才会发送。');
}
$('realStart').onclick=()=>action(()=>prepareReal('scheduled'));
$('manualReal').onclick=()=>action(()=>prepareReal('manual'),{button:'manualReal',feedbackId:'manualFeedback',label:'正在检查发送条件…'});
$('manualDry').onclick=()=>action(async()=>{
  await save();await refresh();
  await api('/api/manual',{mode:'dry',groupId:$('manualGroup').value,requestId:crypto.randomUUID()});
  notice('已开始手动模拟一轮，按群间隔依次记录，不会操作微信；完成后自动停止。');
},{button:'manualDry',feedbackId:'manualFeedback',label:'正在启动手动模拟…'});
$('cancelReal').onclick=()=>$('confirmDialog').close();
$('confirmReal').onclick=()=>action(async()=>{
  if(!pendingReal)throw new Error('请重新核对发送任务');
  const p=pendingReal;
  await api(p.kind==='manual'?'/api/manual':'/api/start',{mode:'real',confirmation:'已确认群名和文案',revision:p.revision,groupId:p.groupId,requestId:p.requestId});
  $('confirmDialog').close();pendingReal=null;
  notice(p.kind==='manual'?'手动一轮已启动，完成后自动停止。请保持微信前台可操作。':'真实定时任务已启动。请保持微信在线、桌面解锁，发送期间避免操作鼠标和键盘。');
},{button:'confirmReal',feedbackId:'confirmFeedback',label:'正在启动发送…'});
// Stop must remain available during capture or another pending request.
$('stop').onclick=async()=>{try{await api('/api/stop',{});notice('已停止。若刚才正在发送，请在微信中核查结果。');await refresh();}catch(e){notice(e.message,true);}};
function manualReadiness(){
  if(!state)return;
  const groupId=$('manualGroup').value;
  const missing=state.config.groups.filter(g=>(groupId==='all'||g.id===groupId)&&!state.bindings[g.id]);
  $('manualSetup').hidden=!missing.length;
  $('manualReadiness').textContent=`所选目标有 ${missing.length} 个群尚未完成校准绑定。真实发送前需完成下方第 03 步；手动模拟无需绑定。`;
  const error=state.runner.kind==='manual'?state.runner.error:null;
  if(error&&error!==lastManualError)feedback('manualFeedback',`手动发送已停止：${error}`,true);
  lastManualError=error;
}
$('manualGroup').onchange=()=>{$('manualFeedback').hidden=true;manualReadiness();};
$('goToBinding').onclick=()=>{
  const groupId=$('manualGroup').value;
  const missing=state.config.groups.find(g=>(groupId==='all'||g.id===groupId)&&!state.bindings[g.id]);
  if(missing){$('bindGroup').value=missing.id;$('bindGroup').onchange();}
  $('bindingSection').scrollIntoView({behavior:'smooth',block:'start'});
  $('capture').focus({preventScroll:true});
};
function setStep(value){step=value;document.querySelectorAll('[data-step]').forEach(b=>b.classList.toggle('active',b.dataset.step===step));$('stepHelp').textContent=help[step];}
document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>setStep(b.dataset.step));
$('capture').onclick=()=>action(async()=>{
  if(!state.config.groups.length)throw new Error('请先保存群名单');
  notice('正在获取微信截图。程序会先把鼠标移出输入框，等待语音输入提示消失；请暂时不要移动鼠标，截图后返回此页面。');
  shot=await api('/api/capture',{});
  image=new Image();image.src=`data:image/png;base64,${shot.png}`;await image.decode();
  const old=layout||state.config.layout;
  layout=old&&old.width===shot.width&&old.height===shot.height?structuredClone(old):{width:shot.width,height:shot.height};
  $('canvas').width=shot.width;$('canvas').height=shot.height;$('calibration').hidden=false;
  $('bindConfirm').checked=false;setStep(steps.find(s=>!layout[s])||'title');draw();
  $('bindFeedback').hidden=true;
  notice('截图已就绪。请核对群聊正确、蓝框内没有草稿或“长按鼠标 语音输入”提示。若截图仍有提示，请重新获取截图后再保存。');
},{button:'capture',feedbackId:'captureFeedback',label:'正在获取微信截图…'});
$('resetLayout').onclick=()=>{if(!shot)return feedback('captureFeedback','请先获取微信截图。',true);layout={width:shot.width,height:shot.height};$('bindFeedback').hidden=true;$('bindConfirm').checked=false;setStep('title');draw();};
function selectedBindingStatus(){
  const group=state?.config.groups.find(g=>g.id===$('bindGroup').value);
  $('selectedBindingStatus').textContent=group?`当前群「${group.name}」：${state.bindings[group.id]?'已绑定，可重新截图更新':'尚未绑定，请打开这个群后获取截图'}`:'请先保存群名单，再选择需要绑定的群。';
  for(const option of $('bindGroup').querySelectorAll('option')){
    const g=state?.config.groups.find(g=>g.id===option.value);
    if(g)option.textContent=`${state.bindings[g.id]?'✓ 已绑定':'○ 未绑定'} · ${g.name}`;
  }
}
$('bindGroup').onchange=()=>{shot=null;image=null;$('calibration').hidden=true;$('bindConfirm').checked=false;$('bindFeedback').hidden=true;$('captureFeedback').hidden=true;selectedBindingStatus();};
async function resetBindings(scope){
  if(state.runner.running||state.runner.busy)throw new Error('请先停止当前任务，再重置绑定');
  const group=state.config.groups.find(g=>g.id===$('bindGroup').value);
  if(scope==='current'&&!group)throw new Error('请先选择需要重置的群');
  const target=scope==='all'?'全部群的绑定与校准布局':`群「${group.name}」的绑定`;
  if(!confirm(`确定重置${target}？\n重置后需要重新截图绑定。群名单、文案、时间设置和发送记录会保留。`)){
    notice('已取消重置，绑定保持原样。');return;
  }
  await api('/api/bindings/reset',{scope,groupId:group?.id,confirmed:true,revision:state.revision});
  shot=null;image=null;layout=scope==='all'?null:state.config.layout;
  pendingReal=null;$('confirmDialog').close();
  $('calibration').hidden=true;$('bindConfirm').checked=false;$('bindFeedback').hidden=true;
  notice(`已重置${target}。请重新获取微信截图后绑定。`);
}
$('resetBinding').onclick=()=>action(()=>resetBindings('current'),{button:'resetBinding',feedbackId:'captureFeedback',label:'正在重置当前群…'});
$('resetAllBindings').onclick=()=>action(()=>resetBindings('all'),{button:'resetAllBindings',feedbackId:'captureFeedback',label:'正在重置全部绑定…'});
function point(e){const r=$('canvas').getBoundingClientRect();return{x:Math.max(0,Math.min(shot.width-1,Math.round((e.clientX-r.left)*shot.width/r.width))),y:Math.max(0,Math.min(shot.height-1,Math.round((e.clientY-r.top)*shot.height/r.height)))};}
$('canvas').onpointerdown=e=>{if(!image)return;e.preventDefault();$('canvas').setPointerCapture(e.pointerId);drag=point(e);};
$('canvas').onpointerup=e=>{
  if(!drag)return;const p=point(e);
  if(step==='title'||step==='draft')layout[step]={x:Math.min(p.x,drag.x),y:Math.min(p.y,drag.y),width:Math.abs(p.x-drag.x),height:Math.abs(p.y-drag.y)};
  else layout[step]=p;
  drag=null;setStep(steps[Math.min(steps.indexOf(step)+1,steps.length-1)]);$('bindConfirm').checked=false;draw();
};
$('canvas').onpointercancel=()=>{drag=null;};
function draw(){
  if(!image)return;const ctx=$('canvas').getContext('2d');ctx.drawImage(image,0,0);ctx.lineWidth=3;ctx.font='bold 17px Microsoft YaHei';
  const names={title:'群标题',draft:'空白输入区域',neutral:'失焦空白处',editor:'输入位置',send:'发送按钮'};
  const colors={title:'#e54c36',draft:'#236ee8',neutral:'#874bc9',editor:'#18a878',send:'#e9950d'};
  for(const key of steps){const v=layout[key];if(!v)continue;ctx.strokeStyle=colors[key];ctx.fillStyle=colors[key];if('width'in v){ctx.strokeRect(v.x,v.y,v.width,v.height);ctx.fillText(names[key],v.x,Math.max(20,v.y-6));}else{ctx.beginPath();ctx.arc(v.x,v.y,9,0,Math.PI*2);ctx.stroke();ctx.fillText(names[key],v.x+13,v.y);}}
  $('selectionInfo').textContent=steps.map(k=>`${names[k]}：${layout[k]?'已设置':'未设置'}`).join(' / ');
}
$('bind').onclick=()=>action(async()=>{
  if(!shot||!layout)throw new Error('请先截图并校准');
  const names={title:'① 框选群标题',draft:'② 框选空白输入区域',neutral:'③ 点击无功能空白处',editor:'④ 点击文字输入位置',send:'⑤ 点击发送按钮中心'};
  const missing=steps.filter(s=>!layout[s]);
  if(missing.length){setStep(missing[0]);throw new Error(`尚未保存，请完成：${missing.map(s=>names[s]).join('、')}。`);}
  if(!$('bindConfirm').checked)throw new Error('尚未保存，请先勾选上方的群聊和空白输入框确认框。');
  const group=state.config.groups.find(g=>g.id===$('bindGroup').value);
  if(!group)throw new Error('请先选择需要绑定的群');
  await api('/api/bind',{groupId:group.id,captureId:shot.id,layout,confirmed:true});
  notice(`已成功保存群「${group.name}」的绑定。绑定其他群时，请先切换上方“当前绑定的群”，再打开对应微信群并重新获取截图。`);
},{button:'bind',feedbackId:'bindFeedback',label:'正在保存群绑定…'});
function make(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
async function refresh(){
  const next=await api('/api/status');state=next;
  if(!loaded){$('groups').value=next.config.groups.map(g=>g.name).join('\n');$('message').value=next.config.message;$('startTime').value=timeText(next.config.startHour,next.config.startMinute);$('endTime').value=timeText(next.config.endHour,next.config.endMinute);$('roundUnit').value=next.config.roundUnit;$('interval').value=next.config.intervalSeconds;loaded=true;}
  const c=next.config,r=next.runner,active=r.running||r.busy;
  $('state').textContent=r.running?`${r.kind==='manual'?'手动':'定时'}${r.mode==='real'?'发送':'模拟'} · 运行中`:(r.busy?'正在停止…':'已停止');$('state').className=`badge ${r.running?'running':''}`;
  $('hours').textContent=`${timeText(c.startHour,c.startMinute)} — ${timeText(c.endHour,c.endMinute)}`;
  $('volume').textContent=`${next.rounds.length} 轮 / ${next.plan.length} 条`;$('gap').textContent=`${c.intervalSeconds} 秒`;$('clock').textContent=fmt(next.now,true);
  $('scheduleHint').textContent=`已保存：${c.roundUnit==='minute'?'每分钟':'每小时'}一轮。${next.plan.length?`当天最后一个群计划 ${fmt(next.plan.at(-1).at,true)} 发送。`:''}定时任务迟到超过 ${c.graceSeconds} 秒会跳过，不补发。`;
  $('error').hidden=!r.error;$('error').textContent=r.error||'';
  $('configForm').querySelectorAll('input,textarea,button').forEach(el=>el.disabled=active);
  for(const id of ['capture','bind','bindGroup','resetLayout','resetBinding','resetAllBindings','dryStart','realStart','manualDry','manualReal','manualGroup','confirmReal'])$(id).disabled=active||$(id).dataset.pending==='true';
  const progress=r.progress;
  $('manualProgress').hidden=!progress;
  if(progress){
    const prefix=`${r.mode==='dry'?'手动模拟':'手动发送'}：已执行 ${progress.completed}/${progress.total} 个群（送达未核验）。`;
    let detail;
    if(r.error)detail=`在群「${progress.failedGroup||progress.currentGroup||'待核查'}」停止：${r.error}。请核查该群实际结果，再选择需要发送的单个群，避免重复发送已完成的群。`;
    else if(r.running&&progress.currentGroup)detail=`正在处理群「${progress.currentGroup}」，请不要切换窗口或操作鼠标键盘。`;
    else if(r.running&&progress.nextGroup){
      const seconds=Math.max(0,Math.ceil((progress.nextAt-next.now)/1000));
      detail=`下一群「${progress.nextGroup}」${seconds?`约 ${seconds} 秒后开始`:'即将开始'}。等待期间保持微信在前台，不要切到浏览器；完成后再查看结果。`;
    }else if(progress.completed===progress.total)detail='本轮已完成，可以再次点击“手动发送”开启新一轮；持续循环请使用“启动真实发送”。';
    else detail='本轮已停止，尚未执行的群不会继续发送。';
    feedback('manualProgress',prefix+detail,Boolean(r.error));
  }
  $('stop').disabled=!active;
  const selected=$('bindGroup').value;
  const ids=c.groups.map(g=>g.id).join(',');
  if($('bindGroup').dataset.ids!==ids){$('bindGroup').replaceChildren(...c.groups.map(g=>{const option=make('option',g.name);option.value=g.id;return option;}));$('bindGroup').dataset.ids=ids;if(c.groups.some(g=>g.id===selected))$('bindGroup').value=selected;}
  selectedBindingStatus();
  if($('manualGroup').dataset.ids!==ids){
    const previous=$('manualGroup').value,all=make('option','全部群 · 发送一轮');all.value='all';
    $('manualGroup').replaceChildren(all,...c.groups.map(g=>{const option=make('option',g.name);option.value=g.id;return option;}));
    $('manualGroup').dataset.ids=ids;
    if(c.groups.some(g=>g.id===previous))$('manualGroup').value=previous;
  }
  manualReadiness();
  $('bindingList').replaceChildren(...c.groups.map(g=>make('span',`${next.bindings[g.id]?'✓':'○'} ${g.name}`,`binding ${next.bindings[g.id]?'ready':''}`)));
  const rows=[];
  const byRound=new Map();for(const task of next.plan){const tasks=byRound.get(task.roundLabel)||[];tasks.push(task);byRound.set(task.roundLabel,tasks);}
  for(const minute of next.rounds){const label=timeText(Math.floor(minute/60),minute%60),tasks=byRound.get(label)||[];const tr=document.createElement('tr');for(const t of [label,tasks.length?fmt(tasks[0].at,true):'—',tasks.length?fmt(tasks.at(-1).at,true):'—',String(tasks.length)])tr.append(make('td',t));rows.push(tr);}
  $('plan').replaceChildren(...rows);
  if(next.logs.length)$('logs').replaceChildren(...next.logs.toReversed().map(log=>{const div=make('div','',`log ${log.level==='error'?'error-log':''}`);div.append(make('time',new Date(log.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})),make('span',`${log.group?`「${log.group}」 `:''}${log.message}`));return div;}));
}
try{({token}=await api('/api/session'));await refresh();}catch(e){notice(`无法连接本地服务：${e.message}`,true);}
setInterval(()=>{refresh().catch(e=>notice(`服务连接中断：${e.message}`,true));},3000);
