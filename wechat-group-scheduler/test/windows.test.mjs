import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { bridge } from '../src/bridge.mjs';

test('Windows前台激活：延迟可恢复、拒绝有上限、锁屏与操作中断立即停止', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const {stdout}=await promisify(execFile)('powershell.exe',[
    '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
    fileURLToPath(new URL('./foreground-fixture.ps1',import.meta.url)),
  ],{windowsHide:true,encoding:'utf8'});
  assert.deepEqual(JSON.parse(stdout.trim().replace(/^\uFEFF/,'')),{ok:true,checks:6});
});

// A synthetic two-row bitmap. This test only runs the offline "bind" action:
// it never captures the desktop, opens WeChat, moves the mouse, or types.
function crc32(bytes){
  let c=0xffffffff;
  for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}
  return (c^0xffffffff)>>>0;
}
function chunk(name,data){
  const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);
  length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));
  return Buffer.concat([length,type,data,crc]);
}
function fixture(){
  const header=Buffer.alloc(13);header.writeUInt32BE(4,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
  const red=Buffer.from([255,0,0,255]),blue=Buffer.from([0,0,255,255]);
  const rows=Buffer.concat([Buffer.from([0]),...Array(4).fill(red),Buffer.from([0]),...Array(4).fill(blue)]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

function bitmap(width,height,pixel){
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const rows=Buffer.alloc((width*4+1)*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const color=pixel(x,y);const pos=y*(width*4+1)+1+x*4;
    rows[pos]=color[0];rows[pos+1]=color[1];rows[pos+2]=color[2];rows[pos+3]=255;
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}

test('Windows 离线图像指纹：C#可编译、中文JSON通信正常、红蓝区域精确区分', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const result=await bridge('bind',{
    png:fixture().toString('base64'),group:'离线测试群，不操作微信',
    layout:{width:4,height:2,title:{x:0,y:0,width:4,height:1},draft:{x:0,y:1,width:4,height:1}},
  });
  const hash=pixel=>createHash('sha256').update(Buffer.concat(Array(4).fill(Buffer.from(pixel)))).digest('hex').toUpperCase();
  assert.equal(result.titleHash,hash([0,0,255,255]));
  assert.equal(result.draftHash,hash([255,0,0,255]));
  assert.notEqual(result.titleHash,result.draftHash);
  assert.equal(result.draftProfile.version,1);
  assert.deepEqual(result.draftProfile.background,[0,0,255]);
});

test('Windows空白校验：容许闪烁光标和轻微背景差异，拒绝文字、标点和异常位置', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const white=[250,250,250],black=[20,20,20];
  const rect=(x,y,left,top,width,height)=>x>=left&&x<left+width&&y>=top&&y<top+height;
  const images=[
    bitmap(120,60,()=>white),
    bitmap(120,60,(x,y)=>rect(x,y,8,8,2,24)?black:white),
    bitmap(120,60,(x,y)=>[249+x%2,249+x%2,249+x%2]),
    bitmap(120,60,(x,y)=>rect(x,y,8,8,10,16)?black:white),
    bitmap(120,60,(x,y)=>rect(x,y,8,26,2,2)?black:white),
    bitmap(120,60,(x,y)=>rect(x,y,8,8,2,24)||rect(x,y,18,8,2,24)?black:white),
    bitmap(120,60,(x,y)=>rect(x,y,70,8,2,24)?black:white),
    bitmap(120,60,()=>[180,180,180]),
  ];
  const result=await bridge('checkDraft',{images,draft:{x:0,y:0,width:120,height:60},background:white});
  assert.deepEqual(result.checks,[true,true,true,false,false,false,false,false]);
});

test('Windows绑定时也验证空白：有文字的输入区域拒绝保存', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const png=bitmap(120,100,(x,y)=>x>=8&&x<18&&y>=48&&y<64?[20,20,20]:[250,250,250]);
  await assert.rejects(()=>bridge('bind',{png,layout:{width:120,height:100,title:{x:0,y:0,width:30,height:20},draft:{x:0,y:40,width:120,height:60}}}),/无法确认输入框为空/);
});
