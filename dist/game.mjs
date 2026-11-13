export const ROUNDS = 10;
export const ACTIONS_PER_SHIFT = 3;
export const START_BALANCE = 150;
export const CURRENCY = 'SNRG';

const VERSION = 1;
const ACTIVITY_LIMIT = 40;
const DEFAULT_NAMES = ['Mara', 'Ellis'];
const START_NODES = ['west', 'east'];

const sites = [
  ['rail', 'North Railyard', 'Railyard', 19, 26, 'rail'],
  ['market', 'Mercantile Market', 'Market', 45, 21, 'market'],
  ['heights', 'East Heights', 'Heights', 78, 24, 'heights'],
  ['west', 'West Depot', 'West Depot', 14, 56, 'depot'],
  ['junction', 'Central Junction', 'Junction', 43, 50, 'junction'],
  ['east', 'East Depot', 'East Depot', 83, 52, 'depot'],
  ['port', 'South Shipyard', 'Shipyard', 27, 78, 'port'],
  ['foundry', 'Riverside Foundry', 'Foundry', 69, 76, 'foundry'],
];

export const NODES = Object.freeze(Object.fromEntries(sites.map(([id, name, short, x, y, type]) =>
  [id, Object.freeze({ id, name, short, x, y, type })],
)));

export const ROUTES = Object.freeze([
  ['west', 'rail', 4],
  ['rail', 'market', 5],
  ['market', 'heights', 6],
  ['heights', 'east', 4],
  ['east', 'foundry', 5],
  ['foundry', 'port', 7],
  ['port', 'west', 4],
  ['west', 'junction', 5],
  ['market', 'junction', 4],
  ['junction', 'east', 6],
  ['junction', 'port', 5],
  ['junction', 'foundry', 4],
].map(([from, to, distance]) => Object.freeze({ id: `${from}-${to}`, from, to, distance })));

export const JOBS = Object.freeze([
  ['Breakwater Grocer', 'Fresh produce', 'west', 'market', 47, 1, 2],
  ['Skyline Cold Storage', 'Refrigerated cargo', 'east', 'heights', 35, 1, 2],
  ['Harbor Works', 'Pump housings', 'port', 'foundry', 56, 1, 4],
  ['Northline Co-op', 'Grain sacks', 'rail', 'west', 40, 2, 4],
  ['Grid Supply', 'Transformer parts', 'foundry', 'junction', 42, 3, 5],
  ['Mercantile Press', 'Print stock', 'market', 'rail', 44, 3, 5],
  ['East Ward Clinic', 'Medical supplies', 'junction', 'heights', 59, 4, 6],
  ['Atlas Marine', 'Engine parts', 'east', 'port', 68, 5, 8],
  ['North Rail Office', 'Switch assemblies', 'rail', 'junction', 53, 5, 8],
  ['Civic Kitchens', 'Meal boxes', 'market', 'west', 58, 7, 9],
  ['Basin Engineering', 'Steel castings', 'foundry', 'east', 52, 8, 10],
  ['Waterfront Relief', 'Water tanks', 'port', 'junction', 55, 9, 10],
].map(([name, cargo, from, to, payment, opens, deadline], index) =>
  Object.freeze({ id: `j${index + 1}`, name, cargo, from, to, payment, opens, deadline }),
));

export const UPGRADES = Object.freeze({
  eco: Object.freeze({
    id: 'eco', name: 'Fuel Saver', node: 'west', cost: 24,
    description: 'Pay distance + 1 SNRG in fuel instead of 2 SNRG per mile.',
  }),
  express: Object.freeze({
    id: 'express', name: 'Route Permit', node: 'east', cost: 22,
    description: 'Once per shift, travel a route of 6 miles or more without using an action.',
  }),
});

const JOB_BY_ID = Object.fromEntries(JOBS.map((job) => [job.id, job]));
const ACTIVITY_TYPES = ['system', 'move', 'claim', 'pickup', 'delivery', 'upgrade', 'expired', 'shift', 'result'];
const MAX_BALANCE = START_BALANCE + JOBS.reduce((sum, job) => sum + job.payment, 0);

