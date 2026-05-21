// ============================================================
//  SLITHER.IO CLONE — Servidor Multijugador (SIN BOTS ONLINE)
//  npm install
//  node server.js
// ============================================================

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ── Constantes ────────────────────────────────────────────
const WORLD_W     = 4000;
const WORLD_H     = 4000;
const FOOD_COUNT  = 700;
const SNAKE_SPEED = 2.8;
const BOOST_SPEED = 5.2;
const TURN_SPEED  = 0.08;
const SEGMENT_GAP = 8;
const BASE_RADIUS = 7;
const TICK_MS     = 1000 / 30;

const SKIN_COLORS = [
  { head:'#4ade80', body:'#22c55e' },
  { head:'#a855f7', body:'#7c3aed' },
  { head:'#f97316', body:'#ea580c' },
  { head:'#06b6d4', body:'#0891b2' },
  { head:'#f43f5e', body:'#e11d48' },
  { head:'#facc15', body:'#eab308' },
  { head:'#fb923c', body:'#f97316' },
  { head:'#38bdf8', body:'#0ea5e9' },
];

// ── Estado ────────────────────────────────────────────────
let foods  = [];
let snakes = {};  // id -> snake

// ── Food ─────────────────────────────────────────────────
function spawnFood(n = 1) {
  for (let i = 0; i < n; i++) {
    const hue = Math.random() * 360;
    foods.push({
      id:    Math.random().toString(36).slice(2),
      x:     Math.random() * WORLD_W,
      y:     Math.random() * WORLD_H,
      r:     4 + Math.random() * 5,
      color: `hsl(${hue},100%,60%)`,
      value: 1,
    });
  }
}

// ── Snake factory ─────────────────────────────────────────
function createSnake(id, name, skinIdx) {
  const x = 200 + Math.random() * (WORLD_W - 400);
  const y = 200 + Math.random() * (WORLD_H - 400);
  const segs = [];
  for (let i = 0; i < 10; i++) segs.push({ x: x - i * SEGMENT_GAP, y });
  return {
    id,
    name,
    skin:  SKIN_COLORS[skinIdx % SKIN_COLORS.length],
    segs,
    angle: Math.random() * Math.PI * 2,
    alive: true,
    score: 0,
    boost: false,
  };
}

