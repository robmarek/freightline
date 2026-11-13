import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROUNDS, START_BALANCE, buyUpgrade, claimJob, createGame, endShift, loadGame, move, pickupJob, saveGame,
} from '../dist/game.mjs';
import { playOpponentShift } from '../dist/opponent.mjs';

test('the opponent takes an available depot job and returns the turn to the human', () => {
  let state = claimJob(createGame(), 'j1');
  state = pickupJob(state, 'j1');
  state = move(move(state, 'west-rail'), 'rail-market');
  state = endShift(state);

  const original = saveGame(state);
  const next = playOpponentShift(state);
  assert.deepEqual(playOpponentShift(state), next);
  assert.equal(saveGame(state), original);
  assert.equal(next.currentPlayer, 0);
  assert.equal(next.round, 2);
  assert.equal(next.players[1].balance, START_BALANCE - 8 + 35);
  assert.deepEqual(next.jobs.j1, { status: 'loaded', owner: 0 });
  assert.deepEqual(next.jobs.j2, { status: 'delivered', owner: 1 });
});

test('the opponent plans a low-fuel delivery that spans shifts', () => {
  let state = claimJob(endShift(createGame()), 'j3');
  state = playOpponentShift(state);
  assert.deepEqual(state.jobs.j3, { status: 'loaded', owner: 1 });
  assert.equal(state.players[1].node, 'port');
  assert.equal(state.players[1].spent, 22);
  assert.equal(state.round, 2);

  state = playOpponentShift(endShift(state));
  assert.deepEqual(state.jobs.j3, { status: 'delivered', owner: 1 });
  assert.equal(state.players[1].earned, 56);
  assert.ok(state.players[1].balance >= START_BALANCE);
  assert.deepEqual(loadGame(saveGame(state)), state);
});

test('the opponent accounts for a permit and can finish a last-shift delivery with one action', () => {
  let state = createGame();
  for (let shift = 0; shift < 5; shift += 1) state = endShift(state);
  state = buyUpgrade(claimJob(state, 'j3'), 'express');
  state = move(move(state, 'east-foundry'), 'foundry-port');
  state = pickupJob(state, 'j3');
  state = endShift(endShift(state));
  state = { ...state, actionsRemaining: 1 };

  const next = playOpponentShift(state);
  assert.deepEqual(next.jobs.j3, { status: 'delivered', owner: 1 });
  assert.equal(next.players[1].node, 'foundry');
  assert.equal(next.players[1].expressUsed, true);
  assert.equal(next.players[1].earned, 56);
  assert.equal(next.round, 5);
});

test('an infeasible last-shift shipment expires without extra fuel costs', () => {
  let state = createGame();
  for (let shift = 0; shift < 3; shift += 1) state = endShift(state);
  state = claimJob(state, 'j1');
  state = { ...state, actionsRemaining: 0 };

  const next = playOpponentShift(state);
  assert.deepEqual(next.jobs.j1, { status: 'expired', owner: 1 });
  assert.equal(next.players[1].spent, 0);
  assert.equal(next.players[1].node, 'east');
  assert.equal(next.currentPlayer, 0);
  assert.equal(next.round, 3);
});

test('the opponent leaves human shifts and finished matches alone', () => {
  const initial = createGame();
  assert.equal(playOpponentShift(initial), initial);
  let state = initial;
  for (let round = 1; round <= ROUNDS; round += 1) {
    state = playOpponentShift(endShift(state));
    assert.deepEqual(loadGame(saveGame(state)), state);
  }
  assert.equal(state.phase, 'finished');
  assert.equal(state.winner, 1);
  assert.ok(state.players[1].delivered >= 5);
  assert.ok(state.players[1].balance > START_BALANCE + 100);
  assert.equal(playOpponentShift(state), state);
});
