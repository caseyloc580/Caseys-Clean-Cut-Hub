const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 20000,
  pingInterval: 5000
});

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

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
    hostConnected: !!room.host,
    guestConnected: !!room.guest,
    ready: room.ready,
    playerNames: room.playerNames
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

io.on("connection", (socket) => {
  socket.on("room:create", (payload, cb) => {
    const code = makeRoomCode();
    const room = {
      code,
      host: socket.id,
      guest: null,
      ready: { 1: false, 2: false },
      playerNames: { 1: payload?.name || "Player 1", 2: "Player 2" },
      createdAt: Date.now(),
      lastStateAt: 0
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    socket.data.playerId = 1;
    cb && cb({ ok: true, code, playerId: 1, role: "host", room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:join", ({ code, name }, cb) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: "Room not found." });
    if (room.guest && room.guest !== socket.id) return cb && cb({ ok: false, error: "Room is full." });

    room.guest = socket.id;
    room.playerNames[2] = name || "Player 2";
    room.ready[2] = false;
    socket.join(code);
    socket.data.room = code;
    socket.data.playerId = 2;

    cb && cb({ ok: true, code, playerId: 2, role: "guest", room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:ready", ({ ready }) => {
    const code = socket.data.room;
    const room = rooms.get(code);
    const playerId = socket.data.playerId;
    if (!room || !playerId) return;
    room.ready[playerId] = !!ready;
    emitRoom(room);
  });

  socket.on("game:start", ({ seed }) => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room || socket.id !== room.host) return;
    room.ready[1] = true;
    room.ready[2] = true;
    io.to(code).emit("game:start", { seed: seed || Date.now(), serverTime: Date.now() });
  });

  // Guest -> host input relay. Host is authoritative.
  socket.on("input:guest", (payload) => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room || socket.id !== room.guest || !room.host) return;
    io.to(room.host).emit("input:guest", payload);
  });

  // Host -> guest state stream.
  socket.on("state:host", (payload) => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room || socket.id !== room.host || !room.guest) return;
    room.lastStateAt = Date.now();
    io.to(room.guest).emit("state:host", payload);
  });

  socket.on("voice:signal", (payload) => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;
    const target = socket.id === room.host ? room.guest : room.host;
    if (target) io.to(target).emit("voice:signal", payload);
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;

    if (socket.id === room.host) {
      io.to(code).emit("peer:disconnected", { playerId: 1, message: "Host disconnected." });
      rooms.delete(code);
    } else if (socket.id === room.guest) {
      room.guest = null;
      room.ready[2] = false;
      io.to(code).emit("peer:disconnected", { playerId: 2, message: "Guest disconnected." });
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
  console.log(`Casey's Clean Cut online server running on port ${PORT}`);
});
