import net from 'net';
import http from 'http';
import Redis from './node_modules/ioredis/built/index.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341';
const host = 'redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com';
const port = 10341;
const password = '8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt';

const statsClient = new Redis(REDIS_URL);
const getBytes = (info) => parseInt(info.match(/total_net_output_bytes:(\d+)/)?.[1] || 0);
const info0 = await statsClient.info('stats');
let baseline = getBytes(info0);
let resetTime = Date.now();
let snapshots = [{ ts: Date.now(), bytes: baseline }];

let commandCounts = {};
let zrevrangeCount = 0;
let lastLines = [];
let sseClients = [];

function startMonitor() {
    const socket = net.createConnection({ host, port });
    socket.setEncoding('utf8');
    let buf = '';
    socket.on('error', (e) => { console.error('socket error:', e.message); setTimeout(startMonitor, 3000); });
    socket.on('close', () => { console.log('reconnecting...'); setTimeout(startMonitor, 2000); });
    socket.on('connect', () => {
        socket.write('*2\r\n$4\r\nAUTH\r\n$' + password.length + '\r\n' + password + '\r\n');
        setTimeout(() => socket.write('*1\r\n$7\r\nMONITOR\r\n'), 600);
    });
    socket.on('data', (data) => {
        buf += data;
        const parts = buf.split('\r\n');
        buf = parts.pop();
        for (const line of parts) {
            if (!line.startsWith('+1')) continue;
            const m = line.match(/\[\d+\s+([\d.a-f:]+):\d+\]\s+"([^"]+)"(?:\s+"([^"]*)")?/);
            if (!m) continue;
            const ip = m[1], cmd = m[2].toUpperCase(), key = m[3] || '';
            commandCounts[cmd] = (commandCounts[cmd] || 0) + 1;
            lastLines.push({ ip, cmd, key, ts: Date.now() });
            if (lastLines.length > 100) lastLines.shift();
            if (cmd === 'ZREVRANGE' && key.includes('candidates:list')) {
                zrevrangeCount++;
                console.log(`🔴 FULL SCAN #${zrevrangeCount} | IP: ${ip}`);
            }
        }
    });
}
startMonitor();

// Refresh bandwidth snapshots every 3s
setInterval(async () => {
    try {
        const info = await statsClient.info('stats');
        snapshots.push({ ts: Date.now(), bytes: getBytes(info) });
        if (snapshots.length > 120) snapshots.shift();
    } catch(e) {}
}, 3000);

function getStats() {
    const current = snapshots[snapshots.length-1]?.bytes || baseline;
    const delta = current - baseline;
    const recent = snapshots.filter(s => Date.now() - s.ts < 60000);
    const rate = recent.length > 1
        ? (recent[recent.length-1].bytes - recent[0].bytes) / ((recent[recent.length-1].ts - recent[0].ts) / 1000)
        : 0;
    const rateMB = rate / 1024 / 1024;
    // mini history: last 20 snapshots as MB/min each
    const history = [];
    for (let i = 1; i < Math.min(snapshots.length, 21); i++) {
        const prev = snapshots[snapshots.length - 1 - i];
        const cur = snapshots[snapshots.length - i];
        if (!prev) break;
        const r = (cur.bytes - prev.bytes) / ((cur.ts - prev.ts) / 1000) / 1024 / 1024;
        history.unshift(Math.max(0, r));
    }
    return { rateMB, deltaMB: delta / 1024 / 1024, zrevrangeCount, history,
        commands: Object.entries(commandCounts).sort((a,b)=>b[1]-a[1]).slice(0,10),
        lastLines: lastLines.slice(-20).reverse(),
        resetTime, elapsed: Math.floor((Date.now() - resetTime) / 1000) };
}

// Push SSE to all connected clients every 1s
setInterval(() => {
    if (sseClients.length === 0) return;
    const data = JSON.stringify(getStats());
    sseClients.forEach(res => res.write(`data: ${data}\n\n`));
}, 1000);

