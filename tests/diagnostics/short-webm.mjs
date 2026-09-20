// Manual, dependency-free diagnostic. Requires local VLC and FFmpeg, not app runtime.
// Original input is read-only; each invocation creates a new ignored artifact folder.
import {readFile, writeFile, mkdir, mkdtemp, readdir} from 'node:fs/promises';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const vlc = process.env.VLC_PATH || 'C:/Program Files/VideoLAN/VLC/vlc.exe';
const sha = data => createHash('sha256').update(data).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function vint(data, offset, id = false) {
  let length = 1;
  while (length <= 8 && !(data[offset] & (0x80 >> (length - 1)))) length++;
  if (length > 8) throw new Error(`Invalid VINT at ${offset}`);
  let value = id ? data[offset] : data[offset] & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + data[offset + i];
  return {value, length};
}
export function elements(data) {
  const result = [];
  for (let at = 0; at < data.length;) {
    const id = vint(data, at, true), size = vint(data, at + id.length);
    const start = at + id.length + size.length, end = start + size.value;
    if (end > data.length) throw new Error(`Truncated element ${id.value.toString(16)}`);
    result.push({id:id.value, raw:data.subarray(at,end), data:data.subarray(start,end)});
    at = end;
  }
  return result;
}
function uint(value) {
  const bytes = [value % 256];
  while ((value = Math.floor(value / 256))) bytes.unshift(value % 256);
  return Buffer.from(bytes);
}
function element(id, data) {
  let length = 1;
  while (data.length >= 2 ** (7 * length) - 1) length++;
  const size = Buffer.alloc(length);
  let remaining = data.length;
  for (let i = length - 1; i >= 0; i--) { size[i] = remaining % 256; remaining = Math.floor(remaining / 256); }
  size[0] |= 1 << (8 - length);
  return Buffer.concat([uint(id), size, data]);
}
const master = (id, children) => element(id, Buffer.concat(children));
const integer = (id, value) => element(id, uint(value));