function record(state, type, message, details = {}) {
  state.activity = [{ type, message, ...details }, ...state.activity].slice(0, ACTIVITY_LIMIT);
}

function copyState(state) {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    jobs: { ...state.jobs },
  };
}

function money(amount) {
  return `${amount} ${CURRENCY}`;
}

export function createGame(names = DEFAULT_NAMES) {
  const players = DEFAULT_NAMES.map((defaultName, index) => ({
    name: (typeof names?.[index] === 'string' && names[index].trim().slice(0, 24)) || defaultName,
    node: START_NODES[index],
    balance: START_BALANCE,
    upgrades: [],
    delivered: 0,
    spent: 0,
    earned: 0,
    expressUsed: false,
  }));
  const state = {
    version: VERSION,
    round: 1,
    currentPlayer: 0,
    actionsRemaining: ACTIONS_PER_SHIFT,
    players,
    jobs: Object.fromEntries(JOBS.map((job) => [job.id, { status: job.opens === 1 ? 'open' : 'scheduled', owner: null }])),
    phase: 'playing',
    winner: null,
    activity: [],
  };
  record(state, 'system', `Each company starts with ${START_BALANCE} practice ${CURRENCY}. Finish ${ROUNDS} rounds with the highest balance.`);
  return state;
}

function fuelCost(player, distance) {
  return player.upgrades.includes('eco') ? distance + 1 : distance * 2;
}

export function getFuelCost(state, routeId, playerIndex = state.currentPlayer) {
  const route = ROUTES.find((entry) => entry.id === routeId);
  if (!route) throw new Error('Choose a marked route.');
  return fuelCost(state.players[playerIndex], route.distance);
}

function canUsePermit(player, distance) {
  return distance >= 6 && !player.expressUsed && player.upgrades.includes('express');
}

function openJobForPlayer(state) {
  return JOBS.find(({ id }) => {
    const job = state.jobs[id];
    return job.owner === state.currentPlayer && (job.status === 'claimed' || job.status === 'loaded');
  });
}

export function getActions(state) {
  const actions = { routes: [], claimIds: [], pickupIds: [], deliverIds: [], upgradeIds: [], canEnd: state.phase === 'playing' };
  if (!actions.canEnd) return actions;

  const player = state.players[state.currentPlayer];
  for (const { id, from, to, distance } of ROUTES) {
    if (from !== player.node && to !== player.node) continue;
    const cost = fuelCost(player, distance);
    const required = canUsePermit(player, distance) ? 0 : 1;
    if (required <= state.actionsRemaining && cost <= player.balance) {
      actions.routes.push({ id, to: player.node === from ? to : from, distance, cost, actions: required });
    }
  }

  const active = openJobForPlayer(state);
  if (!active) actions.claimIds = JOBS.filter(({ id }) => state.jobs[id].status === 'open').map(({ id }) => id);
  if (state.actionsRemaining === 0) return actions;

  if (active && state.jobs[active.id].status === 'claimed' && active.from === player.node) actions.pickupIds.push(active.id);
  if (active && state.jobs[active.id].status === 'loaded' && active.to === player.node) actions.deliverIds.push(active.id);
  actions.upgradeIds = Object.values(UPGRADES).filter(({ id, node, cost }) =>
    node === player.node && cost <= player.balance && !player.upgrades.includes(id),
  ).map(({ id }) => id);
  return actions;
}

function spend(player, amount) {
  player.balance -= amount;
  player.spent += amount;
}

export function move(state, routeId) {
  const route = getActions(state).routes.find(({ id }) => id === routeId);
  if (!route) throw new Error('Choose a connected route you can afford with your remaining actions.');
  const next = copyState(state);
  const playerIndex = next.currentPlayer;
  const player = next.players[playerIndex];
  const origin = NODES[player.node];
  const destination = NODES[route.to];
  player.node = route.to;
  spend(player, route.cost);
  next.actionsRemaining -= route.actions;
  if (route.actions === 0) player.expressUsed = true;
  record(next, 'move', `${player.name} drove from ${origin.short} to ${destination.short} for ${money(route.cost)} in fuel.`, {
    playerIndex, nodeId: route.to, amount: -route.cost,
  });
  return next;
}

