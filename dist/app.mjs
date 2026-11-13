import {
  ACTIONS_PER_SHIFT, CURRENCY, JOBS, NODES, ROUNDS, ROUTES, START_BALANCE, UPGRADES,
  buyUpgrade, claimJob, createGame, deliverJob, endShift, getActions, getFuelCost,
  loadGame, move, pickupJob, saveGame,
} from './game.mjs';
import { SYNERGY_NETWORK, checkSynergyNetwork } from './synergy.mjs';

const byId = (id) => document.getElementById(id);
const storageKey = 'freightline.dispatch.v1';
const number = new Intl.NumberFormat('en-US');
const snrg = (value) => `${number.format(value)} ${CURRENCY}`;
const icons = { rail: '╫', market: '▤', heights: '▲', depot: '▣', junction: '✣', port: '⚓', foundry: '▥' };
const jobStates = { open: 'Open', scheduled: 'Scheduled', claimed: 'Claimed', loaded: 'In transit', delivered: 'Delivered', expired: 'Expired' };

function element(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function button(label, style, id, handler) {
  const item = element('button', style, label);
  item.type = 'button';
  if (id) item.id = id;
  item.addEventListener('click', handler);
  return item;
}

function restoreMatch() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return loadGame(saved);
  } catch {
    // A fresh game still works with invalid saves or restricted storage.
  }
  return createGame();
}

let state = restoreMatch();
let selected = state.players[state.currentPlayer].node;
let filter = 'open';
let canvasActions = [];

function persist() {
  try {
    localStorage.setItem(storageKey, saveGame(state));
  } catch {
    // Keep the active game playable when storage is unavailable.
  }
}

function activeJob() {
  return JOBS.find(({ id }) => {
    const job = state.jobs[id];
    return job.owner === state.currentPlayer && ['claimed', 'loaded'].includes(job.status);
  });
}

function setNotice(text, isError = false) {
  const notice = byId('notice');
  notice.textContent = text;
  notice.classList.toggle('error', isError);
}

function dispatch(action, { view, destination, focus } = {}) {
  try {
    state = action(state);
  } catch (issue) {
    setNotice(issue.message, true);
    return;
  }
  if (view) filter = view;
  selected = destination ?? state.players[state.currentPlayer].node;
  persist();
  render();
  setNotice(state.activity[0]?.message ?? '');
  if (focus) (byId(focus) ?? byId('end-shift')).focus({ preventScroll: true });
}

function otherEnd(road, district) {
  if (road.from === district) return road.to;
  if (road.to === district) return road.from;
  return null;
}

function lowestFuel(from, to) {
  const remaining = new Set(Object.keys(NODES));
  const totals = new Map([[from, 0]]);
  const firstRoads = new Map();
  while (remaining.size) {
    const next = [...remaining].filter((id) => totals.has(id)).sort((a, b) => totals.get(a) - totals.get(b))[0];
    if (!next || next === to) break;
    remaining.delete(next);
    for (const road of ROUTES) {
      const adjacent = otherEnd(road, next);
      if (!remaining.has(adjacent)) continue;
      const cost = totals.get(next) + getFuelCost(state, road.id);
      if (cost >= (totals.get(adjacent) ?? Infinity)) continue;
      totals.set(adjacent, cost);
      firstRoads.set(adjacent, firstRoads.get(next) ?? road.id);
    }
  }
  return { cost: totals.get(to), firstRoad: firstRoads.get(to) };
}

function renderFleets() {
  const fleets = state.players.map((player, index) => {
    const current = state.phase === 'playing' && index === state.currentPlayer;
    const panel = element('article', `fleet p${index}${current ? ' active' : ''}`);
    const avatar = element('div', 'fleet-avatar', index + 1);
    avatar.setAttribute('aria-hidden', 'true');
    const name = element('div', 'fleet-name');
    name.append(element('strong', '', player.name), element('small', '', `${NODES[player.node].short} · ${player.delivered} delivered`));
    const score = element('div', 'fleet-score');
    score.append(element('strong', '', snrg(player.balance)), element('small', '', current ? 'ON SHIFT' : 'BALANCE'));
    panel.append(avatar, name, score);
    return panel;
  });
  byId('fleets').replaceChildren(...fleets);
}

const mapMarkers = Object.values(NODES).map((node) => {
  const marker = button('', 'map-node', `map-${node.id}`, () => inspect(node.id));
  marker.style.left = `${node.x}%`;
  marker.style.top = `${node.y}%`;
  const icon = element('span', '', icons[node.type]);
  icon.setAttribute('aria-hidden', 'true');
  marker.append(icon, element('span', 'label', node.short), element('span', 'marker-badges'));
  byId('map-markers').append(marker);
  return { node, marker };
});

