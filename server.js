const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {WebSocketServer,WebSocket}=require('ws');
const PORT=process.env.PORT||3000;
const MAX_PLAYERS=8;
const rooms=new Map();
const html=fs.readFileSync(path.join(__dirname,'index.html'));
const sessions=new Map();
const attempts=new Map();
const SESSION_AGE=8*60*60*1000;
const PASSWORD=process.env.APEX_ADMIN_PASSWORD||'';
if(!PASSWORD)console.warn('Owner login disabled: set APEX_ADMIN_PASSWORD in Render environment settings.');
function json(res,status,obj,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(obj))}
function cookie(req,name){const all=req.headers.cookie||'';const part=all.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));return part?part.slice(name.length+1):''}
function authed(req){const token=cookie(req,'apex_owner');if(!token)return false;const exp=sessions.get(token);if(!exp)return false;if(Date.now()>exp){sessions.delete(token);return false}return true}
function cookieHeader(req,token,expire=false){const secure=req.socket.encrypted||req.headers['x-forwarded-proto']==='https:'||req.headers['x-forwarded-proto']==='https';return 'apex_owner='+token+'; Path=/api/admin; HttpOnly; SameSite=Strict; '+(secure?'Secure; ':'')+(expire?'Max-Age=0':'Max-Age=28800')}
function readJson(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',chunk=>{raw+=chunk;if(raw.length>2048){reject(Error('Too large'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'))}catch(e){reject(e)}});req.on('error',reject)})}
function sameOrigin(req){const origin=req.headers.origin;if(!origin)return false;try{const u=new URL(origin);return u.host===req.headers.host&&u.protocol===(String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim()==='https'?'https:':'http:')}catch{return false}}
function safeEqual(a,b){const x=crypto.createHash('sha256').update(a).digest(),y=crypto.createHash('sha256').update(b).digest();return crypto.timingSafeEqual(x,y)}
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'||pathname==='/index.html'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(html);
  }
  if(pathname==='/owner'||pathname==='/owner/'){res.writeHead(302,{'Location':'/?owner=1','Cache-Control':'no-store'});return res.end()}
  if(pathname==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('OK')}
  if(pathname==='/api/admin/status'&&req.method==='GET')return json(res,200,{authenticated:authed(req)});
  if(pathname.startsWith('/api/admin/')&&req.method==='POST'){
    if(!sameOrigin(req))return json(res,403,{error:'Invalid request origin'});
    if(pathname==='/api/admin/login'){
      const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
      const now=Date.now(),state=attempts.get(ip)||{count:0,until:0};
      if(state.until>now)return json(res,429,{error:'Too many attempts. Try again in 15 minutes.'});
      let body;try{body=await readJson(req)}catch{return json(res,400,{error:'Invalid request'})}
      const guess=typeof body.password==='string'?body.password:'';
      if(!PASSWORD||!guess||!safeEqual(guess,PASSWORD)){
        state.count++;if(state.count>=5){state.count=0;state.until=now+15*60*1000}attempts.set(ip,state);
        return json(res,401,{error:'Incorrect password or owner login not configured.'});
      }
      attempts.delete(ip);
      const token=crypto.randomBytes(32).toString('hex');sessions.set(token,now+SESSION_AGE);
      return json(res,200,{ok:true},{'Set-Cookie':cookieHeader(req,token)});
    }
    if(!authed(req))return json(res,401,{error:'Owner sign-in required'});
    if(pathname==='/api/admin/logout'){sessions.delete(cookie(req,'apex_owner'));return json(res,200,{ok:true},{'Set-Cookie':cookieHeader(req,'',true)})}
    if(pathname==='/api/admin/grant'){
      let body;try{body=await readJson(req)}catch{return json(res,400,{error:'Invalid request'})}
      if(!['credits','cars','upgrades'].includes(body.action))return json(res,400,{error:'Invalid action'});
      // The game currently saves locally. This response authorizes the client-side save change.
      return json(res,200,{action:body.action,...(body.action==='credits'?{amount:10000000}:{})});
    }
  }
  return json(res,404,{error:'Not found'});
});
const wss=new WebSocketServer({server,maxPayload:1024});
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function code(){let c;do{c=Array.from({length:6},()=>alphabet[crypto.randomInt(alphabet.length)]).join('')}while(rooms.has(c));return c}
function send(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
function broadcast(room,obj,except){for(const p of room.players.values())if(p.ws!==except)send(p.ws,obj)}
function roster(room){const players=[...room.players.values()].map(p=>({id:p.id,name:p.name}));broadcast(room,{type:'roster',players,host:room.host})}
function leave(ws){if(!ws.room)return;const room=rooms.get(ws.room);if(room){room.players.delete(ws.pid);if(room.host===ws.pid)room.host=room.players.keys().next().value||null;if(!room.players.size)rooms.delete(ws.room);else roster(room)}ws.room=null;ws.pid=null}
let nextId=1;
wss.on('connection',ws=>{
  ws.room=null;ws.pid=null;ws.lastPosition=0;ws.lastMessage=0;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw.toString())}catch{return}
    if(!m||typeof m!=='object'||typeof m.type!=='string')return;
    const now=Date.now();if(now-ws.lastMessage<12)return;ws.lastMessage=now;
    if(m.type==='create'||m.type==='join'){
      if(ws.room){send(ws,{type:'error',message:'Leave your current room first.'});return}
      const name=String(m.name||'Driver').replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,18)||'Driver';
      let room;
      if(m.type==='create'){if(rooms.size>=300){send(ws,{type:'error',message:'Server is full. Try again later.'});return}const id=code();room={code:id,host:null,track:0,players:new Map()};rooms.set(id,room)}
      else{const id=String(m.code||'').toUpperCase();room=rooms.get(id);if(!room){send(ws,{type:'error',message:'Room not found. Check the code.'});return}}
      if(room.players.size>=MAX_PLAYERS){send(ws,{type:'error',message:'This room is full.'});return}
      ws.room=room.code;ws.pid=String(nextId++);if(!room.host)room.host=ws.pid;
      room.players.set(ws.pid,{id:ws.pid,name,ws});
      send(ws,{type:'joined',code:room.code,id:ws.pid,host:room.host,track:room.track,players:[...room.players.values()].map(p=>({id:p.id,name:p.name}))});roster(room);return;
    }
    if(!ws.room)return;const room=rooms.get(ws.room);if(!room)return;
    if(m.type==='track'){
      if(room.host!==ws.pid||!Number.isInteger(m.track)||m.track<0||m.track>18)return;
      room.track=m.track;broadcast(room,{type:'track',track:room.track},ws);return;
    }
    if(m.type==='position'){
      if(now-ws.lastPosition<50)return;ws.lastPosition=now;
      const {x,y,a}=m;
      if(![x,y,a].every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(x)>100000||Math.abs(y)>100000||Math.abs(a)>10000)return;
      const carId=typeof m.carId==='string'?m.carId.slice(0,24):'s15';
      broadcast(room,{type:'position',id:ws.pid,x,y,a,carId},ws);
    }
  });
  ws.on('close',()=>leave(ws));ws.on('error',()=>leave(ws));
});
server.listen(PORT,()=>console.log('APEX DRIFT multiplayer running on port '+PORT));
