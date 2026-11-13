import { JOBS, claimJob, deliverJob, endShift, getActions, move, pickupJob } from './game.mjs';

const OPPONENT = 1;

function routeOrder(first, second) {
  return first.fuel - second.fuel
    || first.state.round - second.state.round
    || second.state.actionsRemaining - first.state.actionsRemaining
    || first.steps.length - second.steps.length;
}

function routeKey(state, jobId) {
  const player = state.players[OPPONENT];
  return [state.round, state.actionsRemaining, player.node, player.expressUsed, state.jobs[jobId].status].join('/');
}

function planDelivery(start, job) {
  const queue = [{ state: start, fuel: 0, steps: [] }];
  const seen = new Set();

  while (queue.length) {
    queue.sort(routeOrder);
    const { state, fuel, steps } = queue.shift();
    const key = routeKey(state, job.id);
    if (seen.has(key)) continue;
    seen.add(key);
    const options = getActions(state);

    if (options.deliverIds.includes(job.id)) {
      const profit = job.payment - fuel;
      const effort = steps.length + 1 + (state.round - start.round);
      return { profit, score: profit / effort, steps: [...steps, [deliverJob, job.id]] };
    }
    if (options.pickupIds.includes(job.id)) {
      queue.push({ state: pickupJob(state, job.id), fuel, steps: [...steps, [pickupJob, job.id]] });
      continue;
    }
    for (const route of options.routes) {
      queue.push({
        state: move(state, route.id),
        fuel: fuel + route.cost,
        steps: [...steps, [move, route.id]],
      });
    }
    if (state.round < job.deadline) {
      // Forecast the next opponent shift with the human seat passing.
      queue.push({ state: endShift(endShift(state)), fuel, steps: [...steps, [endShift]] });
    }
  }
  return null;
}

function chooseDelivery(state) {
  const active = JOBS.find(({ id }) => state.jobs[id].owner === OPPONENT
    && ['claimed', 'loaded'].includes(state.jobs[id].status));
  if (active) {
    const plan = planDelivery(state, active);
    return plan?.profit > 0 ? { state, plan } : null;
  }

  const { claimIds } = getActions(state);
  let best = null;
  for (const job of JOBS) {
    if (!claimIds.includes(job.id)) continue;
    const claimed = claimJob(state, job.id);
    const plan = planDelivery(claimed, job);
    if (plan?.profit > 0 && (!best || plan.score > best.plan.score)) {
      best = { state: claimed, plan };
    }
  }
  return best;
}

export function playOpponentShift(state) {
  if (state.phase !== 'playing' || state.currentPlayer !== OPPONENT) return state;

  let current = state;
  let delivery = chooseDelivery(current);
  while (delivery) {
    current = delivery.state;
    for (const [action, id] of delivery.plan.steps) {
      if (action === endShift) return endShift(current);
      current = action(current, id);
    }
    delivery = chooseDelivery(current);
  }
  return endShift(current);
}
