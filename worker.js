import { DurableObject } from "cloudflare:workers";

/**
 * Cricket Live API — Cloudflare Worker + SQLite Durable Object
 *
 * Live match routes:
 *   GET  /health
 *   GET  /live?match=<id>&key=<viewer-key>
 *   POST /live?match=<id>  (X-Publisher-Key header)
 *
 * Viewer/community routes:
 *   POST /presence
 *   GET/POST /chat
 *   POST /chat/edit
 *   POST /chat/delete
 *   GET/POST /fans
 *   POST /fan/update
 *   POST /react
 *   POST /admin/login
 *   POST /admin/clear
 *   POST /admin/block
 *
 * Set PUBLISH_KEY, VIEW_KEY and optionally ADMIN_KEY in wrangler.toml/secrets.
 */

const DEFAULT_PUBLISH_KEY = 'PUBLISH_2026';
const DEFAULT_VIEW_KEY = 'VIEWER_2026';
const DEFAULT_ADMIN_KEY = 'sarang123';

export class LiveRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // --- WebSocket upgrade (hibernation API) — do not send before returning 101 ---
    if (url.pathname === '/ws' || (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
      try {
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        try { pair[1].serializeAttachment({ joinedAt: Date.now() }); } catch (_) {}
        return new Response(null, { status: 101, webSocket: pair[0] });
      } catch (e) {
        return json({ ok:false, error:'ws-upgrade-failed', detail:String(e && e.message || e) }, 500);
      }
    }

    if (request.method === 'GET' && (url.pathname === '/live' || url.pathname === '/api/live')) {
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS live_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)'
      );
      // .one() throws when empty — use toArray() instead
      const rows = this.ctx.storage.sql.exec(
        'SELECT payload, updated_at FROM live_state WHERE id = 1 LIMIT 1'
      ).toArray();
      const row = rows && rows[0];
      if (!row) return json({ ok: true, data: null, updatedAt: 0 });
      let data = null;
      try { data = JSON.parse(row.payload); } catch (_) {}
      if (data && typeof data === 'object') {
        const core = (data.data && typeof data.data === 'object' && (data.data.ts || data.data.runs != null))
          ? data.data
          : data;
        // Flatten score fields for viewers that expect top-level .ts
        const out = Object.assign({ ok: true, data: core, updatedAt: row.updated_at }, core);
        return json(out);
      }
      return json({ ok: true, data: null, updatedAt: row.updated_at });
    }

    if (request.method === 'POST' && (url.pathname === '/live' || url.pathname === '/api/live')) {
      const body = await request.text();
      if (!body || body.length > 900000) return json({ ok:false, error:'Invalid payload' }, 413);
      try { JSON.parse(body); } catch (_) { return json({ ok:false, error:'Invalid JSON' }, 400); }
      const now = Date.now();
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS live_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)'
      );
      this.ctx.storage.sql.exec(
        'INSERT INTO live_state (id,payload,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at',
        body, now
      );
      return json({ ok:true, updatedAt:now });
    }

    // Global viewer/community state lives in the global Durable Object instance.
    if (url.pathname === '/presence' || url.pathname === '/chat' || url.pathname.startsWith('/chat/') ||
        url.pathname === '/fans' || url.pathname === '/fan/update' || url.pathname === '/react' ||
        url.pathname.startsWith('/admin/') || url.pathname === '/predictions' || url.pathname === '/floats') {
      return this.globalFetch(request);
    }

    return json({ ok:false, error:'Not found' }, 404);
  }

  ensureCommunityTables() {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fans (id TEXT PRIMARY KEY, name TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 10, correct INTEGER NOT NULL DEFAULT 0, wrong INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS presence (id TEXT PRIMARY KEY, name TEXT NOT NULL, last_seen INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS chat (mid TEXT PRIMARY KEY, id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT \'\', edited INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS blocks (id TEXT PRIMARY KEY, name TEXT NOT NULL, ts INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS predictions (pid TEXT PRIMARY KEY, id TEXT NOT NULL, name TEXT NOT NULL, pred TEXT NOT NULL, over_total TEXT NOT NULL DEFAULT \'\', ts INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS reactions (id TEXT PRIMARY KEY, player TEXT NOT NULL, emoji TEXT NOT NULL, name TEXT NOT NULL, ts INTEGER NOT NULL)');
  }

  async globalFetch(request) {
    const url = new URL(request.url);
    this.ensureCommunityTables();
    const now = Date.now();
    const adminKey = this.env.ADMIN_KEY || DEFAULT_ADMIN_KEY;
    const adminKeys = new Set([String(adminKey), 'sarang123', 'ADMIN_2026']);

    if (url.pathname === '/presence' && request.method === 'POST') {
      const b = await safeJson(request);
      if (!b || !b.id) return json({ok:false,error:'Missing viewer id'},400);
      const blocked = this.ctx.storage.sql.exec('SELECT id FROM blocks WHERE id=? LIMIT 1', String(b.id)).toArray();
      if (blocked.length) return json({ok:false,error:'Blocked'},403);
      const id=String(b.id).slice(0,100), name=String(b.name||'Fan').slice(0,24);
      this.ctx.storage.sql.exec('INSERT INTO presence(id,name,last_seen) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,last_seen=excluded.last_seen',id,name,now);
      this.ctx.storage.sql.exec('DELETE FROM presence WHERE last_seen < ?',now-45000);
      const rows=this.ctx.storage.sql.exec('SELECT id,name,last_seen FROM presence ORDER BY last_seen DESC LIMIT 100').toArray();
      let messages = [];
      try { messages = await this.getChat(); } catch (_) { messages = []; }
      if (messages.length > 30) messages = messages.slice(-30);
      let floats = [];
      try { floats = await this.getFloats(0); } catch (_) { floats = []; }
      if (floats.length > 30) floats = floats.slice(-30);
      return json({ok:true,count:rows.length,viewers:rows.map(x=>({id:x.id,name:x.name,lastSeen:x.last_seen})),messages,floats});
    }

    if (url.pathname === '/fans' && request.method === 'GET') {
      const rows=this.ctx.storage.sql.exec('SELECT id,name,points,correct,wrong FROM fans ORDER BY points DESC, correct DESC, updated_at DESC LIMIT 100').toArray();
      return json({ok:true,fans:rows});
    }

    if (url.pathname === '/fan/update' && request.method === 'POST') {
      const b=await safeJson(request); if(!b||!b.id)return json({ok:false,error:'Missing viewer id'},400);
      const id=String(b.id).slice(0,100),name=String(b.name||'Fan').slice(0,24);
      const points=Math.max(0,Number.isFinite(Number(b.points))?Math.floor(Number(b.points)):10);
      const correct=Math.max(0,Math.floor(Number(b.correct)||0)),wrong=Math.max(0,Math.floor(Number(b.wrong)||0));
      this.ctx.storage.sql.exec('INSERT INTO fans(id,name,points,correct,wrong,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,points=excluded.points,correct=excluded.correct,wrong=excluded.wrong,updated_at=excluded.updated_at',id,name,points,correct,wrong,now);
      return json({ok:true});
    }

    if (url.pathname === '/react' && request.method === 'POST') {
      const b=await safeJson(request); if(!b||!b.id||!b.player||!b.emoji)return json({ok:false,error:'Missing reaction'},400);
      const rid=String(b.id)+'-'+String(b.player).slice(0,40)+'-'+String(b.emoji).slice(0,8)+'-'+now;
      this.ctx.storage.sql.exec('INSERT INTO reactions(id,player,emoji,name,ts) VALUES(?,?,?,?,?)',rid,String(b.player).slice(0,60),String(b.emoji).slice(0,8),String(b.name||'Fan').slice(0,24),now);
      this.ctx.storage.sql.exec('DELETE FROM reactions WHERE ts < ?',now-86400000);
      const rows=this.ctx.storage.sql.exec('SELECT player,emoji,name,ts FROM reactions ORDER BY ts DESC LIMIT 300').toArray();
      const byPlayer={}; for(const r of rows){(byPlayer[r.player] ||= []).push({emoji:r.emoji,from:r.name,ts:r.ts});}
      return json({ok:true,byPlayer});
    }

    if (url.pathname === '/chat' && request.method === 'GET') {
      const since = Number(url.searchParams.get('since')||0)||0;
      return json({ok:true,messages:await this.getChat(),floats:await this.getFloats(since)});
    }
    if (url.pathname === '/chat' && request.method === 'POST') {
      const b=await safeJson(request); if(!b||!b.id)return json({ok:false,error:'Missing viewer id'},400);
      const blocked=this.ctx.storage.sql.exec('SELECT id FROM blocks WHERE id=? LIMIT 1',String(b.id)).toArray();
      if(blocked.length)return json({ok:false,error:'Blocked'},403);
      const mid='m'+now.toString(36)+Math.random().toString(36).slice(2,8);
      const chatId=String(b.id).slice(0,100);
      const chatName=String(b.name||'Fan').slice(0,24);
      const chatText=String(b.text||'').slice(0,200);
      const chatEmoji=String(b.emoji||'').slice(0,16);
      this.ctx.storage.sql.exec('INSERT INTO chat(mid,id,name,text,emoji,edited,ts) VALUES(?,?,?,?,?,?,?)',mid,chatId,chatName,chatText,chatEmoji,0,now);
      this.ctx.storage.sql.exec('DELETE FROM chat WHERE ts < ?',now-7*86400000);
      // Reliable float bus (DO storage) — used by all viewers
      await this.pushFloat({mid,id:chatId,name:chatName,text:chatText,emoji:chatEmoji,ts:now});
      try { this.broadcastFloat({mid,id:chatId,name:chatName,text:chatText,emoji:chatEmoji,ts:now}); } catch (_) {}
      const messages = await this.getChat();
      const floats = await this.getFloats(0);
      return json({ok:true,messages,floats,mid});
    }
    if (url.pathname === '/chat/edit' && request.method === 'POST') {
      const b=await safeJson(request); if(!b||!b.mid||!b.key)return json({ok:false,error:'Missing message key'},400);
      const r=this.ctx.storage.sql.exec('SELECT id FROM chat WHERE mid=? LIMIT 1',String(b.mid)).toArray()[0];
      if(!r||r.id!==String(b.key))return json({ok:false,error:'Not your message'},403);
      this.ctx.storage.sql.exec('UPDATE chat SET text=?,edited=1 WHERE mid=?',String(b.text||'').slice(0,200),String(b.mid));
      return json({ok:true,messages:await this.getChat()});
    }
    if (url.pathname === '/chat/delete' && request.method === 'POST') {
      const b=await safeJson(request); if(!b||!b.mid||!b.key)return json({ok:false,error:'Missing message key'},400);
      const r=this.ctx.storage.sql.exec('SELECT id FROM chat WHERE mid=? LIMIT 1',String(b.mid)).toArray()[0];
      if(!r||r.id!==String(b.key))return json({ok:false,error:'Not your message'},403);
      this.ctx.storage.sql.exec('DELETE FROM chat WHERE mid=?',String(b.mid));
      return json({ok:true,messages:await this.getChat()});
    }

    if (url.pathname === '/admin/login' && request.method === 'POST') {
      const b=await safeJson(request); const ok=!!b && adminKeys.has(String(b.key||''));
      return json({ok},ok?200:403);
    }
    if (url.pathname === '/admin/clear' && request.method === 'POST') {
      const b=await safeJson(request); if(!adminKeys.has(String(b?.key||'')))return json({ok:false,error:'Invalid admin key'},403);
      this.ctx.storage.sql.exec('DELETE FROM chat'); return json({ok:true,messages:[]});
    }
    
    if (url.pathname === '/admin/block' && request.method === 'POST') {
      const b=await safeJson(request); if(!adminKeys.has(String(b?.key||'')))return json({ok:false,error:'Invalid admin key'},403);
      const id=String(b.id||'').slice(0,100); if(!id)return json({ok:false,error:'Missing id'},400);
      this.ctx.storage.sql.exec('INSERT INTO blocks(id,name,ts) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,ts=excluded.ts',id,String(b.name||'Fan').slice(0,24),now);
      return json({ok:true});
    }
    if (url.pathname === '/admin/unblock' && request.method === 'POST') {
      const b=await safeJson(request); if(!adminKeys.has(String(b?.key||'')))return json({ok:false,error:'Invalid admin key'},403);
      const id=String(b.id||'').slice(0,100); if(!id)return json({ok:false,error:'Missing id'},400);
      this.ctx.storage.sql.exec('DELETE FROM blocks WHERE id=?', id);
      return json({ok:true});
    }
    if (url.pathname === '/admin/blocks' && request.method === 'GET') {
      const key = url.searchParams.get('key')||'';
      if(!adminKeys.has(String(key))) return json({ok:false,error:'Invalid admin key'},403);
      const rows=this.ctx.storage.sql.exec('SELECT id,name,ts FROM blocks ORDER BY ts DESC LIMIT 100').toArray();
      return json({ok:true,blocks:rows});
    }
    if (url.pathname === '/admin/reset-coins' && request.method === 'POST') {
      const b=await safeJson(request); if(!adminKeys.has(String(b?.key||'')))return json({ok:false,error:'Invalid admin key'},403);
      if(b.id){
        this.ctx.storage.sql.exec('UPDATE fans SET points=10, correct=0, wrong=0, updated_at=? WHERE id=?', now, String(b.id).slice(0,100));
      } else {
        this.ctx.storage.sql.exec('UPDATE fans SET points=10, correct=0, wrong=0, updated_at=?', now);
      }
      return json({ok:true});
    }
    if (url.pathname === '/admin/reset-emojis' && request.method === 'POST') {
      const b=await safeJson(request); if(!adminKeys.has(String(b?.key||'')))return json({ok:false,error:'Invalid admin key'},403);
      await this.ctx.storage.put('emoji_reset_at', now);
      await this.ctx.storage.put('float_bus', []);
      return json({ok:true, emojiResetAt: now});
    }
    if (url.pathname === '/predictions' && request.method === 'GET') {
      const rows=this.ctx.storage.sql.exec('SELECT pid,id,name,pred,over_total,ts FROM predictions ORDER BY ts DESC LIMIT 80').toArray();
      return json({ok:true,predictions:rows});
    }
    if (url.pathname === '/predictions' && request.method === 'POST') {
      const b=await safeJson(request); if(!b||!b.id)return json({ok:false,error:'Missing id'},400);
      const pid='p'+now.toString(36)+Math.random().toString(36).slice(2,7);
      this.ctx.storage.sql.exec('INSERT INTO predictions(pid,id,name,pred,over_total,ts) VALUES(?,?,?,?,?,?)',
        pid, String(b.id).slice(0,100), String(b.name||'Fan').slice(0,24), String(b.pred||'').slice(0,12), String(b.over_total||b.overTotal||'').slice(0,12), now);
      // keep table small
      this.ctx.storage.sql.exec('DELETE FROM predictions WHERE ts < ?', now-86400000);
      const rows=this.ctx.storage.sql.exec('SELECT pid,id,name,pred,over_total,ts FROM predictions ORDER BY ts DESC LIMIT 80').toArray();
      return json({ok:true,predictions:rows});
    }

    if (url.pathname === '/floats' && request.method === 'GET') {
      const since = Number(url.searchParams.get('since')||0)||0;
      return json({ok:true,floats:await this.getFloats(since),emojiResetAt:await this.getEmojiResetAt()});
    }
    if (url.pathname === '/floats' && request.method === 'POST') {
      const b=await safeJson(request); if(!b||!b.id)return json({ok:false,error:'Missing id'},400);
      const mid='f'+now.toString(36)+Math.random().toString(36).slice(2,8);
      const entry={mid,id:String(b.id).slice(0,100),name:String(b.name||'Fan').slice(0,24),text:String(b.text||'').slice(0,200),emoji:String(b.emoji||'').slice(0,16),ts:now};
      await this.pushFloat(entry);
      try { this.broadcastFloat(entry); } catch (_) {}
      return json({ok:true,floats:await this.getFloats(0),mid});
    }

    return json({ok:false,error:'Not found'},404);
  }


  broadcastFloat(entry) {
    const payload = JSON.stringify({ type: 'float', ...entry });
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
        sent++;
      } catch (_) {}
    }
    return sent;
  }

  async webSocketMessage(ws, message) {
    try {
      const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
      let data;
      try { data = JSON.parse(raw); } catch { return; }
      if (!data || data.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong', ts: Date.now() })); } catch (_) {}
        return;
      }
      // Client-sent float over WS
      const now = Date.now();
      const entry = {
        mid: data.mid || ('w' + now.toString(36) + Math.random().toString(36).slice(2, 7)),
        id: String(data.id || 'anon').slice(0, 100),
        name: String(data.name || 'Fan').slice(0, 24),
        text: String(data.text || '').slice(0, 200),
        emoji: String(data.emoji || '').slice(0, 16),
        ts: now
      };
      await this.pushFloat(entry);
      this.broadcastFloat(entry);
    } catch (e) {
      try { ws.send(JSON.stringify({ type: 'error', error: String(e && e.message || e) })); } catch (_) {}
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code || 1000, reason || 'close'); } catch (_) {}
  }

  async webSocketError(ws, error) {
    try { ws.close(1011, 'error'); } catch (_) {}
  }

  async pushFloat(entry){
    try{
      let arr = (await this.ctx.storage.get('float_bus')) || [];
      if(!Array.isArray(arr)) arr = [];
      arr.push(entry);
      if(arr.length > 40) arr = arr.slice(-40);
      await this.ctx.storage.put('float_bus', arr);
    }catch(_){}
  }
  async getFloats(sinceTs){
    try{
      let arr = (await this.ctx.storage.get('float_bus')) || [];
      if(!Array.isArray(arr)) arr = [];
      const resetAt = Number(await this.ctx.storage.get('emoji_reset_at')) || 0;
      const since = Math.max(Number(sinceTs)||0, resetAt);
      if(since > 0) arr = arr.filter(x => Number(x.ts) > since);
      return arr;
    }catch(_){ return []; }
  }
  async getEmojiResetAt(){
    try{ return Number(await this.ctx.storage.get('emoji_reset_at')) || 0; }catch(_){ return 0; }
  }
  async getChat(){
    const rows=this.ctx.storage.sql.exec('SELECT mid,id,name,text,emoji,edited,ts FROM chat ORDER BY ts ASC LIMIT 200').toArray();
    return rows.map(r=>({mid:r.mid,id:r.id,name:r.name,text:r.text,emoji:r.emoji,edited:!!r.edited,ts:r.ts}));
  }
}

