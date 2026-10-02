import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { io as connect } from 'socket.io-client';
import { io, server } from '../server.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const appScript = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function waitFor(check, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check()) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > timeout) { clearInterval(timer); reject(new Error('Timed out waiting for UI state')); }
    }, 20);
  });
}

function makePage(baseUrl) {
  const dom = new JSDOM(html, { url: baseUrl, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.io = (options) => {
    dom.window.__socket = connect(baseUrl, options);
    return dom.window.__socket;
  };
  dom.window.document.execCommand = (command) => {
    if (command !== 'copy') return false;
    dom.window.__copiedText = dom.window.document.activeElement.value;
    return true;
  };
  dom.window.eval(appScript);
  return dom;
}

test('UI creates and joins a room, moves pieces, and exposes the invite fallback', async (t) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const white = makePage(baseUrl);
  const black = makePage(baseUrl);
  t.after(async () => {
    white.window.__socket.disconnect();
    black.window.__socket.disconnect();
    white.window.close();
    black.window.close();
    await new Promise((resolve) => io.close(resolve));
  });

  await waitFor(() => white.window.document.getElementById('connection-status').textContent === '服务已连接');
  white.window.document.getElementById('create-room').click();
  await waitFor(() => !white.window.document.getElementById('game').classList.contains('hidden'));
  const roomCode = white.window.document.getElementById('room-code').textContent;
  assert.match(roomCode, /^[A-Z0-9]{6}$/);

  black.window.document.getElementById('room-code-input').value = roomCode;
  black.window.document.getElementById('join-room').click();
  await waitFor(() => !black.window.document.getElementById('game').classList.contains('hidden'));
  await waitFor(() => white.window.document.getElementById('black-status').textContent === '已连接');

  const board = white.window.document.getElementById('board');
  board.querySelector('[data-square="e2"]').click();
  board.querySelector('[data-square="e4"]').click();
  await waitFor(() => black.window.document.getElementById('turn-status').textContent === '轮到黑方走棋');

  white.window.document.getElementById('copy-invite').click();
  await waitFor(() => white.window.document.getElementById('game-message').textContent.includes('已复制'));
  assert.match(white.window.__copiedText, new RegExp(`room=${roomCode}`));
});
