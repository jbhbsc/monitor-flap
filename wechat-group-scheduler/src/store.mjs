import { mkdir, readFile, writeFile, rename, appendFile, open, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export class Store {
  constructor(dir) { this.dir = dir; this.records = {}; this.logs = []; }
  async init() {
    await mkdir(join(this.dir,'bindings'), {recursive:true});
    // Do not silently discard damaged state: that could cause duplicate sends.
    this.records = await this.read('state.json', {});
    if (!this.records || typeof this.records !== 'object' || Array.isArray(this.records)) throw new Error('state.json 已损坏，停止启动');
  }
  async read(name, fallback) {
    try { return JSON.parse(await readFile(join(this.dir,name), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  }
  async write(name, value) {
    const path = join(this.dir,name);
    const file = await open(`${path}.tmp`, 'w');
    try { await file.writeFile(JSON.stringify(value,null,2),'utf8'); await file.sync(); }
    finally { await file.close(); }
    await rename(`${path}.tmp`,path);
  }
  async record(key, value) {
    this.records[key] = { ...value, updatedAt:new Date().toISOString() };
    await this.write('state.json',this.records);
  }
  async recordMany(entries) {
    const updatedAt=new Date().toISOString();
    for(const [key,value] of entries)this.records[key]={...value,updatedAt};
    if(entries.length)await this.write('state.json',this.records);
  }
  async resetBindings(groupId=null) {
    if(groupId!==null&&!/^[a-f0-9]{24}$/.test(groupId))throw new Error('群标识无效');
    const names=groupId===null
      ? (await readdir(join(this.dir,'bindings'))).filter(n=>/^[a-f0-9]{24}\.json$/.test(n))
      : [`${groupId}.json`];
    for(const name of names)await this.write(`bindings/${name}`,null);
  }
  async log(level, message, extra = {}) {
    const entry = {at:new Date().toISOString(),level,message,...extra};
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.shift();
    await appendFile(join(this.dir,'events.jsonl'),JSON.stringify(entry)+'\n','utf8');
  }
}

export async function acquireLock(dir) {
  await mkdir(dir,{recursive:true});
  const path = join(dir,'server.lock');
  for (let attempt=0; attempt<2; attempt++) {
    try {
      const handle = await open(path,'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return () => unlink(path).catch(()=>{});
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(await readFile(path,'utf8'));
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('进程锁损坏，请核查 data/server.lock');
      try { process.kill(pid,0); }
      catch (probe) { if (probe.code === 'ESRCH') { await unlink(path); continue; } throw probe; }
      throw new Error('此项目已有进程运行，请先关闭原窗口');
    }
  }
  throw new Error('无法获取进程锁');
}
