import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIONS_PER_SHIFT, CURRENCY, JOBS, NODES, ROUNDS, ROUTES, START_BALANCE, UPGRADES,
  buyUpgrade, claimJob, createGame, deliverJob, endShift, getActions, getFuelCost,
  loadGame, move, pickupJob, saveGame,
} from '../dist/game.mjs';

function nextRound(state) {
  assert.equal(state.currentPlayer, 0);
  return endShift(endShift(state));
}

test('opens a ten-round match with both companies at their home depots', () => {
  const state = createGame(['  Rook ', '']);
  assert.equal(CURRENCY, 'SNRG');
  assert.equal(ROUNDS, 10);
  assert.equal(state.actionsRemaining, ACTIONS_PER_SHIFT);
  assert.deepEqual(state.players.map(({ name, node, balance }) => [name, node, balance]), [
    ['Rook', 'west', START_BALANCE], ['Ellis', 'east', START_BALANCE],
  ]);
  assert.deepEqual(getActions(state).claimIds, ['j1', 'j2', 'j3']);
  assert.equal(state.jobs.j4.status, 'scheduled');
  assert.deepEqual(getActions(state).upgradeIds, ['eco']);
  assert.deepEqual(loadGame(saveGame(state)), state);
});

test('every route joins real map nodes and the route graph connects all eight sites', () => {
  assert.equal(Object.keys(NODES).length, 8);
  const visited = new Set(['west']);
  for (let pass = 0; pass < ROUTES.length; pass += 1) {
    for (const route of ROUTES) {
      assert.ok(NODES[route.from] && NODES[route.to]);
      if (visited.has(route.from)) visited.add(route.to);
      if (visited.has(route.to)) visited.add(route.from);
    }
  }
  assert.equal(visited.size, 8);
  assert.equal(new Set(ROUTES.map(({ id }) => id)).size, ROUTES.length);
});

test('shared jobs can only be claimed once and a player has one active shipment', () => {
  const state = createGame();
  const claimed = claimJob(state, 'j3');
  assert.deepEqual(state.jobs.j3, { status: 'open', owner: null });
  assert.deepEqual(claimed.jobs.j3, { status: 'claimed', owner: 0 });
  assert.equal(claimed.actionsRemaining, ACTIONS_PER_SHIFT);
  assert.deepEqual(getActions(claimed).claimIds, []);
  assert.throws(() => claimJob(claimed, 'j1'), /no active shipment/);
  const otherShift = endShift(claimed);
  assert.deepEqual(getActions(otherShift).claimIds, ['j1', 'j2']);
  assert.throws(() => claimJob(otherShift, 'j3'), /open job/);
  assert.throws(() => pickupJob(otherShift, 'j3'), /your claimed shipment/);
});

test('pickup, route costs, delivery, and two full shifts account for all SNRG', () => {
  let state = createGame();
  assert.throws(() => move(state, 'heights-east'), /connected route/);
  assert.throws(() => pickupJob(state, 'j1'), /your claimed shipment/);
  state = claimJob(state, 'j1');
  state = pickupJob(state, 'j1');
  assert.throws(() => deliverJob(state, 'j1'), /its destination/);
  state = move(state, 'west-rail');
  state = move(state, 'rail-market');
  assert.equal(state.actionsRemaining, 0);
  assert.throws(() => deliverJob(state, 'j1'), /with an action/);
  assert.equal(state.players[0].balance, 132);
  assert.equal(state.jobs.j1.status, 'loaded');
  assert.deepEqual(loadGame(saveGame(state)), state);

  state = endShift(state);
  state = claimJob(state, 'j2');
  state = pickupJob(state, 'j2');
  state = move(state, 'heights-east');
  state = deliverJob(state, 'j2');
  assert.deepEqual(state.jobs.j2, { status: 'delivered', owner: 1 });
  assert.equal(state.players[1].balance, START_BALANCE - 8 + 35);

  state = endShift(state);
  assert.equal(state.round, 2);
  assert.equal(state.jobs.j4.status, 'open');
  state = deliverJob(state, 'j1');
  assert.deepEqual(state.jobs.j1, { status: 'delivered', owner: 0 });
  assert.deepEqual(state.players[0], {
    name: 'Mara', node: 'market', balance: 179, upgrades: [], delivered: 1, spent: 18, earned: 47, expressUsed: false,
  });
  assert.deepEqual(loadGame(saveGame(state)), state);
});

test('route options are bidirectional and constrained by fuel and action allowance', () => {
  let state = createGame();
  state = move(state, 'west-junction');
  assert.equal(state.players[0].node, 'junction');
  assert.deepEqual(getActions(state).routes.find(({ id }) => id === 'west-junction'), {
    id: 'west-junction', to: 'west', distance: 5, cost: 10, actions: 1,
  });
  state = move(state, 'west-junction');
  assert.equal(state.players[0].node, 'west');
  assert.equal(state.players[0].spent, 20);
  const broke = { ...state, players: [{ ...state.players[0], balance: 0 }, state.players[1]] };
  assert.deepEqual(getActions(broke).routes, []);
  assert.deepEqual(getActions(broke).upgradeIds, []);
  assert.equal(getActions(broke).canEnd, true);
});

