const socket = io({ reconnection: true, timeout: 8000 });
const $ = (id) => document.getElementById(id);
const pieces = { wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔', bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚' };
let myColor = null;
let roomCode = null;
let state = null;
let selected = null;
let pendingPromotion = null;

function setLobbyMessage(message) { $('lobby-message').textContent = message; }
function setGameMessage(message) { $('game-message').textContent = message; }
function showGame() { $('lobby').classList.add('hidden'); $('game').classList.remove('hidden'); $('room-code').textContent = roomCode; }
function updateConnection(connected, message) {
  const label = message || (connected ? '服务已连接' : '连接中断');
  $('connection-status').textContent = label;
  $('connection-dot').classList.toggle('online', connected);
  $('connection-dot').classList.toggle('offline', !connected && label !== '正在连接');
}
function request(event, payload, callback, errorTarget) {
  if (!socket.connected) {
    errorTarget('尚未连接到对局服务，请稍候再试。');
    return;
  }
  socket.timeout(7000).emit(event, payload, (timeoutError, response) => {
    if (timeoutError) {
      errorTarget('服务器暂时没有响应，请检查网络连接后重试。');
      return;
    }
    if (!response?.ok) {
      errorTarget(response?.message || '操作失败，请重试。');
      return;
    }
    callback(response);
  });
}
function fenBoard(fen) {
  return fen.split(' ')[0].split('/').flatMap((row) =>
    [...row].flatMap((character) => /\d/.test(character) ? Array(Number(character)).fill(null) : [character]),
  );
}
function squareName(index) {
  const row = Math.floor(index / 8);
  const column = index % 8;
  return `${String.fromCharCode(97 + column)}${8 - row}`;
}
function squareToIndex(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return (8 - rank) * 8 + file;
}
function renderBoard() {
  const board = $('board');
  board.replaceChildren();
  if (!state) return;
  const cells = fenBoard(state.fen);
  const order = myColor === 'black' ? [...Array(64).keys()].reverse() : [...Array(64).keys()];
  order.forEach((sourceIndex, visualIndex) => {
    const value = cells[sourceIndex];
    const row = Math.floor(visualIndex / 8);
    const column = visualIndex % 8;
    const square = document.createElement('button');
    square.type = 'button';
    square.className = `square ${(row + column) % 2 ? 'dark' : 'light'}`;
    square.dataset.square = squareName(sourceIndex);
    square.setAttribute('role', 'gridcell');
    square.setAttribute('aria-label', `${square.dataset.square}${value ? ` ${value}` : ''}`);
    if (value) {
      square.dataset.piece = value === value.toUpperCase() ? 'white' : 'black';
      square.textContent = pieces[`${square.dataset.piece === 'white' ? 'w' : 'b'}${value.toLowerCase()}`];
    }
    if (state.lastMove && [state.lastMove.from, state.lastMove.to].includes(square.dataset.square)) square.classList.add('last');
    if (selected === square.dataset.square) square.classList.add('selected');
    square.addEventListener('click', () => clickSquare(square.dataset.square, value));
    board.append(square);
  });
}
function clickSquare(square, value) {
  if (!state || state.over || state.turn !== myColor || !state.players.white || !state.players.black) return;
  const pieceColor = value ? (value === value.toUpperCase() ? 'white' : 'black') : null;
  if (!selected) {
    if (pieceColor === myColor) {
      selected = square;
      renderBoard();
    }
    return;
  }
  if (pieceColor === myColor) {
    selected = square;
    renderBoard();
    return;
  }
  const piece = fenBoard(state.fen)[squareToIndex(selected)];
  const isPromotion = piece?.toLowerCase() === 'p' && (myColor === 'white' ? square.endsWith('8') : square.endsWith('1'));
  if (isPromotion) {
    pendingPromotion = { from: selected, to: square };
    openPromotion();
  } else {
    sendMove(selected, square);
  }
}
function sendMove(from, to, promotion) {
  request('game:move', { from, to, ...(promotion ? { promotion } : {}) }, () => {
    selected = null;
    setGameMessage('');
  }, setGameMessage);
}
function openPromotion() {
  const options = $('promotion-options');
  options.replaceChildren();
  const choices = myColor === 'white'
    ? [['q', '♕'], ['r', '♖'], ['b', '♗'], ['n', '♘']]
    : [['q', '♛'], ['r', '♜'], ['b', '♝'], ['n', '♞']];
  choices.forEach(([type, icon]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = icon;
    button.setAttribute('aria-label', ({ q: '后', r: '车', b: '象', n: '马' })[type]);
    button.addEventListener('click', () => {
      const move = pendingPromotion;
      pendingPromotion = null;
      $('promotion-modal').classList.add('hidden');
      if (move) sendMove(move.from, move.to, type);
    });
    options.append(button);
  });
  $('promotion-modal').classList.remove('hidden');
}
function updateInvite(address) {
  const root = address || window.location.origin;
  const invite = `${root.replace(/\/$/, '')}/?room=${roomCode}`;
  $('invite-link').value = invite;
  $('invite-panel').classList.remove('hidden');
  return invite;
}
async function copyInvite() {
  const address = window.publicInviteUrl || (window.inviteAddresses || []).find((item) => !item.includes('localhost')) || window.location.origin;
  const invite = updateInvite(address);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(invite);
    } else {
      throw new Error('clipboard unavailable');
    }
    setGameMessage('邀请链接已复制，发给朋友即可加入。');
  } catch {
    const input = $('invite-link');
    input.focus();
    input.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    if (copied) {
      setGameMessage('邀请链接已复制。');
    } else {
      $('invite-panel').classList.remove('hidden');
      setGameMessage('自动复制不可用，已选中邀请链接，请按 Ctrl+C 复制。');
    }
  }
}
function applyState(next) {
  state = next;
  $('white-status').textContent = next.players.white ? (myColor === 'white' ? '你 · 已连接' : '已连接') : '等待加入';
  $('black-status').textContent = next.players.black ? (myColor === 'black' ? '你 · 已连接' : '已连接') : '等待加入';
  const complete = next.players.white && next.players.black;
  $('turn-status').textContent = next.over
    ? `${next.reason}${next.winner ? ` · ${next.winner === 'white' ? '白方' : '黑方'}获胜` : ''}`
    : !complete ? '等待朋友加入棋室' : `轮到${next.turn === 'white' ? '白方' : '黑方'}走棋`;
  $('white-turn-dot').classList.toggle('active', complete && !next.over && next.turn === 'white');
  $('black-turn-dot').classList.toggle('active', complete && !next.over && next.turn === 'black');
  $('new-room').classList.toggle('hidden', !next.over);
  renderBoard();
}
function createRoom() {
  setLobbyMessage('正在创建房间…');
  $('create-room').disabled = true;
  request('room:create', {}, (response) => {
    roomCode = response.roomCode;
    myColor = response.color;
    window.inviteAddresses = response.addresses || [];
    window.publicInviteUrl = response.inviteUrl || null;
    showGame();
    updateInvite(window.publicInviteUrl || window.inviteAddresses[0]);
    setGameMessage('把房间码或邀请链接发给朋友。');
  }, setLobbyMessage);
  window.setTimeout(() => { $('create-room').disabled = false; }, 7200);
}
function joinRoom() {
  const code = $('room-code-input').value.trim();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    setLobbyMessage('请输入完整的 6 位房间码。');
    $('room-code-input').focus();
    return;
  }
  setLobbyMessage('正在加入房间…');
  $('join-room').disabled = true;
  request('room:join', { roomCode: code }, (response) => {
    roomCode = response.roomCode;
    myColor = response.color;
    showGame();
    setGameMessage('已加入房间，准备开始。');
  }, setLobbyMessage);
  window.setTimeout(() => { $('join-room').disabled = false; }, 7200);
}

$('create-room').addEventListener('click', createRoom);
$('join-room').addEventListener('click', joinRoom);
$('room-code-input').addEventListener('input', (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  setLobbyMessage('');
});
$('room-code-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(); });
$('copy-invite').addEventListener('click', copyInvite);
$('copy-link-fallback').addEventListener('click', copyInvite);
$('new-room').addEventListener('click', () => { window.location.assign('/'); });

socket.on('connect', () => updateConnection(true));
socket.on('disconnect', () => updateConnection(false));
socket.on('connect_error', () => updateConnection(false, '无法连接到服务'));
socket.on('game:state', applyState);
socket.on('game:ended', (data) => {
  if (state) applyState({ ...state, over: true, players: { white: false, black: false }, reason: data.reason, winner: null });
  setGameMessage(data.reason);
});

const initialRoom = new URLSearchParams(window.location.search).get('room');
if (initialRoom) $('room-code-input').value = initialRoom.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