function snakeRadius(score) {
  return BASE_RADIUS + Math.min(score / 150, 12);
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

function lerpAngle(snake, target, speed) {
  let diff = target - snake.angle;
  while (diff >  Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  snake.angle += Math.sign(diff) * Math.min(Math.abs(diff), speed);
}

// ── Kill snake ────────────────────────────────────────────
function killSnake(id) {
  const s = snakes[id];
  if (!s || !s.alive) return;
  s.alive = false;

  // Drop food on death
  for (const seg of s.segs) {
    if (Math.random() < 0.3) {
      const hue = Math.random() * 360;
      foods.push({
        id:    Math.random().toString(36).slice(2),
        x:     seg.x + (Math.random() - .5) * 20,
        y:     seg.y + (Math.random() - .5) * 20,
        r:     5 + Math.random() * 8,
        color: `hsl(${hue},100%,60%)`,
        value: 2,
      });
    }
  }
  while (foods.length < FOOD_COUNT) spawnFood(1);

  // Notify the dead player
  io.to(id).emit('dead', { score: s.score, length: s.segs.length });
  io.emit('snake_died', { id });
}

// ── Game tick ─────────────────────────────────────────────
function tick() {
  const ids = Object.keys(snakes);
  const eatenFoodIds = [];

  // Move snakes
  for (const id of ids) {
    const s = snakes[id];
    if (!s.alive) continue;

    const speed = s.boost ? BOOST_SPEED : SNAKE_SPEED;
    const head  = s.segs[0];
    const nx    = head.x + Math.cos(s.angle) * speed;
    const ny    = head.y + Math.sin(s.angle) * speed;

    // Out of bounds → die
    if (nx < 0 || nx > WORLD_W || ny < 0 || ny > WORLD_H) {
      killSnake(id); continue;
    }

    s.segs.unshift({ x: nx, y: ny });
    const maxLen = 10 + s.score * 0.5;
    while (s.segs.length > maxLen) s.segs.pop();
  }

  // Eat food
  for (const id of ids) {
    const s = snakes[id];
    if (!s.alive) continue;
    const head = s.segs[0];
    const r    = snakeRadius(s.score);
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      if (dist2(head.x, head.y, f.x, f.y) < (r + f.r) ** 2) {
        s.score += f.value;
        eatenFoodIds.push(f.id);
        foods.splice(i, 1);
        spawnFood(1);
        break;
      }
    }
  }

  // Collisions head vs body
  for (let a = 0; a < ids.length; a++) {
    const sa = snakes[ids[a]];
    if (!sa.alive) continue;
    const ha = sa.segs[0];
    const ra = snakeRadius(sa.score);
    for (let b = 0; b < ids.length; b++) {
      if (a === b) continue;
      const sb = snakes[ids[b]];
      if (!sb.alive) continue;
      const rb = snakeRadius(sb.score);
      for (let i = 1; i < sb.segs.length; i++) {
        if (dist2(ha.x, ha.y, sb.segs[i].x, sb.segs[i].y) < (ra + rb) ** 2) {
          killSnake(ids[a]); break;
        }
      }
      if (!sa.alive) break;
    }
  }

  // Leaderboard top 10
  const lb = Object.values(snakes)
    .filter(s => s.alive)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(s => ({ id: s.id, name: s.name, score: s.score }));

  // Build compact state
  const stateSnakes = {};
  for (const id of ids) {
    const s = snakes[id];
    if (!s.alive) continue;
    stateSnakes[id] = {
      segs:  s.segs,
      angle: s.angle,
      skin:  s.skin,
      name:  s.name,
      score: s.score,
      boost: s.boost,
    };
  }

  io.emit('state', { snakes: stateSnakes, eatenFoodIds, lb });
}

// ── Helpers ───────────────────────────────────────────────
function serializeSnake(s) {
  return { id: s.id, name: s.name, skin: s.skin, segs: s.segs, angle: s.angle, score: s.score };
}

function broadcastPlayerCount() {
  const n = Object.values(snakes).filter(s => s.alive).length;
  io.emit('player_count', n);
}

// ── Socket.io ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('🟢 Conectado:', socket.id);

  socket.on('join', ({ name, skinIdx }) => {
    const s = createSnake(socket.id, name || 'Jugador', skinIdx || 0);
    snakes[socket.id] = s;

    // Send full world to new player
    socket.emit('init', {
      id: socket.id,
      foods,
      snakes: Object.fromEntries(
        Object.entries(snakes).map(([k, v]) => [k, serializeSnake(v)])
      ),
    });

    // Tell everyone else
    socket.broadcast.emit('snake_spawned', serializeSnake(s));
    broadcastPlayerCount();
  });

  socket.on('input', ({ angle, boost }) => {
    const s = snakes[socket.id];
    if (!s || !s.alive) return;
    lerpAngle(s, angle, TURN_SPEED * 2);
    s.boost = !!boost;
  });

  socket.on('respawn', ({ name, skinIdx }) => {
    const s = createSnake(socket.id, name || 'Jugador', skinIdx || 0);
    snakes[socket.id] = s;
    socket.emit('init', {
      id: socket.id,
      foods,
      snakes: Object.fromEntries(
        Object.entries(snakes).map(([k, v]) => [k, serializeSnake(v)])
      ),
    });
    socket.broadcast.emit('snake_spawned', serializeSnake(s));
    broadcastPlayerCount();
  });

  socket.on('disconnect', () => {
    console.log('🔴 Desconectado:', socket.id);
    killSnake(socket.id);
    delete snakes[socket.id];
    io.emit('snake_removed', { id: socket.id });
    broadcastPlayerCount();
  });
});

// ── Init ─────────────────────────────────────────────────
spawnFood(FOOD_COUNT);
setInterval(tick, TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