function drawRoads() {
  const canvas = byId('roads');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas.getBoundingClientRect();
  if (width === 0 || height === 0) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  ctx.scale(scale, scale);
  const reachable = new Set(canvasActions.map(({ id }) => id));
  for (const road of [...ROUTES].sort((a, b) => Number(reachable.has(a.id)) - Number(reachable.has(b.id)))) {
    const from = NODES[road.from];
    const to = NODES[road.to];
    const live = reachable.has(road.id);
    const startX = from.x * width / 100;
    const startY = from.y * height / 100;
    const endX = to.x * width / 100;
    const endY = to.y * height / 100;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.setLineDash([]);
    ctx.lineWidth = live ? 5 : 3.5;
    ctx.strokeStyle = '#101820d0';
    ctx.stroke();
    ctx.setLineDash(live ? [] : [6, 4]);
    ctx.lineWidth = live ? 2.5 : 1.3;
    ctx.strokeStyle = live ? '#ffac5e' : '#bbcbd4a8';
    ctx.stroke();
  }
}

new ResizeObserver(drawRoads).observe(byId('map'));

function renderMap(actions) {
  const player = state.players[state.currentPlayer];
  const job = activeJob();
  const target = job && (state.jobs[job.id].status === 'loaded' ? job.to : job.from);
  const routeNodes = new Set(actions.routes.map(({ to }) => to));
  for (const { node, marker } of mapMarkers) {
    const here = state.players.flatMap((entry, index) => entry.node === node.id ? [index] : []);
    const current = state.phase === 'playing' && player.node === node.id;
    marker.classList.toggle('current', current);
    marker.classList.toggle('p1', current && state.currentPlayer === 1);
    marker.classList.toggle('selected', selected === node.id);
    marker.classList.toggle('target', target === node.id && state.phase === 'playing');
    marker.classList.toggle('reachable', routeNodes.has(node.id));
    marker.setAttribute('aria-pressed', String(selected === node.id));
    const labels = [node.name];
    if (here.length) labels.push(`Fleets here: ${here.map((index) => state.players[index].name).join(', ')}`);
    if (routeNodes.has(node.id)) labels.push('Reachable');
    if (target === node.id && state.phase === 'playing') labels.push('Cargo stop');
    marker.setAttribute('aria-label', labels.join('. '));
    marker.querySelector('.marker-badges').replaceChildren(...here.map((index) => element('span', `p${index}`, index + 1)));
    marker.querySelector('.marker-badges').setAttribute('aria-hidden', 'true');
  }
  canvasActions = actions.routes;
  drawRoads();
}

function inspect(destination, focus = false) {
  selected = destination;
  const actions = getActions(state);
  renderMap(actions);
  renderRoutes(actions);
  if (focus) (byId('drive-selected') ?? byId(`map-${destination}`)).focus({ preventScroll: true });
}

function routeButton(route, label, style, id) {
  return button(label, style, id, () => dispatch((current) => move(current, route.id), { focus: `map-${route.to}` }));
}

function renderRoutes(actions) {
  const area = byId('route-details');
  const current = state.players[state.currentPlayer].node;
  const node = NODES[selected];
  const job = activeJob();
  const target = job && (state.jobs[job.id].status === 'loaded' ? job.to : job.from);
  const route = actions.routes.find(({ to }) => to === selected);
  const summary = element('div', 'route-summary');
  const info = element('div');
  info.append(element('h3', '', node.name));
  let detail = '';
  if (state.phase === 'finished') detail = 'Match complete.';
  else if (route) detail = `${route.distance} mi · ${snrg(route.cost)} fuel · ${route.actions === 0 ? 'Permit move' : '1 action'}`;
  else if (selected === current) detail = 'Current fleet location';
  else detail = `Lowest fuel from ${NODES[current].short} · ${snrg(lowestFuel(current, selected).cost)}`;
  info.append(element('p', '', detail));
  summary.append(info);
  if (route) summary.append(routeButton(route, `Drive to ${node.short}`, 'button primary', 'drive-selected'));
  const list = element('div', 'route-list');
  for (const available of actions.routes) {
    const item = routeButton(available, `Drive to ${NODES[available.to].short}`, 'route-choice', `drive-${available.to}`);
    item.append(element('span', '', snrg(available.cost)));
    list.append(item);
  }
  const tools = actions.upgradeIds.map((id) => {
    const upgrade = UPGRADES[id];
    const item = button(`Buy ${upgrade.name} · ${snrg(upgrade.cost)}`, 'button secondary', `buy-${id}`,
      () => dispatch((game) => buyUpgrade(game, id), { focus: `map-${current}` }));
    item.title = upgrade.description;
    return item;
  });
  area.replaceChildren(summary);
  if (state.phase !== 'playing') return;
  if (target && target !== current) {
    const nextRoute = ROUTES.find(({ id }) => id === lowestFuel(current, target).firstRoad);
    area.append(element('p', 'route-hint', `Next cargo stop ${NODES[target].name}. Lowest-fuel route via ${NODES[otherEnd(nextRoute, current)].short}.`));
  }
  if (actions.routes.length) area.append(list);
  else area.append(element('p', 'route-hint', 'No affordable road available with the actions left this shift.'));
  if (tools.length) {
    const upgrades = element('div', 'upgrade-list');
    upgrades.append(...tools);
    const description = element('p', 'route-hint', actions.upgradeIds.map((id) => UPGRADES[id].description).join(' '));
    area.append(upgrades, description);
  }
}

