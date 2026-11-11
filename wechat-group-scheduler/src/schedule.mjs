import { createHash } from 'node:crypto';

export const defaults = {
  timezone: 'Asia/Shanghai', startHour: 7, startMinute: 0, endHour: 20, endMinute: 0, roundUnit: 'hour',
  intervalSeconds: 60, graceSeconds: 45, message: '', groups: [], layout: null,
};

export function groupId(name) {
  return createHash('sha256').update(name).digest('hex').slice(0, 24);
}

export function validateConfig(input) {
  const c = { ...defaults, ...input };
  if (c.timezone !== 'Asia/Shanghai') throw new Error('本项目使用北京时间 Asia/Shanghai');
  for (const key of ['startHour', 'startMinute', 'endHour', 'endMinute', 'intervalSeconds', 'graceSeconds']) {
    if (!Number.isInteger(c[key])) throw new Error(`${key} 必须是整数`);
  }
  if (![c.startHour,c.endHour].every(h=>h>=0&&h<=23) || ![c.startMinute,c.endMinute].every(m=>m>=0&&m<=59)
    || c.startHour*60+c.startMinute > c.endHour*60+c.endMinute) throw new Error('时间范围应为同一天的 00:00–23:59，结束不能早于开始');
  if (!['hour','minute'].includes(c.roundUnit)) throw new Error('轮次单位只能选择按时或按分');
  if (c.intervalSeconds < 1 || c.intervalSeconds > 1800) throw new Error('群间隔需为 1–1800 秒');
  if (c.graceSeconds < 1 || c.graceSeconds > 59) throw new Error('迟到容忍需为 1–59 秒');
  if (typeof c.message !== 'string' || c.message.length > 4000) throw new Error('文案最长 4000 字');
  if (c.message.includes('\0')) throw new Error('文案不能包含空字符');
  if (!Array.isArray(c.groups) || c.groups.length > 30) throw new Error('群数量最多 30 个');
  const groups = c.groups.map(g => {
    const name = (typeof g === 'string' ? g : g.name)?.trim();
    if (!name || name.length > 100 || /[\r\n\0]/.test(name)) throw new Error('请填写有效的群名，每行一个');
    return { id: groupId(name), name };
  });
  if (new Set(groups.map(g => g.id)).size !== groups.length) throw new Error('群名不能重复');
  const span=Math.max(0,groups.length-1)*c.intervalSeconds;
  if (span >= (c.roundUnit==='minute'?60:3600)) throw new Error(c.roundUnit==='minute'?'每分钟模式的一轮群间隔总时长必须少于60秒，请缩短群间隔或减少群数量':'一轮必须在下一轮之前完成，群间隔总时长需少于3600秒');
  const lastRound=roundMinutes(c).at(-1);
  if (lastRound*60+span>=86400) throw new Error('最后一轮不能跨到次日，请提前结束时间或缩短群间隔');
  if (c.layout !== null) {
    const l = c.layout;
    for (const key of ['width', 'height']) {
      if (!Number.isInteger(l[key]) || l[key] < 100 || l[key] > 10000) throw new Error('校准窗口尺寸无效');
    }
    const r = l.title;
    for (const key of ['title','draft']) {
      const box=l[key];
      if (!box || !['x', 'y', 'width', 'height'].every(k => Number.isInteger(box[k]))) throw new Error('请框选群标题和空白输入区域');
      if (box.width < 20 || box.height < 10 || box.x < 0 || box.y < 0 || box.x + box.width > l.width || box.y + box.height > l.height) throw new Error('框选区域超出窗口');
    }
    for (const key of ['editor', 'send', 'neutral']) {
      const p = l[key];
      if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || p.x >= l.width || p.y >= l.height) throw new Error('输入框或发送按钮位置无效');
      if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) throw new Error('操作点不能位于标题框内');
    }
    // Only persist known numeric fields; never accept paths from the browser.
    const inside=(p,b)=>p.x>=b.x&&p.x<=b.x+b.width&&p.y>=b.y&&p.y<=b.y+b.height;
    if (!inside(l.editor,l.draft)) throw new Error('输入点击点必须在输入区域内');
    if (inside(l.neutral,l.draft)||inside(l.send,l.draft)) throw new Error('空白失焦点和发送按钮必须在输入区域外');
    const rect=b=>({x:b.x,y:b.y,width:b.width,height:b.height});
    const point=p=>({x:p.x,y:p.y});
    c.layout = { width:l.width,height:l.height,title:rect(r),draft:rect(l.draft),editor:point(l.editor),send:point(l.send),neutral:point(l.neutral) };
  }
  return { timezone: c.timezone, startHour:c.startHour, startMinute:c.startMinute, endHour:c.endHour, endMinute:c.endMinute, roundUnit:c.roundUnit,
    intervalSeconds:c.intervalSeconds, graceSeconds:c.graceSeconds,
    message:c.message, groups, layout:c.layout };
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit',
});
export function dayKey(now = new Date()) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(now).map(p => [p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function roundMinutes(config) {
  const rounds=[];
  const end=config.endHour*60+(config.endMinute??0);
  for(let minute=config.startHour*60+(config.startMinute??0);minute<=end;minute+=config.roundUnit==='minute'?1:60)rounds.push(minute);
  return rounds;
}

export function planForDay(config, date = dayKey()) {
  const tasks = [];
  for (const roundMinute of roundMinutes(config)) {
    const hour=Math.floor(roundMinute/60),minute=roundMinute%60;
    const label=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
    const round = Date.parse(`${date}T${label}:00+08:00`);
    // Preserve old whole-hour keys, including when switching to minute mode.
    const roundKey=minute===0?String(hour):`${hour}:${String(minute).padStart(2,'0')}`;
    config.groups.forEach((group, index) => tasks.push({
      key:`${date}/${roundKey}/${group.id}`, group, hour, roundAt:round, roundLabel:label,
      at:round + index * config.intervalSeconds * 1000,
    }));
  }
  return tasks;
}

export function layoutHash(layout) {
  return createHash('sha256').update(JSON.stringify(layout)).digest('hex');
}
