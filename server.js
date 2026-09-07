const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'learning-secret-change-me';
const DB_FILE = path.join(__dirname, 'data.json');

function loadDb() {
  if (!fs.existsSync(DB_FILE)) return { users: [], friendRequests: [], friendships: [], messages: [] };
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDb() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function id() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function publicUser(u) { return { id: u.id, username: u.username, createdAt: u.createdAt }; }
function tokenFor(u) { return jwt.sign({ userId: u.id }, JWT_SECRET, { expiresIn: '7d' }); }
function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    const user = db.users.find(x => x.id === payload.userId);
    if (!user) return res.status(401).json({ error: 'Invalid user' });
    req.user = user; next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}
function areFriends(a,b) { return db.friendships.some(f => (f.a===a&&f.b===b)||(f.a===b&&f.b===a)); }
function requestExists(from,to) { return db.friendRequests.some(r => r.from===from&&r.to===to&&r.status==='pending'); }

let db = loadDb();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const online = new Map(); // userId -> Set(socketId)

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', async (req,res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({error:'Username: 3-20 letters, numbers, or underscores'});
  if (password.length < 6) return res.status(400).json({error:'Password must be at least 6 characters'});
  if (db.users.some(u=>u.username===username)) return res.status(409).json({error:'Username already exists'});
  const user={id:id(),username,passwordHash:await bcrypt.hash(password,10),createdAt:new Date().toISOString()};
  db.users.push(user); saveDb();
  res.json({token:tokenFor(user),user:publicUser(user)});
});

app.post('/api/login', async (req,res) => {
  const username=String(req.body.username||'').trim().toLowerCase();
  const password=String(req.body.password||'');
  const user=db.users.find(u=>u.username===username);
  if (!user || !(await bcrypt.compare(password,user.passwordHash))) return res.status(401).json({error:'Invalid username or password'});
  res.json({token:tokenFor(user),user:publicUser(user)});
});

app.get('/api/me',auth,(req,res)=>res.json({user:publicUser(req.user)}));

app.get('/api/users',auth,(req,res)=>{
  const q=String(req.query.q||'').trim().toLowerCase();
  const users=db.users.filter(u=>u.id!==req.user.id && (!q || u.username.includes(q))).slice(0,50).map(publicUser);
  res.json({users});
});

app.get('/api/friends',auth,(req,res)=>{
  const ids=db.friendships.filter(f=>f.a===req.user.id||f.b===req.user.id).map(f=>f.a===req.user.id?f.b:f.a);
  res.json({friends:ids.map(x=>publicUser(db.users.find(u=>u.id===x))).filter(Boolean)});
});

app.get('/api/requests',auth,(req,res)=>{
  const incoming=db.friendRequests.filter(r=>r.to===req.user.id&&r.status==='pending').map(r=>({...r,fromUser:publicUser(db.users.find(u=>u.id===r.from))}));
  const outgoing=db.friendRequests.filter(r=>r.from===req.user.id&&r.status==='pending').map(r=>({...r,toUser:publicUser(db.users.find(u=>u.id===r.to))}));
  res.json({incoming,outgoing});
});

app.post('/api/friends/request',auth,(req,res)=>{
  const to=String(req.body.userId||'');
  if(to===req.user.id) return res.status(400).json({error:'Cannot add yourself'});
  const target=db.users.find(u=>u.id===to);
  if(!target) return res.status(404).json({error:'User not found'});
  if(areFriends(req.user.id,to)) return res.status(409).json({error:'Already friends'});
  if(requestExists(req.user.id,to)) return res.status(409).json({error:'Request already sent'});
  const reverse=db.friendRequests.find(r=>r.from===to&&r.to===req.user.id&&r.status==='pending');
  if(reverse){ reverse.status='accepted'; db.friendships.push({a:req.user.id,b:to,createdAt:new Date().toISOString()}); saveDb(); notifyUser(to,'friend-accepted',{user:publicUser(req.user)}); return res.json({message:'Friend request accepted'}); }
  db.friendRequests.push({id:id(),from:req.user.id,to,status:'pending',createdAt:new Date().toISOString()}); saveDb();
  notifyUser(to,'friend-request',{from:publicUser(req.user)});
  res.json({message:'Friend request sent'});
});

app.post('/api/friends/respond',auth,(req,res)=>{
  const request=db.friendRequests.find(r=>r.id===req.body.requestId&&r.to===req.user.id&&r.status==='pending');
  if(!request) return res.status(404).json({error:'Request not found'});
  const accept=Boolean(req.body.accept);
  request.status=accept?'accepted':'rejected';
  if(accept) db.friendships.push({a:request.from,b:request.to,createdAt:new Date().toISOString()});
  saveDb();
  const fromUser=db.users.find(u=>u.id===request.from);
  if(accept) notifyUser(request.from,'friend-accepted',{user:publicUser(req.user)});
  res.json({message:accept?'Friend request accepted':'Friend request rejected',user:publicUser(fromUser)});
});

app.get('/api/messages/:friendId',auth,(req,res)=>{
  const friend=db.users.find(u=>u.id===req.params.friendId);
  if(!friend || !areFriends(req.user.id,friend.id)) return res.status(403).json({error:'You can only chat with friends'});
  const messages=db.messages.filter(m=>(m.from===req.user.id&&m.to===friend.id)||(m.from===friend.id&&m.to===req.user.id)).slice(-100);
  res.json({messages});
});

function notifyUser(userId,event,payload){
  const sockets=online.get(userId); if(!sockets) return;
  for(const sid of sockets) io.to(sid).emit(event,payload);
}
function addOnline(userId,socketId){ if(!online.has(userId)) online.set(userId,new Set()); online.get(userId).add(socketId); }
function removeOnline(userId,socketId){ const s=online.get(userId); if(!s) return; s.delete(socketId); if(!s.size) online.delete(userId); }
function isOnline(userId){ return online.has(userId); }

io.use((socket,next)=>{
  try {
    const token=socket.handshake.auth && socket.handshake.auth.token;
    const payload=jwt.verify(token,JWT_SECRET);
    const user=db.users.find(u=>u.id===payload.userId);
    if(!user) return next(new Error('Unauthorized'));
    socket.user=user; next();
  } catch { next(new Error('Unauthorized')); }
});

io.on('connection',socket=>{
  const me=socket.user; addOnline(me.id,socket.id);
  socket.emit('online-users',{userIds:[...online.keys()]});
  socket.broadcast.emit('presence',{userId:me.id,online:true});

  socket.on('send-message',(data,ack)=>{
    const to=String(data?.to||''); const text=String(data?.text||'').trim();
    if(!to || !text || text.length>2000) return ack?.({ok:false,error:'Invalid message'});
    if(!areFriends(me.id,to)) return ack?.({ok:false,error:'You can only message friends'});
    const recipient=db.users.find(u=>u.id===to); if(!recipient) return ack?.({ok:false,error:'User not found'});
    const message={id:id(),from:me.id,to,text,createdAt:new Date().toISOString()};
    db.messages.push(message); saveDb();
    notifyUser(to,'new-message',{message});
    ack?.({ok:true,message});
  });

  socket.on('typing',(data)=>{ const to=String(data?.to||''); if(areFriends(me.id,to)) notifyUser(to,'typing',{userId:me.id,typing:Boolean(data.typing)}); });
  socket.on('disconnect',()=>{ removeOnline(me.id,socket.id); if(!isOnline(me.id)) socket.broadcast.emit('presence',{userId:me.id,online:false}); });
});

app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
server.listen(PORT,()=>console.log(`Messenger running at http://localhost:${PORT}`));
