import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();
const PORT = Number(process.env.PORT || 3000);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let publicUrl = null;

function localAddresses() {
  return Object.values(os.networkInterfaces()).flatMap((items) =>
    (items || [])
      .filter((item) => item.family === 'IPv4' && !item.internal)
      .map((item) => `http://${item.address}:${PORT}`),
  );
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

function createCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function error(code, message) {
  return { ok: false, code, message };
}

function roomFor(socket) {
  return socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined;
}

function resultFor(chess) {
  if (!chess.isGameOver()) return { over: false, reason: null, winner: null };
  if (chess.isCheckmate()) return { over: true, reason: '将死', winner: chess.turn() === 'w' ? 'black' : 'white' };
  if (chess.isStalemate()) return { over: true, reason: '逼和', winner: null };
  if (chess.isThreefoldRepetition()) return { over: true, reason: '三次重复', winner: null };
  if (chess.isInsufficientMaterial()) return { over: true, reason: '子力不足', winner: null };
  if (chess.isDraw()) return { over: true, reason: '和棋', winner: null };
  return { over: true, reason: '和棋', winner: null };
}

function stateFor(room) {
  const result = resultFor(room.chess);
  const last = room.chess.history({ verbose: true }).at(-1);
  return {
    fen: room.chess.fen(),
    turn: room.chess.turn() === 'w' ? 'white' : 'black',
    players: { white: Boolean(room.players.white), black: Boolean(room.players.black) },
    over: result.over,
    reason: result.reason,
    winner: result.winner,
    inCheck: room.chess.inCheck(),
    lastMove: last ? { from: last.from, to: last.to, san: last.san } : null,
  };
}

function broadcastState(room) {
  io.to(room.code).emit('game:state', stateFor(room));
}

function leaveRoom(socket, notify = true) {
  const room = roomFor(socket);
  if (!room) return;
  const other = room.players.white === socket.id ? room.players.black : room.players.white;
  if (notify && other) io.to(other).emit('game:ended', { reason: '对手已断开连接' });
  rooms.delete(room.code);
  socket.leave(room.code);
  socket.data.roomCode = undefined;
  socket.data.color = undefined;
}

io.on('connection', (socket) => {
  socket.on('room:create', (_payload, ack = () => {}) => {
    if (roomFor(socket)) return ack(error('ALREADY_IN_ROOM', '你已经在一个房间中。'));
    const code = createCode();
    const room = { code, chess: new Chess(), players: { white: socket.id, black: null } };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.color = 'white';
    ack({ ok: true, roomCode: code, color: 'white', addresses: localAddresses(), inviteUrl: publicUrl });
    broadcastState(room);
  });

  socket.on('room:join', (payload = {}, ack = () => {}) => {
    if (roomFor(socket)) return ack(error('ALREADY_IN_ROOM', '你已经在一个房间中。'));
    const code = String(payload.roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack(error('ROOM_NOT_FOUND', '房间不存在或已结束。'));
    if (room.players.black) return ack(error('ROOM_FULL', '房间已满。'));
    room.players.black = socket.id;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.color = 'black';
    ack({ ok: true, roomCode: code, color: 'black' });
    broadcastState(room);
  });

  socket.on('game:move', (payload = {}, ack = () => {}) => {
    const room = roomFor(socket);
    if (!room) return ack(error('NOT_IN_ROOM', '你不在进行中的房间里。'));
    const color = socket.data.color;
    if (room.chess.turn() !== (color === 'white' ? 'w' : 'b')) return ack(error('NOT_YOUR_TURN', '还没轮到你走棋。'));
    if (resultFor(room.chess).over) return ack(error('GAME_OVER', '本局已经结束。'));
    const from = String(payload.from || '');
    const to = String(payload.to || '');
    const promotion = payload.promotion ? String(payload.promotion).toLowerCase() : undefined;
    try {
      const move = room.chess.move({ from, to, ...(promotion ? { promotion } : {}) });
      ack({ ok: true, move: { from: move.from, to: move.to, san: move.san } });
      broadcastState(room);
    } catch {
      ack(error('ILLEGAL_MOVE', '这一步棋不合法。'));
    }
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

if (process.send) {
  process.on('message', (message) => {
    if (message?.type === 'public-url' && typeof message.url === 'string') publicUrl = message.url;
  });
}

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`本机访问：http://localhost:${PORT}`);
    const addresses = localAddresses();
    if (addresses.length) console.log(`同一局域网的朋友可访问：${addresses.join('  ')}`);
    console.log('异地朋友需要公网部署或网络隧道。');
  });
}

export { app, server, io, rooms, createCode, resultFor, stateFor };
