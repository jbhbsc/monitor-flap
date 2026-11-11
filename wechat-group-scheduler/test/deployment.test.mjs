import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {initialize} from '../public/bootstrap.js';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');

test('Vercel 预览不加载本机程序，禁用发送操作并展示本机入口',async()=>{
  const {document}=parseHTML(html);
  const result=await initialize({hostname:'wechat.vercel.app',document,loadLocal:()=>{
    throw new Error('在线预览不能加载本机程序');
  }});
  assert.equal(result,'preview');
  assert.equal(document.getElementById('deploymentNotice').hidden,false);
  assert.match(document.getElementById('state').textContent,/在线预览/);
  for(const el of document.querySelectorAll('button,input,textarea,select'))assert.equal(el.disabled,true);
  assert.equal(document.querySelector('.local-link').getAttribute('href'),'http://127.0.0.1:8787/');
});

test('本机页面仍加载原程序，不显示部署提示',async()=>{
  for(const hostname of ['127.0.0.1','localhost']){
    const {document}=parseHTML(html);
    let loaded=0;
    assert.equal(await initialize({hostname,document,loadLocal:async()=>{loaded++;}}),'local');
    assert.equal(loaded,1);
    assert.equal(document.getElementById('deploymentNotice').hidden,true);
  }
});
