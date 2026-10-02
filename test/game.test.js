import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { createCode, resultFor } from '../server.js';

test('room codes are six characters and avoid ambiguous symbols', () => {
  const code = createCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
});

test('chess.js validates standard special moves', () => {
  const chess = new Chess();
  chess.move('e4'); chess.move('e5'); chess.move('Nf3'); chess.move('Nc6'); chess.move('Bb5'); chess.move('a6'); chess.move('Ba4'); chess.move('Nf6'); chess.move('O-O');
  assert.equal(chess.isGameOver(), false);
});

test('checkmate result identifies the winner', () => {
  const chess = new Chess();
  for (const move of ['f3', 'e5', 'g4', 'Qh4#']) chess.move(move);
  assert.deepEqual(resultFor(chess), { over: true, reason: '将死', winner: 'black' });
});