function renderShift(actions) {
  const finished = state.phase === 'finished';
  const player = state.players[state.currentPlayer];
  const clock = element('div', 'clock-line');
  clock.append(element('span', '', 'MATCH PROGRESS'), element('strong', '', `${String(state.round).padStart(2, '0')} / ${ROUNDS}`));
  const track = element('div', 'shift-track');
  track.setAttribute('aria-hidden', 'true');
  track.append(...Array.from({ length: ROUNDS }, (_, index) => element('span', index + 1 === state.round ? 'current' : index + 1 < state.round ? 'past' : '')));
  byId('shift-clock').replaceChildren(clock, track);
  const title = byId('turn-title');
  title.textContent = finished ? (state.winner === null ? 'A tied match' : `${state.players[state.winner].name} wins`) : `${player.name}’s shift`;
  title.previousElementSibling.textContent = finished ? 'FINAL STANDINGS' : 'ACTIVE SHIFT';
  const pips = element('div', 'action-pips');
  pips.setAttribute('aria-hidden', 'true');
  pips.append(...Array.from({ length: ACTIONS_PER_SHIFT }, (_, index) => element('i', index < state.actionsRemaining ? 'ready' : '')));
  byId('actions-count').replaceChildren(element('span', '', finished ? 'MATCH COMPLETE' : `${state.actionsRemaining} / ${ACTIONS_PER_SHIFT} ACTIONS`));
  if (!finished) byId('actions-count').append(pips);
  const job = activeJob();
  const goal = job
    ? (state.jobs[job.id].status === 'loaded' ? `Deliver to ${NODES[job.to].name} by round ${job.deadline}.`
      : `Pick up ${job.cargo.toLowerCase()} at ${NODES[job.from].name}.`)
    : 'Claim a freight contract or plan your next route.';
  byId('shift-message').textContent = finished ? state.activity[0]?.message ?? 'Match complete.' : goal;
  byId('end-shift').hidden = !actions.canEnd;
}

function jobCard(job, actions) {
  const progress = state.jobs[job.id];
  const active = progress.owner === state.currentPlayer;
  const card = element('article', `job ${progress.status}`);
  const title = element('div', 'job-top');
  const cargo = element('div');
  cargo.append(element('h3', '', job.cargo), element('p', '', job.name));
  title.append(cargo, element('strong', 'job-pay', snrg(job.payment)));
  const route = element('div', 'job-route');
  route.append(
    button(NODES[job.from].short, '', '', () => inspect(job.from, true)),
    element('span', '', '→'),
    button(NODES[job.to].short, '', '', () => inspect(job.to, true)),
  );
  const bottom = element('div', 'job-bottom');
  let status = progress.status === 'open' ? `Due round ${job.deadline}`
    : progress.status === 'scheduled' ? `Opens ${job.opens} · Due ${job.deadline}`
    : progress.status === 'expired' || progress.status === 'delivered'
      ? jobStates[progress.status]
      : `${jobStates[progress.status]} · Due ${job.deadline}`;
  if (!active && progress.owner !== null) status += ` · ${state.players[progress.owner].name}`;
  bottom.append(element('small', '', status));
  if (actions.claimIds.includes(job.id)) {
    bottom.append(button('Claim job', 'button secondary', `claim-${job.id}`, () =>
      dispatch((game) => claimJob(game, job.id), { view: 'mine', destination: job.from, focus: `pickup-${job.id}` })));
  }
  if (actions.pickupIds.includes(job.id)) {
    bottom.append(button('Pick up', 'button primary', `pickup-${job.id}`, () =>
      dispatch((game) => pickupJob(game, job.id), { destination: job.to, focus: `map-${job.to}` })));
  }
  if (actions.deliverIds.includes(job.id)) {
    bottom.append(button('Deliver cargo', 'button primary', `deliver-${job.id}`, () =>
      dispatch((game) => deliverJob(game, job.id), { view: 'open', focus: 'filter-open' })));
  }
  card.append(title, route, bottom);
  if (active && ['claimed', 'loaded'].includes(progress.status)) {
    const target = progress.status === 'claimed' ? job.from : job.to;
    const current = state.players[state.currentPlayer].node;
    if (target !== current) {
      const hint = `${progress.status === 'claimed' ? 'Pickup' : 'Delivery'} · ${snrg(lowestFuel(current, target).cost)} minimum fuel from here`;
      card.append(element('p', 'job-instruction', hint));
    } else if (state.actionsRemaining === 0) {
      card.append(element('p', 'job-instruction', 'This stop is ready when you have an action.'));
    }
  }
  return card;
}