export function claimJob(state, jobId) {
  if (!getActions(state).claimIds.includes(jobId)) throw new Error('Claim an open job when your company has no active shipment.');
  const next = copyState(state);
  const playerIndex = next.currentPlayer;
  const job = JOB_BY_ID[jobId];
  next.jobs[jobId] = { status: 'claimed', owner: playerIndex };
  record(next, 'claim', `${next.players[playerIndex].name} claimed ${job.cargo.toLowerCase()} for ${job.name}.`, { playerIndex, jobId });
  return next;
}

export function pickupJob(state, jobId) {
  if (!getActions(state).pickupIds.includes(jobId)) throw new Error('Pick up your claimed shipment at its origin with an action available.');
  const next = copyState(state);
  const playerIndex = next.currentPlayer;
  const job = JOB_BY_ID[jobId];
  next.actionsRemaining -= 1;
  next.jobs[jobId] = { status: 'loaded', owner: playerIndex };
  record(next, 'pickup', `${next.players[playerIndex].name} loaded ${job.cargo.toLowerCase()} at ${NODES[job.from].name}.`, {
    playerIndex, jobId, nodeId: job.from,
  });
  return next;
}

export function deliverJob(state, jobId) {
  if (!getActions(state).deliverIds.includes(jobId)) throw new Error('Deliver your loaded shipment at its destination with an action available.');
  const next = copyState(state);
  const playerIndex = next.currentPlayer;
  const player = next.players[playerIndex];
  const job = JOB_BY_ID[jobId];
  next.actionsRemaining -= 1;
  next.jobs[jobId] = { status: 'delivered', owner: playerIndex };
  player.balance += job.payment;
  player.earned += job.payment;
  player.delivered += 1;
  record(next, 'delivery', `${player.name} delivered ${job.cargo.toLowerCase()} to ${NODES[job.to].name} and earned ${money(job.payment)}.`, {
    playerIndex, jobId, nodeId: job.to, amount: job.payment,
  });
  return next;
}

export function buyUpgrade(state, upgradeId) {
  if (!getActions(state).upgradeIds.includes(upgradeId)) throw new Error('Buy the upgrade at its depot with enough funds and an action available.');
  const next = copyState(state);
  const playerIndex = next.currentPlayer;
  const player = next.players[playerIndex];
  const upgrade = UPGRADES[upgradeId];
  spend(player, upgrade.cost);
  next.actionsRemaining -= 1;
  player.upgrades = [...player.upgrades, upgradeId];
  record(next, 'upgrade', `${player.name} bought the ${upgrade.name} for ${money(upgrade.cost)}.`, {
    playerIndex, nodeId: upgrade.node, amount: -upgrade.cost,
  });
  return next;
}

function expireJobs(state) {
  for (const job of JOBS) {
    const { status, owner } = state.jobs[job.id];
    if (job.deadline !== state.round || status === 'delivered') continue;
    state.jobs[job.id] = { status: 'expired', owner };
    const message = owner === null
      ? `The job from ${job.name} expired.`
      : `${state.players[owner].name} missed the ${job.name} delivery deadline.`;
    record(state, 'expired', message, owner === null ? { jobId: job.id } : { jobId: job.id, playerIndex: owner });
  }
}

function resolveWinner(state) {
  const margin = state.players[0].balance - state.players[1].balance;
  if (margin === 0) return null;
  return margin > 0 ? 0 : 1;
}

