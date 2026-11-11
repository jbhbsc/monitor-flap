import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function bridge(action, data = {}, signal) {
  if (process.platform !== 'win32') return Promise.reject(new Error('微信操作仅支持 Windows'));
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../windows/bridge.ps1',import.meta.url)),'-Action',action],{
      windowsHide:true,stdio:['pipe','pipe','pipe'],signal,
    });
    let output='',errors='',settled=false;
    const finish=(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      if(error)reject(error);else resolve(result);
    };
    const timer=setTimeout(()=>{child.kill();finish(new Error('微信操作超时，结果未知，请手动检查'));},30000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',s=>{output+=s;if(output.length>30_000_000){child.kill();finish(new Error('微信返回数据过大'));}});
    child.stderr.on('data',s=>{errors+=s;});
    child.on('error',e=>finish(new Error(e.name==='AbortError'?'已停止操作，结果可能未知，请检查微信':e.message)));
    child.on('close',code=>{
      try {
        const result=JSON.parse(output.trim().replace(/^\uFEFF/,''));
        if(code!==0||!result.ok)throw new Error(result.error||errors||'微信操作失败');
        finish(null,result);
      }catch(e){finish(new Error(e.message+(output?'':` ${errors.slice(0,500)}`)));}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(data));
  });
}