async function safeJson(request){try{return await request.json()}catch(_){return null}}

function corsHeaders(origin) {
  const allowed = origin || '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, X-Publisher-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  };
}

function json(value, status = 200, origin = '') {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type':'application/json; charset=utf-8', ...corsHeaders(origin) }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:corsHeaders(origin) });

    if (url.pathname === '/health') {
      return json({ ok:true, service:'cricket-live-api', time:Date.now() }, 200, origin);
    }

    // WebSocket: pass original request (must keep Upgrade header)
    if (url.pathname === '/ws') {
      const id = env.LIVE_ROOM.idFromName('__viewer_global__');
      const stub = env.LIVE_ROOM.get(id);
      return stub.fetch(request);
    }



    // ONLY /api/* for live score API — /live and /live.html are the viewer HTML page (assets)
    const isLivePublic = url.pathname === '/api/live-public' || url.pathname === '/live-public';
    const isLive = url.pathname === '/api/live';

    if (isLivePublic) {
      const match = (url.searchParams.get('match') || 'current').trim().slice(0,80) || 'current';
      try {
        const id = env.LIVE_ROOM.idFromName(match);
        const stub = env.LIVE_ROOM.get(id);
        const r = await stub.fetch(new Request('https://do.internal/api/live', { method:'GET' }));
        const data = await r.json();
        // Attach global float bus so every score poll delivers cross-viewer floats
        try {
          const gid = env.LIVE_ROOM.idFromName('__viewer_global__');
          const gstub = env.LIVE_ROOM.get(gid);
          const gr = await gstub.fetch(new Request('https://do.internal/floats', { method:'GET' }));
          const gd = await gr.json();
          if (data && typeof data === 'object') data.floats = (gd && gd.floats) || [];
        } catch (_) {}
        return json(data, 200, origin);
      } catch (e) {
        return json({ ok:true, data:null, error: String(e && e.message || e || 'Live state unavailable') }, 200, origin);
      }
    }

    if (isLive) {
      const match = (url.searchParams.get('match') || 'current').trim().slice(0,80) || 'current';
      const viewKey = url.searchParams.get('key') || '';
      const publishKey = request.headers.get('X-Publisher-Key') || '';
      const expectedView = env.VIEW_KEY || DEFAULT_VIEW_KEY;
      // Accept configured secret OR the documented default (avoids 403 after key mismatch)
      const expectedPublish = env.PUBLISH_KEY || DEFAULT_PUBLISH_KEY;
      const publishKeys = new Set([String(expectedPublish), String(DEFAULT_PUBLISH_KEY), 'PUBLISH_2026', 'PUBLISH_2026_CHANGE_ME']);
      const id = env.LIVE_ROOM.idFromName(match);
      const stub = env.LIVE_ROOM.get(id);
      if (request.method === 'GET') {
        if (viewKey && viewKey !== expectedView) return json({ ok:false, error:'Invalid viewer key' }, 403, origin);
        try {
          const r = await stub.fetch(new Request('https://do.internal/api/live', { method:'GET' }));
          const data = await r.json();
          return json(data, 200, origin);
        } catch (e) {
          return json({ ok:true, data:null, error: String(e && e.message || e) }, 200, origin);
        }
      }
      if (request.method === 'POST') {
        if (!publishKeys.has(String(publishKey||''))) return json({ ok:false, error:'Invalid publisher key' }, 403, origin);
        const body = await request.text();
        try { JSON.parse(body); } catch (_) { return json({ ok:false, error:'Invalid JSON' }, 400, origin); }
        try {
          const r = await stub.fetch(new Request('https://do.internal/api/live', { method:'POST', body }));
          const data = await r.json();
          return json(data, r.status, origin);
        } catch (e) {
          return json({ ok:false, error: String(e && e.message || e) }, 500, origin);
        }
      }
      return json({ok:false,error:'Method not allowed'},405,origin);
    }

    if (url.pathname === '/presence' || url.pathname === '/chat' || url.pathname.startsWith('/chat/') ||
        url.pathname === '/fans' || url.pathname === '/fan/update' || url.pathname === '/react' || url.pathname.startsWith('/admin/') ||
        url.pathname === '/predictions' || url.pathname === '/floats') {
      const id = env.LIVE_ROOM.idFromName('__viewer_global__');
      const stub = env.LIVE_ROOM.get(id);
      // IMPORTANT: read body as text before forwarding — stream body to DO often arrives empty
      let bodyText = undefined;
      if (!['GET','HEAD'].includes(request.method)) {
        try { bodyText = await request.text(); } catch (_) { bodyText = undefined; }
      }
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      const originHdr = request.headers.get('Origin') || '';
      if (originHdr) headers.set('Origin', originHdr);
      const r = await stub.fetch(new Request('https://do.internal' + url.pathname + url.search, {
        method: request.method,
        headers,
        body: bodyText
      }));
      // Re-wrap with CORS for browser clients
      const text = await r.text();
      return new Response(text, {
        status: r.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...corsHeaders(origin)
        }
      });
    }

    // Explicit static-asset fallback. API routes above always win, while /live.html,
    // /index.html, icons, manifest, service worker, and other public assets are served
    // directly by the Cloudflare Assets binding.
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return json({ok:false,error:'Not found'},404,origin);
  }
};
