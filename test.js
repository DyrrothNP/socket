const { spawn } = require('child_process');
const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const base = 'http://127.0.0.1:3219';
try { fs.unlinkSync(path.join(__dirname, 'data.json')); } catch {}
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '3219', JWT_SECRET: 'test-secret' } });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function req(url, method='GET', body, token) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json();
  if (!r.ok) throw new Error(`${url}: ${d.error}`);
  return d;
}
async function main() {
  try {
    await wait(900);
    const a = await req('/api/register','POST',{username:'alice_test',password:'password'});
    const b = await req('/api/register','POST',{username:'bob_test',password:'password'});
    if (!a.token || !b.token) throw new Error('registration failed');
    const users = await req('/api/users?q=bob','GET',undefined,a.token);
    if (users.users.length !== 1) throw new Error('user search failed');
    await req('/api/friends/request','POST',{userId:b.user.id},a.token);
    const rb = await req('/api/requests','GET',undefined,b.token);
    if (rb.incoming.length !== 1) throw new Error('friend request failed');
    await req('/api/friends/respond','POST',{requestId:rb.incoming[0].id,accept:true},b.token);
    const friends = await req('/api/friends','GET',undefined,a.token);
    if (friends.friends.length !== 1) throw new Error('friendship failed');
    const sa = io(base,{auth:{token:a.token}});
    const sb = io(base,{auth:{token:b.token}});
    await Promise.all([
      new Promise((res,rej)=>{sa.once('connect',res);sa.once('connect_error',rej)}),
      new Promise((res,rej)=>{sb.once('connect',res);sb.once('connect_error',rej)})
    ]);
    const received = new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('socket message timeout')),4000);
      sb.once('new-message',d=>{clearTimeout(timer);resolve(d.message);});
    });
    await new Promise((resolve,reject)=>sa.emit('send-message',{to:b.user.id,text:'hello from test'},r=>r?.ok?resolve():reject(new Error(r?.error||'send failed'))));
    const message = await received;
    if (message.text !== 'hello from test') throw new Error('socket delivery failed');
    const history = await req('/api/messages/'+b.user.id,'GET',undefined,a.token);
    if (history.messages.length !== 1) throw new Error('message persistence failed');
    sa.close(); sb.close(); server.kill();
    console.log('ALL TESTS PASSED');
  } catch (e) {
    console.error('TEST FAILED:',e.stack || e.message);
    server.kill();
    process.exitCode=1;
  }
}
main();
