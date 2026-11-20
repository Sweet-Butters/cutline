import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {playbackServer} from '../playback';

test('local playback streams byte ranges and exposes only registered URLs',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cutline-range-'));
  const file=path.join(dir,'sample.webm');
  const data=Buffer.from('0123456789');await fs.writeFile(file,data);
  const media=await playbackServer();const url=media.url(file);
  try{
    assert.match(media.origin,/^http:\/\/127\.0\.0\.1:\d+$/);
    const full=await fetch(url);assert.equal(full.status,200);assert.equal(await full.text(),'0123456789');
    for(const [range,body,header] of [['bytes=3-5','345','bytes 3-5/10'],['bytes=7-','789','bytes 7-9/10'],['bytes=-2','89','bytes 8-9/10'],['bytes=8-99','89','bytes 8-9/10']]){
      const r=await fetch(url,{headers:{Range:range}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),header);assert.equal(await r.text(),body);
    }
    const head=await fetch(url,{method:'HEAD'});assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
    for(const range of ['bytes=10-','bytes=8-3','bytes=-0','bytes=1-2,4-5','bytes=-','nonsense'])assert.equal((await fetch(url,{headers:{Range:range}})).status,416);
    assert.equal((await fetch(media.origin+'/unknown')).status,404);
    assert.equal((await fetch(media.origin+'/../../package.json')).status,404);
    assert.equal((await fetch(url,{method:'POST'})).status,405);
    media.dispose();await assert.rejects(fetch(url));
  }finally{media.dispose();await fs.rm(dir,{recursive:true,force:true});}
});
