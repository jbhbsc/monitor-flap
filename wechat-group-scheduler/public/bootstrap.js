// The hosted preview never calls the Windows-only API or accesses local data.
export async function initialize({hostname,document,loadLocal=()=>import('./app.js')}) {
  if (hostname==='127.0.0.1'||hostname==='localhost') {
    await loadLocal();
    return 'local';
  }
  document.getElementById('deploymentNotice').hidden=false;
  document.getElementById('state').textContent='在线预览 · 本机运行';
  document.querySelector('.eyebrow').textContent='WEB PREVIEW · WINDOWS 本机发送';
  document.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);
  document.getElementById('clock').textContent=new Intl.DateTimeFormat('zh-CN',{
    timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).format(Date.now());
  document.getElementById('logs').textContent='在线预览不读取本机配置和执行日志。';
  document.querySelector('footer').textContent='在线页面仅供预览。实际发送请运行 Windows 本机服务，保持桌面解锁、微信登录。';
  return 'preview';
}

if (typeof window!=='undefined') {
  await initialize({hostname:window.location.hostname,document:window.document});
}
