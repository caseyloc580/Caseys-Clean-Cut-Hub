const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 20000,
  pingInterval: 5000
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const GAMES_JSON = path.join(PUBLIC_DIR, "games.json");
const rooms = new Map();

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

function loadGames() {
  try {
    const data = JSON.parse(fs.readFileSync(GAMES_JSON, "utf8"));
    return Array.isArray(data.games) ? data.games : [];
  } catch {
    return [];
  }
}

function getGame(gameId) {
  return loadGames().find(g => g.id === gameId);
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function publicRoom(room) {
  return {
    code: room.code,
    gameId: room.gameId,
    hostConnected: !!room.host,
    guestConnected: !!room.guest,
    ready: room.ready,
    playerNames: room.playerNames,
    createdAt: room.createdAt
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "caseys-clean-cut-multigame-hub", time: Date.now() });
});

app.get("/api/games", (req, res) => {
  res.json({ ok: true, games: loadGames() });
});

app.get("/api/rooms", (req, res) => {
  res.json({ ok: true, rooms: [...rooms.values()].map(publicRoom) });
});

io.on("connection", (socket) => {
  socket.on("room:create", (payload = {}, cb) => {
    const gameId = payload.gameId || "turf-kart-mowers";
    if (!getGame(gameId)) return cb && cb({ ok: false, error: "Unknown gameId: " + gameId });

    const code = makeRoomCode();
    const room = {
      code,
      gameId,
      host: socket.id,
      guest: null,
      ready: { 1: false, 2: false },
      playerNames: { 1: payload.name || "Player 1", 2: "Player 2" },
      createdAt: Date.now(),
      lastStateAt: 0
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    socket.data.playerId = 1;
    socket.data.gameId = gameId;

    cb && cb({ ok: true, code, gameId, playerId: 1, role: "host", room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:join", ({ code, gameId, name } = {}, cb) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return cb && cb({ ok: false, error: "Room not found." });
    if (gameId && room.gameId !== gameId) return cb && cb({ ok: false, error: "That room belongs to another game." });
    if (room.guest && room.guest !== socket.id) return cb && cb({ ok: false, error: "Room is full." });

    room.guest = socket.id;
    room.playerNames[2] = name || "Player 2";
    room.ready[2] = false;

    socket.join(code);
    socket.data.room = code;
    socket.data.playerId = 2;
    socket.data.gameId = room.gameId;

    cb && cb({ ok: true, code, gameId: room.gameId, playerId: 2, role: "guest", room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:ready", ({ ready } = {}) => {
    const room = rooms.get(socket.data.room);
    const playerId = socket.data.playerId;
    if (!room || !playerId) return;
    room.ready[playerId] = !!ready;
    emitRoom(room);
  });

  socket.on("game:start", ({ seed } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || socket.id !== room.host) return;
    io.to(room.code).emit("game:start", {
      gameId: room.gameId,
      seed: seed || Date.now(),
      serverTime: Date.now()
    });
  });

  socket.on("input:guest", payload => {
    const room = rooms.get(socket.data.room);
    if (!room || socket.id !== room.guest || !room.host) return;
    io.to(room.host).emit("input:guest", payload);
  });

  socket.on("state:host", payload => {
    const room = rooms.get(socket.data.room);
    if (!room || socket.id !== room.host || !room.guest) return;
    room.lastStateAt = Date.now();
    io.to(room.guest).emit("state:host", payload);
  });

  socket.on("game:event", payload => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    socket.to(room.code).emit("game:event", payload);
  });

  socket.on("voice:signal", payload => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    const target = socket.id === room.host ? room.guest : room.host;
    if (target) io.to(target).emit("voice:signal", payload);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;

    if (socket.id === room.host) {
      io.to(room.code).emit("peer:disconnected", { playerId: 1, message: "Host disconnected. Room closed." });
      rooms.delete(room.code);
    } else if (socket.id === room.guest) {
      room.guest = null;
      room.ready[2] = false;
      io.to(room.code).emit("peer:disconnected", { playerId: 2, message: "Guest disconnected." });
      emitRoom(room);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.createdAt > 1000 * 60 * 60 * 6) rooms.delete(code);
  }
}, 1000 * 60 * 10);

server.listen(PORT, () => {
  console.log(`Casey's Clean Cut Multi-Game Hub running on port ${PORT}`);
});
