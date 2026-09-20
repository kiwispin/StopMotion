// Independent verification of a fresh large export.
// Compares the finished movie to the original PNGs held in the saved binary project
// (read in bounded slices; the 1 GiB container is never loaded whole). Test-only.
import {readFile, writeFile, open, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';

const [webm, backup, outdir] = process.argv.slice(2);
if (!webm || !backup || !outdir)
  throw new Error('Usage: verify-large-export.mjs <export.webm> <backup.stopmotion> <outdir>');
await mkdir(outdir, {recursive: true});
const ff = (args, options = {}) => execFileSync('ffmpeg', args, {windowsHide: true, ...options});
const probeArgs = file => ['-v', 'error', '-select_streams', 'v:0', '-show_packets',
  '-show_data_hash', 'sha256', '-show_entries', 'packet=pts_time,duration_time,data_hash',
  '-show_streams', '-show_format', '-of', 'json', file];
const probe = JSON.parse(execFileSync('ffprobe', probeArgs(webm),
  {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true}));
const bytes = await readFile(webm);
const sha256 = createHash('sha256').update(bytes).digest('hex');

// --- Metadata: 700 exposures + 7 final-exposure copies expected by design -----------
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
check(probe.packets.length === 707, 'packets=' + probe.packets.length + ' expected 707');
check(Number(probe.streams[0].width) === 1280 && Number(probe.streams[0].height) === 720,
  'dimensions=' + probe.streams[0].width + 'x' + probe.streams[0].height);
check(Math.abs(Number(probe.format.duration) - 700 / 24) < 0.001,
  'duration=' + probe.format.duration);
const interval = 1000 / 24;
const packetTime = index => index < 700 ? Math.round(index * interval)
  : Math.round(Math.round(699 * interval) + (Math.round(700 * interval) - Math.round(699 * interval)) * (index - 699) / 8);
let maxOnsetErrorMs = 0;
for (let i = 0; i < 700; i++)
  maxOnsetErrorMs = Math.max(maxOnsetErrorMs, Math.abs(Number(probe.packets[i].pts_time) * 1000 - packetTime(i)));
check(maxOnsetErrorMs <= 1, 'max 700-onset error=' + maxOnsetErrorMs + 'ms');
let maxDurationErrorMs = 0;
for (let i = 0; i < 707; i++)
  maxDurationErrorMs = Math.max(maxDurationErrorMs,
    Math.abs(Number(probe.packets[i].duration_time) * 1000 - (packetTime(i + 1) - packetTime(i))));
check(maxDurationErrorMs <= 1, 'max packet duration error=' + maxDurationErrorMs + 'ms');
const lastHash = probe.packets[699].data_hash;
let copiesMatch = true;
for (let i = 700; i < 707; i++) {
  if (probe.packets[i].data_hash !== lastHash) copiesMatch = false;
  if (!(Number(probe.packets[i].pts_time) > Number(probe.packets[i - 1].pts_time))) copiesMatch = false;
  if (Number(probe.packets[i].pts_time) * 1000 >= Math.round(700 * interval)) copiesMatch = false;
}
check(copiesMatch, 'final-exposure copies do not match their expected timing/bytes');

// --- Extract originals in bounded reads, then decode both sequences at 320x180 ------
const handle = await open(backup, 'r');
const header = Buffer.alloc(12);
await handle.read(header, 0, 12, 0);
if (header.subarray(0, 8).toString() !== 'STOPMOT2') throw new Error('Not a binary v2 project.');
const metaLength = header.readUInt32LE(8);
const metaBuffer = Buffer.alloc(metaLength);
await handle.read(metaBuffer, 0, metaLength, 12);
const metadata = JSON.parse(metaBuffer.toString());
if (metadata.frames.length !== 700) throw new Error('Backup has ' + metadata.frames.length + ' frames');
const pngDir = path.join(outdir, 'originals');
await mkdir(pngDir, {recursive: true});
let offset = 12 + metaLength;
for (let i = 0; i < metadata.frames.length; i++) {
  const size = metadata.frames[i].size;
  const buffer = Buffer.alloc(size);
  await handle.read(buffer, 0, size, offset);
  offset += size;
  await writeFile(path.join(pngDir, 'original-' + String(i).padStart(4, '0') + '.png'), buffer);
}
await handle.close();

const W = 320, H = 180, BPP = 3, FRAME = W * H * BPP;
const originalsRaw = path.join(outdir, 'originals.raw');
const exportedRaw = path.join(outdir, 'exported.raw');
ff(['-v', 'error', '-framerate', '24', '-start_number', '0', '-i', path.join(pngDir, 'original-%04d.png'),
  '-vf', 'scale=' + W + ':' + H, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-y', originalsRaw]);
ff(['-v', 'error', '-i', webm, '-vf', 'scale=' + W + ':' + H, '-vsync', '0',
  '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-y', exportedRaw]);
const originals = await readFile(originalsRaw);
const exported = await readFile(exportedRaw);
const nOrig = Math.floor(originals.length / FRAME), nExp = Math.floor(exported.length / FRAME);
check(nOrig === 700, 'decoded original frames=' + nOrig);
check(nExp >= 700, 'decoded exported frames=' + nExp);

const mae = (a, aOff, b, bOff) => {
  let sum = 0;
  for (let i = 0; i < FRAME; i++) sum += Math.abs(a[aOff + i] - b[bOff + i]);
  return sum / FRAME;
};
const psnr = (a, aOff, b, bOff) => {
  let sum = 0;
  for (let i = 0; i < FRAME; i++) { const d = a[aOff + i] - b[bOff + i]; sum += d * d; }
  const mse = sum / FRAME;
  return mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse);
};

const frameMae = [];
for (let i = 0; i < 700; i++) frameMae.push(mae(originals, i * FRAME, exported, i * FRAME));
const sorted = [...frameMae].sort((a, b) => a - b);
const stats = {
  min: sorted[0], max: sorted.at(-1), mean: frameMae.reduce((a, b) => a + b, 0) / 700,
  p95: sorted[Math.floor(0.95 * 699)], p99: sorted[Math.floor(0.99 * 699)]
};
check(stats.max < 15, 'max per-frame MAE=' + stats.max.toFixed(3));

// Order: the exported frame must match its own original better than its neighbours.
let neighbourMatches = 0, neighbourTotal = 0;
for (let i = 0; i < 700; i++) {
  const own = frameMae[i];
  for (const j of [i - 1, i + 1]) {
    if (j < 0 || j >= 700) continue;
    neighbourTotal++;
    if (own < mae(originals, i * FRAME, exported, j * FRAME)) neighbourMatches++;
  }
}
check(neighbourMatches === neighbourTotal,
  'frame order: ' + neighbourMatches + '/' + neighbourTotal + ' own-frame wins');

const firstMiddleLast = [0, 350, 699].map(i => ({
  frame: i, mae: frameMae[i], psnr: psnr(originals, i * FRAME, exported, i * FRAME)
}));
for (const sample of firstMiddleLast) check(sample.mae < 15, 'sample frame ' + sample.frame + ' MAE=' + sample.mae);

const evidence = {
  verification: 'fresh exported WebM compared against originals inside the saved project',
  export: {file: path.resolve(webm), bytes: bytes.length, sha256, packets: probe.packets.length,
    dimensions: [Number(probe.streams[0].width), Number(probe.streams[0].height)],
    durationSeconds: Number(probe.format.duration), expectedDurationSeconds: 700 / 24,
    maxOnsetErrorMs, maxDurationErrorMs, finalExposureCopiesMatch: copiesMatch},
  sequence: {decodedOriginalFrames: nOrig, decodedExportedFrames: nExp,
    comparedFrames: 700, perFrameMae: stats, neighbourOrderWins: neighbourMatches,
    neighbourOrderTotal: neighbourTotal, firstMiddleLast},
  errors
};
await writeFile(path.join(outdir, 'VERIFY.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (errors.length) { console.error('VERIFICATION FAILED'); process.exit(1); }
console.log('VERIFICATION PASSED');
