const http=require('http');
const fs=require('fs');
const path=require('path');
const {WebSocketServer,WebSocket}=require('ws');
const PORT=process.env.PORT||3000;
const MAX_PLAYERS=8;
const rooms=new Map();
const html=fs.readFileSync(path.join(__dirname,'index.html'));
const server=http.createServer((req,res)=>{
  if(req.url==='/'||req.url==='/index.html'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(html);
  }else if(req.url==='/health'){
    res.writeHead(200,{'Content-Type':'text/plain'});res.end('OK');
  }else{res.writeHead(404);res.end('Not found');}
});
const wss=new WebSocketServer({server,maxPayload:1024});
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function code(){let c;do{c=Array.from({length:6},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('')}while(rooms.has(c));return c}
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
      if(room.host!==ws.pid||!Number.isInteger(m.track)||m.track<0||m.track>14)return;
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