const HTML = `<!DOCTYPE html><html><head><title>Redis Monitor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:monospace;background:#0f172a;color:#e2e8f0;padding:16px;font-size:13px}
h1{color:#38bdf8;font-size:18px;margin-bottom:4px}
.sub{color:#64748b;font-size:12px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.card{background:#1e293b;padding:12px;border-radius:8px;border:1px solid #334155}
.card h2{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.big{font-size:36px;font-weight:bold;line-height:1}
.sub2{font-size:11px;color:#64748b;margin-top:4px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold}
.red{background:#7f1d1d;color:#f87171}
.green{background:#14532d;color:#4ade80}
.yellow{background:#713f12;color:#fbbf24}
.bars{display:flex;align-items:flex-end;gap:2px;height:40px;margin-top:8px}
.bar{flex:1;background:#3b82f6;border-radius:2px 2px 0 0;min-height:2px;transition:height .3s}
.bar.hot{background:#f87171}
.bar.warm{background:#fbbf24}
.cmd-row{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.cmd-label{width:90px;color:#94a3b8;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmd-bar{height:14px;background:#3b82f6;border-radius:2px;transition:width .4s;min-width:2px}
.cmd-count{color:#e2e8f0;font-size:11px;min-width:30px}
table{width:100%;border-collapse:collapse;font-size:11px}
td,th{border-bottom:1px solid #1e293b;padding:4px 6px;text-align:left}
th{color:#64748b;font-weight:normal;border-bottom:1px solid #334155}
tr:hover td{background:#1e293b}
a{color:#38bdf8;text-decoration:none}
a:hover{text-decoration:underline}
.full{grid-column:span 2}
#dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#4ade80;margin-right:6px;animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style></head><body>
<h1><span id="dot"></span>Redis Live Monitor</h1>
<div class="sub">⏱ <span id="elapsed">0s</span> desde reset &nbsp;·&nbsp; <a href="/reset">🔄 Reset</a></div>

<div class="grid">
  <div class="card">
    <h2>Output bandwidth</h2>
    <div class="big" id="rate">—</div>
    <div class="sub2">MB/min · últimos 60s</div>
    <div class="bars" id="bars"></div>
  </div>
  <div class="card">
    <h2>Desde último reset</h2>
    <div class="big" id="delta">—</div>
    <div class="sub2">MB acumulados</div>
    <div style="margin-top:12px">
      📅 Proyección: <b id="proj">—</b> GB/día<br>
      <span style="margin-top:6px;display:block">🔍 Full-scans ZREVRANGE: <span id="zscan" class="badge green">0</span></span>
    </div>
  </div>
  <div class="card">
    <h2>Top comandos</h2>
    <div id="cmds"></div>
  </div>
  <div class="card">
    <h2>Últimos comandos</h2>
    <table><thead><tr><th>Hora</th><th>CMD</th><th>Key</th></tr></thead>
    <tbody id="rows"></tbody></table>
  </div>
</div>

<script>
const es = new EventSource('/sse');
es.onmessage = (e) => {
  const d = JSON.parse(e.data);

  // Timer
  const s = d.elapsed, m = Math.floor(s/60), ss = s%60;
  document.getElementById('elapsed').textContent = m > 0 ? m+'m '+ss+'s' : ss+'s';

  // Rate
  const rMB = d.rateMB;
  const rEl = document.getElementById('rate');
  rEl.textContent = rMB.toFixed(2) + ' MB/min';
  rEl.style.color = rMB > 10 ? '#f87171' : rMB > 2 ? '#fbbf24' : '#4ade80';

  // Delta + proj
  document.getElementById('delta').textContent = d.deltaMB.toFixed(2);
  document.getElementById('proj').textContent = (rMB/1024*60*24).toFixed(2);

  // ZREVRANGE badge
  const zEl = document.getElementById('zscan');
  zEl.textContent = d.zrevrangeCount;
  zEl.className = 'badge ' + (d.zrevrangeCount > 0 ? 'red' : 'green');

  // Mini bars (history)
  const maxH = Math.max(...d.history, 0.01);
  document.getElementById('bars').innerHTML = d.history.map(v => {
    const pct = Math.round(v / maxH * 100);
    const cls = v > 10 ? 'hot' : v > 2 ? 'warm' : '';
    return \`<div class="bar \${cls}" style="height:\${Math.max(pct,2)}%"></div>\`;
  }).join('');

  // Top commands bars
  const maxC = d.commands[0]?.[1] || 1;
  document.getElementById('cmds').innerHTML = d.commands.map(([cmd, n]) =>
    \`<div class="cmd-row"><span class="cmd-label">\${cmd}</span>
     <div class="cmd-bar" style="width:\${Math.round(n/maxC*160)}px"></div>
     <span class="cmd-count">\${n}</span></div>\`
  ).join('');

  // Last commands table
  document.getElementById('rows').innerHTML = d.lastLines.map(l =>
    \`<tr><td>\${new Date(l.ts).toLocaleTimeString('es-MX')}</td>
      <td style="color:\${l.cmd==='ZREVRANGE'?'#f87171':'#e2e8f0'}">\${l.cmd}</td>
      <td style="color:#64748b">\${l.key.slice(0,35)}</td></tr>\`
  ).join('');
};
es.onerror = () => { document.getElementById('dot').style.background = '#f87171'; };
</script></body></html>`;

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/reset') {
        const info = await statsClient.info('stats').catch(() => null);
        if (info) baseline = getBytes(info);
        resetTime = Date.now();
        snapshots = [{ ts: Date.now(), bytes: baseline }];
        commandCounts = {};
        zrevrangeCount = 0;
        lastLines = [];
        console.log('✅ Reset — baseline:', (baseline/1024/1024).toFixed(0), 'MB');
        res.setHeader('Location', '/');
        res.writeHead(302);
        res.end();
        return;
    }

    if (url.pathname === '/sse') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.write(`data: ${JSON.stringify(getStats())}\n\n`);
        sseClients.push(res);
        req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
        return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(HTML);
});

server.listen(4242, () => {
    console.log('✅ Monitor iniciado con PID', process.pid);
    console.log('   Baseline:', (baseline/1024/1024).toFixed(0), 'MB');
    console.log('📊 Dashboard: http://localhost:4242');
});
