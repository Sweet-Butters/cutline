import {createServer, ServerResponse, IncomingMessage} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';

// Serve registered playback files only. Large videos must not be buffered in
// full by the editor webview resource bridge before playback can begin.
export async function playbackServer() {
  const token=randomBytes(32).toString('hex');
  const files=new Map<string,string>(), ids=new Map<string,string>();
  async function serve(req:IncomingMessage,res:ServerResponse) {
    const file=files.get(req.url??'');
    if(!file){res.writeHead(404).end();return;}
    if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Range'}).end();return;}
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
    const info=await stat(file);
    if(!info.isFile()){res.writeHead(404).end();return;}
    const size=info.size;
    let start=0,end=size-1,status=200;
    const range=req.headers.range;
    if(range){
      const m=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}
      if(m[1]){start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1;}
      else {const suffix=Number(m[2]);start=Math.max(0,size-suffix);}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}
      status=206;
    }
    res.writeHead(status,{
      'Accept-Ranges':'bytes','Content-Type':file.endsWith('.webm')?'video/webm':file.endsWith('.mp3')?'audio/mpeg':file.endsWith('.jpg')?'image/jpeg':'video/mp4',
      'Access-Control-Allow-Origin':'*',
      'Content-Length':Math.max(0,end-start+1),'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
      ...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})
    });
    if(req.method==='HEAD'||size===0){res.end();return;}
    const stream=createReadStream(file,{start,end});
    res.on('close',()=>stream.destroy());
    stream.on('error',()=>res.destroy());
    stream.pipe(res);
  }
  const server=createServer((req,res)=>{void serve(req,res).catch(()=>{
    if(!res.headersSent)res.writeHead(404);res.end();
  });});
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
  });
  const address=server.address();
  if(!address||typeof address==='string')throw Error('No local playback port');
  const origin=`http://127.0.0.1:${address.port}`;
  return {
    origin,
    url(file:string){
      let id=ids.get(file);
      if(!id){id=`/${token}/${randomBytes(16).toString('hex')}`;ids.set(file,id);files.set(id,file);}
      return origin+id;
    },
    dispose(){files.clear();ids.clear();server.close();server.closeAllConnections();}
  };
}
