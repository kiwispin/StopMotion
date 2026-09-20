// Independent test-only reader for SMALL fixture downloads. Large project tests
// use filesystem paths, never Buffer/base64 conversion of their binary payloads.
export function asLegacyProject(buffer) {
  if (buffer.subarray(0,8).toString() !== 'STOPMOT2') return JSON.parse(buffer.toString());
  const length=buffer.readUInt32LE(8);
  const metadata=JSON.parse(buffer.subarray(12,12+length).toString());
  let offset=12+length;
  const media=entry=>{
    const url=`data:${entry.type};base64,${buffer.subarray(offset,offset+entry.size).toString('base64')}`;
    offset+=entry.size;return url;
  };
  const frames=metadata.frames.map(media);
  if(offset!==buffer.length) throw new Error('Invalid fixture container length.');
  return {...metadata,version:1,frames};
}
