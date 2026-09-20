import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const context=vm.createContext({console,Blob,Uint8Array,ArrayBuffer,DataView});
vm.runInContext(await readFile(new URL('../js/webm.js',import.meta.url),'utf8'),context);
for(const [value,expected] of [
  [268435454,[0x1f,0xff,0xff,0xfe]],
  [268435455,[0x08,0x0f,0xff,0xff,0xff]],
  [0xffffffff,[0x08,0xff,0xff,0xff,0xff]]
])test('EBML finite length '+value,()=>{
  const actual=Array.from(context.webm.encodeLength(value));
  assert.deepEqual(actual,expected);
  let width=1,mask=128;
  while(!(actual[0]&mask)){width++;mask>>=1;}
  assert.equal(width,actual.length);
  let decoded=actual[0]&(mask-1);
  for(let i=1;i<width;i++)decoded=decoded*256+actual[i];
  assert.equal(decoded,value);
});