export function inspect(data) {
  const top = elements(data), segment = elements(top.find(e => e.id === 0x18538067).data);
  const info = segment.find(e => e.id === 0x1549a966);
  const duration = elements(info.data).find(e => e.id === 0x4489).data.readDoubleBE();
  const tracks = segment.find(e => e.id === 0x1654ae6b);
  const track = elements(tracks.data).find(e => e.id === 0xae);
  const packets = [];
  for (const cluster of segment.filter(e => e.id === 0x1f43b675)) {
    const children = elements(cluster.data);
    const timeBytes = children.find(e => e.id === 0xe7).data;
    const time = timeBytes.length ? timeBytes.readUIntBE(0,timeBytes.length) : 0;
    for (const child of children) {
      const block = child.id === 0xa3 ? child.data : child.id === 0xa0 ? elements(child.data).find(e => e.id === 0xa1)?.data : null;
      if (!block) continue;
      const trackId = vint(block, 0);
      const payload = block.subarray(trackId.length + 3);
      packets.push({time:time + block.readInt16BE(trackId.length), payload,
        flags:block[trackId.length + 2], track:trackId.value});
    }
  }
  return {header:top[0].raw, info, tracks, track, duration, packets};
}
export function variant(original, {defaultDuration = false, blockDuration = false, hiddenDrain = 0, hiddenAtEnd = false, invisibleFlag = true, subdivisions = 1, count, fps = 7} = {}) {
  const parsed = inspect(original), packets = parsed.packets.slice(0, count);
  const duration = count ? packets.length * 1000 / fps : parsed.duration;
  const frameMs = duration / packets.length;
  const trackChildren = elements(parsed.track.data).filter(e => e.id !== 0x23e383).map(e => e.raw);
  if (defaultDuration) trackChildren.push(integer(0x23e383, Math.round(frameMs * 1e6)));
  const track = master(0x1654ae6b, [master(0xae, trackChildren)]);
  const info = master(0x1549a966, elements(parsed.info.data).map(e => {
    if (e.id !== 0x4489) return e.raw;
    const value = Buffer.alloc(8); value.writeDoubleBE(duration); return element(0x4489, value);
  }));
  const blocks = [];
  for (let i=0;i<packets.length;i++) {
    const packet=packets[i], start=count ? Math.round(i*frameMs) : packet.time;
    const end=i+1===packets.length ? duration : count ? Math.round((i+1)*frameMs) : packets[i+1].time;
    const pieces=i+1===packets.length ? subdivisions : 1;
    for(let piece=0;piece<pieces;piece++) {
      const time=piece ? Math.round(start+(end-start)*piece/pieces) : start;
      const until=Math.round(start+(end-start)*(piece+1)/pieces);
      const prefix=Buffer.alloc(4); prefix[0]=0x81; prefix.writeInt16BE(time,1); prefix[3]=blockDuration ? 0 : 0x80;
      const block=element(blockDuration ? 0xa1 : 0xa3,Buffer.concat([prefix,packet.payload]));
      blocks.push(blockDuration ? master(0xa0,[block,integer(0x9b,until-time)]) : block);
    }
  }
  for (let i = 0; i < hiddenDrain; i++) {
    const last = packets.at(-1), payload = Buffer.from(last.payload);
    payload[0] &= ~0x10; // VP8 show_frame=0: decoded reference, no visible picture.
    const prefix = Buffer.alloc(4); prefix[0] = 0x81;
    prefix.writeInt16BE(hiddenAtEnd ? Math.ceil(duration)-1 : count ? Math.round((packets.length-1)*frameMs) : last.time,1);
    prefix[3] = invisibleFlag ? 0x88 : 0x80; // Compare container vs codec visibility signalling.
    blocks.push(element(0xa3,Buffer.concat([prefix,payload])));
  }
  // Deliberately minimal valid Segment: no stale SeekHead/Cue offsets after mutation.
  return Buffer.concat([parsed.header,master(0x18538067,[info,track,master(0x1f43b675,[integer(0xe7,0),...blocks])])]);
}