export function endShift(state) {
  if (state.phase !== 'playing') throw new Error('The match has already ended.');
  const next = copyState(state);
  if (next.currentPlayer === 1) {
    expireJobs(next);
    if (next.round === ROUNDS) {
      next.phase = 'finished';
      next.actionsRemaining = 0;
      next.winner = resolveWinner(next);
      const winner = next.players[next.winner ?? 0];
      const message = next.winner === null
        ? `Both companies tied with ${money(winner.balance)}.`
        : `${winner.name} finished first with ${money(winner.balance)}.`;
      record(next, 'result', message);
      return next;
    }
    next.round += 1;
    for (const job of JOBS) {
      if (job.opens === next.round) next.jobs[job.id] = { status: 'open', owner: null };
    }
  }
  next.currentPlayer = 1 - next.currentPlayer;
  const player = next.players[next.currentPlayer];
  player.expressUsed = false;
  next.actionsRemaining = ACTIONS_PER_SHIFT;
  record(next, 'shift', `Round ${next.round} · ${player.name} starts a shift.`, { playerIndex: next.currentPlayer });
  return next;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIntBetween(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validPlayer(player) {
  return isRecord(player) && typeof player.name === 'string' && player.name.trim().length > 0 && player.name.length <= 24
    && typeof player.node === 'string' && Object.hasOwn(NODES, player.node)
    && isIntBetween(player.balance, 0, MAX_BALANCE) && isIntBetween(player.delivered, 0, JOBS.length)
    && isIntBetween(player.spent, 0, MAX_BALANCE) && isIntBetween(player.earned, 0, MAX_BALANCE - START_BALANCE)
    && player.balance === START_BALANCE + player.earned - player.spent
    && Array.isArray(player.upgrades) && new Set(player.upgrades).size === player.upgrades.length
    && player.upgrades.every((id) => typeof id === 'string' && Object.hasOwn(UPGRADES, id))
    && typeof player.expressUsed === 'boolean' && (!player.expressUsed || player.upgrades.includes('express'));
}

function validJobs(state) {
  if (!isRecord(state.jobs) || Object.keys(state.jobs).length !== JOBS.length) return false;
  const balances = state.players.map(() => ({ active: 0, delivered: 0, earned: 0 }));
  for (const { id, opens, deadline, payment } of JOBS) {
    const job = state.jobs[id];
    if (!isRecord(job) || ![null, 0, 1].includes(job.owner)) return false;
    const { status, owner } = job;
    if (opens > state.round) {
      if (status !== 'scheduled' || owner !== null) return false;
    } else if (status === 'delivered' && owner !== null) {
      balances[owner].delivered += 1;
      balances[owner].earned += payment;
    } else if (deadline < state.round || state.phase === 'finished') {
      if (status !== 'expired') return false;
    } else if ((status === 'claimed' || status === 'loaded') && owner !== null) {
      balances[owner].active += 1;
    } else if (status !== 'open' || owner !== null) {
      return false;
    }
  }
  return balances.every(({ active, delivered, earned }, index) =>
    active <= 1 && delivered === state.players[index].delivered && earned === state.players[index].earned,
  );
}

function validActivity(entry) {
  return isRecord(entry) && ACTIVITY_TYPES.includes(entry.type) && typeof entry.message === 'string'
    && entry.message.length > 0 && entry.message.length <= 240
    && (entry.playerIndex === undefined || isIntBetween(entry.playerIndex, 0, 1))
    && (entry.jobId === undefined || (typeof entry.jobId === 'string' && Object.hasOwn(JOB_BY_ID, entry.jobId)))
    && (entry.nodeId === undefined || (typeof entry.nodeId === 'string' && Object.hasOwn(NODES, entry.nodeId)))
    && (entry.amount === undefined || isIntBetween(entry.amount, -MAX_BALANCE, MAX_BALANCE));
}

function validPhase(state) {
  if (state.phase === 'playing') return state.winner === null;
  return state.phase === 'finished' && state.round === ROUNDS && state.currentPlayer === 1
    && state.actionsRemaining === 0 && state.winner === resolveWinner(state);
}

export function saveGame(state) {
  return JSON.stringify(state);
}

export function loadGame(json) {
  let state;
  try {
    state = JSON.parse(json);
  } catch {
    throw new Error('This saved game could not be read.');
  }
  if (!isRecord(state) || state.version !== VERSION || !isIntBetween(state.round, 1, ROUNDS)
    || !isIntBetween(state.currentPlayer, 0, 1) || !isIntBetween(state.actionsRemaining, 0, ACTIONS_PER_SHIFT)
    || !Array.isArray(state.players) || state.players.length !== 2 || !state.players.every(validPlayer)
    || !validPhase(state) || !validJobs(state) || !Array.isArray(state.activity)
    || state.activity.length > ACTIVITY_LIMIT || !state.activity.every(validActivity)) {
    throw new Error('This saved game is invalid or uses an unsupported format.');
  }
  return state;
}