function renderJobs(actions) {
  const open = JOBS.filter(({ id }) => state.jobs[id].status === 'open');
  const mine = JOBS.filter(({ id }) => state.jobs[id].owner === state.currentPlayer && ['claimed', 'loaded'].includes(state.jobs[id].status));
  const visible = filter === 'mine' ? mine : filter === 'all' ? JOBS : open;
  byId('job-count').textContent = `${open.length} OPEN`;
  document.querySelectorAll('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.filter === filter)));
  const empty = filter === 'mine' ? 'You have no active cargo.' : 'No open contracts this round. Check the schedule for upcoming jobs.';
  byId('jobs').replaceChildren(...(visible.length ? visible.map((job) => jobCard(job, actions)) : [element('p', 'jobs-empty', empty)]));
}

function render() {
  const actions = getActions(state);
  renderFleets();
  renderShift(actions);
  renderMap(actions);
  renderRoutes(actions);
  renderJobs(actions);
  byId('activity').replaceChildren(...state.activity.map(({ message }) => element('li', '', message)));
}

const rules = element('ol');
rules.append(...[
  `Two players take turns on one device. Each fleet starts with ${snrg(START_BALANCE)} in practice funds and gets ${ACTIONS_PER_SHIFT} actions per shift.`,
  'Claim one open contract at a time from anywhere. A claimed contract is reserved for your fleet. Claiming is free.',
  'Drive along a connected road, pick up at the origin, and deliver at the destination. Each normally uses one action. Driving also costs fuel.',
  'Buy a Fuel Saver at West Depot or a Route Permit at East Depot to save fuel or an action.',
  `Deliver by the end of the contract’s deadline round to earn its payment. After ${ROUNDS} rounds, the fleet with the highest cash balance wins.`,
].map((rule) => element('li', '', rule)));
byId('rules-content').append(rules);

document.querySelectorAll('[data-filter]').forEach((item) => {
  item.id = `filter-${item.dataset.filter}`;
  item.addEventListener('click', () => {
    filter = item.dataset.filter;
    renderJobs(getActions(state));
  });
});
byId('end-shift').addEventListener('click', () => {
  const next = 1 - state.currentPlayer;
  const hasCargo = JOBS.some(({ id }) => state.jobs[id].owner === next && ['claimed', 'loaded'].includes(state.jobs[id].status)
    && (state.currentPlayer === 0 || JOBS.find((job) => job.id === id).deadline > state.round));
  const finalShift = state.round === ROUNDS && state.currentPlayer === 1;
  dispatch(endShift, { view: finalShift ? 'all' : hasCargo ? 'mine' : 'open', focus: finalShift ? 'new-game' : 'turn-title' });
});
byId('turn-title').tabIndex = -1;
byId('show-rules').addEventListener('click', () => byId('rules-dialog').showModal());
byId('show-network').addEventListener('click', () => byId('network-dialog').showModal());
byId('new-game').addEventListener('click', () => byId('new-dialog').showModal());
document.querySelectorAll('[data-close]').forEach((item) => item.addEventListener('click', () => item.closest('dialog').close()));
byId('new-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  dispatch(() => createGame([data.get('one'), data.get('two')]), { view: 'open' });
  byId('new-dialog').close();
  byId('turn-title').focus({ preventScroll: true });
});
byId('chain-id').textContent = SYNERGY_NETWORK.chainId;
byId('check-network').addEventListener('click', async (event) => {
  const trigger = event.currentTarget;
  trigger.disabled = true;
  byId('network-status').textContent = 'Checking…';
  const result = await checkSynergyNetwork();
  byId('network-status').textContent = result.message;
  document.querySelector('.network-dot').classList.toggle('verified', result.status === 'verified');
  trigger.disabled = false;
});

if (activeJob()) filter = 'mine';
if (state.phase === 'finished') filter = 'all';
render();