export async function measureVlc(file, directory, extra = []) {
  await mkdir(directory, {recursive:true});
  const server = createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const args = ['--ignore-config','--no-one-instance','--no-media-library','--intf=dummy',
    '--extraintf=http','--http-host=127.0.0.1',`--http-port=${port}`,'--http-password=diagnostic',
    '--vout=dummy','--aout=dummy','--verbose=2',
    '--video-filter=scene','--scene-ratio=1',`--scene-path=${directory}`,'--scene-prefix=frame-',
    ...extra,pathToFileURL(file).href,'vlc://quit'];
  const child = spawn(vlc,args,{windowsHide:true});
  let log = '', closed = false;
  child.stdout.on('data',chunk => { log += chunk; });
  child.stderr.on('data',chunk => { log += chunk; });
  child.on('close',() => { closed = true; });
  const samples = [];
  const started = Date.now();
  try {
    while (!closed && Date.now() - started < 6000) {
      await delay(100);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/requests/status.json`, {
          headers:{Authorization:`Basic ${Buffer.from(':diagnostic').toString('base64')}`},
          signal:AbortSignal.timeout(500)
        });
        const sample = await response.json();
        samples.push({ms:Date.now()-started,state:sample.state,time:sample.time,stats:sample.stats});
        if (sample.state === 'paused' && Date.now()-started > 2000) break;
      } catch {}
    }
  } finally {
    if (!closed) { const done = new Promise(resolve => child.once('close',resolve)); child.kill(); await done; }
  }
  const images = (await readdir(directory)).filter(name => name.endsWith('.png')).sort();
  const result = {file, args, deadlock:log.includes('buffer deadlock prevented'),
    threads:log.match(/using frame thread mode with (\d+) threads/)?.[1],
    decoded:Math.max(0,...samples.map(s => s.stats?.decodedvideo || 0)),
    displayed:Math.max(0,...samples.map(s => s.stats?.displayedpictures || 0)),
    sceneFrames:images.length, sceneHashes:await Promise.all(images.map(async name => sha(await readFile(path.join(directory,name))))),
    last:samples.at(-1)};
  await writeFile(path.join(directory,'vlc.log'),log);
  await writeFile(path.join(directory,'result.json'),JSON.stringify({result,samples},null,2));
  return result;
}
export function measureNative(file, directory, {width=640,height=480,threads=0} = {}) {
  const shell = process.env.PWSH_PATH || 'C:/Users/master/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
  const run = spawnSync(shell,['-NoProfile','-File',path.resolve('tests/diagnostics/vlc-render.ps1'),
    '-MediaPath',file,'-Width',String(width),'-Height',String(height),'-Threads',String(threads),
    ...(directory ? ['-OutputDirectory',directory] : [])],
  {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
  if (run.error || run.status !== 0) throw new Error(String(run.error || run.stderr));
  const result = JSON.parse(run.stdout.trim().split('\n').at(-1));
  result.deadlock = run.stderr.includes('buffer deadlock prevented');
  result.threads = run.stderr.match(/using frame thread mode with (\d+) threads/)?.[1];
  return {result, log:run.stderr};
}
export function ffmpegFrames(file) {
  const run = spawnSync('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-fps_mode','passthrough','-f','framemd5','-'],{encoding:'utf8',windowsHide:true});
  if (run.status !== 0) throw new Error(run.stderr);
  return run.stdout.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = path.resolve(process.argv[2] || 'C:/Users/master/Videos/Test3.webm');
  await mkdir('test-results',{recursive:true});
  const root = await mkdtemp(path.resolve('test-results/vlc-short-'));
  console.log(`Artifacts: ${root}`);
  const original = await readFile(file), parsed = inspect(original);
  const results = [];
  const variants = [
    ['original', original, []],
    ['original-one-thread-control', original, ['--avcodec-threads=1']],
    ['default-duration',variant(original,{defaultDuration:true}),[]],
    ['both-durations',variant(original,{defaultDuration:true,blockDuration:true}),[]],
    ['hidden-drain-six',variant(original,{defaultDuration:true,hiddenDrain:6}),[]]
  ];
  for (const [name, bytes, extra] of variants) {
    const output = path.join(root,`${name}.webm`); await writeFile(output,bytes);
    const result = await measureVlc(output,path.join(root,name),extra);
    result.name = name;
    result.packetHashes = inspect(bytes).packets.map(p => sha(p.payload));
    result.decodedHashes = ffmpegFrames(output);
    result.durationMs = inspect(bytes).duration;
    results.push(result);
    console.log(JSON.stringify({name,deadlock:result.deadlock,decoded:result.decoded,displayed:result.displayed,sceneFrames:result.sceneFrames,uniqueScenes:new Set(result.sceneHashes).size,durationMs:result.durationMs}));
  }
  const remux = path.join(root,'ffmpeg-remux.webm');
  const ff = spawnSync('ffmpeg',['-v','warning','-n','-i',file,'-map','0:v:0','-c','copy',remux],{encoding:'utf8',windowsHide:true});
  if (ff.status !== 0) throw new Error(ff.stderr);
  const result = await measureVlc(remux,path.join(root,'ffmpeg-remux'));
  result.name = 'ffmpeg-remux'; result.decodedHashes = ffmpegFrames(remux); results.push(result);
  console.log(JSON.stringify({name:result.name,deadlock:result.deadlock,decoded:result.decoded,displayed:result.displayed,sceneFrames:result.sceneFrames}));
  await writeFile(path.join(root,'summary.json'),JSON.stringify({input:file,sha256:sha(original),packetCount:parsed.packets.length,results},null,2));
}