test('the Fuel Saver is bought at West Depot and changes the fuel formula', () => {
  const initial = createGame();
  assert.throws(() => buyUpgrade(initial, 'express'), /its depot/);
  const upgraded = buyUpgrade(initial, 'eco');
  assert.equal(initial.players[0].balance, START_BALANCE);
  assert.deepEqual(initial.players[0].upgrades, []);
  assert.equal(upgraded.actionsRemaining, 2);
  assert.equal(upgraded.players[0].spent, UPGRADES.eco.cost);
  assert.equal(getFuelCost(upgraded, 'west-rail'), 5);
  assert.equal(getFuelCost(upgraded, 'west-rail', 1), 8);
  assert.throws(() => buyUpgrade(upgraded, 'eco'), /Buy the upgrade/);
  assert.equal(move(upgraded, 'west-rail').players[0].balance, START_BALANCE - UPGRADES.eco.cost - 5);
});

test('the Route Permit works with zero remaining actions once per shift', () => {
  let state = endShift(createGame());
  state = buyUpgrade(state, 'express');
  state = move(state, 'heights-east');
  state = move(state, 'heights-east');
  assert.equal(state.actionsRemaining, 0);
  assert.deepEqual(getActions(state).routes, [{ id: 'junction-east', to: 'junction', distance: 6, cost: 12, actions: 0 }]);
  state = move(state, 'junction-east');
  assert.equal(state.actionsRemaining, 0);
  assert.equal(state.players[1].expressUsed, true);
  assert.deepEqual(getActions(state).routes, []);
  assert.throws(() => move(state, 'junction-east'), /remaining actions/);
  state = endShift(endShift(state));
  assert.equal(state.currentPlayer, 1);
  assert.equal(state.players[1].expressUsed, false);
  assert.equal(getActions(state).routes.find(({ id }) => id === 'junction-east').actions, 0);
});

test('deadlines include the last shift, discard late cargo, and release the claim slot', () => {
  let state = nextRound(createGame());
  state = pickupJob(claimJob(state, 'j1'), 'j1');
  state = endShift(state);
  assert.equal(state.round, 2);
  assert.equal(state.jobs.j1.status, 'loaded');
  state = claimJob(state, 'j2');
  state = pickupJob(state, 'j2');
  state = move(state, 'heights-east');
  state = deliverJob(state, 'j2');
  state = endShift(state);
  assert.equal(state.round, 3);
  assert.deepEqual(state.jobs.j1, { status: 'expired', owner: 0 });
  assert.deepEqual(state.jobs.j2, { status: 'delivered', owner: 1 });
  assert.equal(state.jobs.j5.status, 'open');
  assert.equal(state.jobs.j6.status, 'open');
  assert.equal(state.players[0].balance, START_BALANCE);
  assert.throws(() => deliverJob(state, 'j1'), /loaded shipment/);
  assert.ok(getActions(state).claimIds.includes('j5'));
  assert.deepEqual(loadGame(saveGame(state)), state);
});

test('the last shift finishes the match by balance and finalizes all undelivered jobs', () => {
  let state = createGame();
  state = buyUpgrade(state, 'eco');
  for (let shift = 0; shift < ROUNDS * 2; shift += 1) {
    assert.equal(state.round, Math.floor(shift / 2) + 1);
    assert.equal(state.currentPlayer, shift % 2);
    state = endShift(state);
  }
  assert.equal(state.phase, 'finished');
  assert.equal(state.winner, 1);
  assert.equal(state.actionsRemaining, 0);
  assert.equal(state.activity[0].type, 'result');
  assert.equal(Object.values(state.jobs).filter(({ status }) => status === 'expired').length, JOBS.length);
  assert.deepEqual(getActions(state), { routes: [], claimIds: [], pickupIds: [], deliverIds: [], upgradeIds: [], canEnd: false });
  assert.throws(() => endShift(state), /already ended/);
  assert.deepEqual(loadGame(saveGame(state)), state);

  let tie = createGame();
  for (let shift = 0; shift < ROUNDS * 2; shift += 1) tie = endShift(tie);
  assert.equal(tie.winner, null);
  assert.match(tie.activity[0].message, /tied/);
});

test('save validation rejects invalid accounting, active job ownership, and time windows', () => {
  const state = createGame();
  assert.throws(() => loadGame('{'), /could not be read/);
  assert.throws(() => loadGame('null'), /invalid/);
  assert.throws(() => loadGame(saveGame({ ...state, version: 8 })), /invalid/);
  assert.throws(() => loadGame(saveGame({ ...state, actionsRemaining: 4 })), /invalid/);
  assert.throws(() => loadGame(saveGame({ ...state, players: [{ ...state.players[0], balance: 200 }, state.players[1]] })), /invalid/);
  assert.throws(() => loadGame(saveGame({ ...state, jobs: { ...state.jobs, j4: { status: 'open', owner: null } } })), /invalid/);
  const claimed = claimJob(state, 'j1');
  assert.throws(() => loadGame(saveGame({ ...claimed, jobs: { ...claimed.jobs, j2: { status: 'claimed', owner: 0 } } })), /invalid/);
  assert.throws(() => loadGame(saveGame({ ...claimed, jobs: { ...claimed.jobs, j1: { status: 'delivered', owner: 0 } } })), /invalid/);
});
