import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSynergyNetwork, SYNERGY_NETWORK } from '../dist/synergy.mjs';

function rpcResponse(result) {
  return { jsonrpc: '2.0', id: 1, result };
}

function fetchResponse(reply) {
  return async () => ({ ok: true, json: async () => reply });
}

test('requests only the chain ID using a CORS-safelisted request', async () => {
  const status = await checkSynergyNetwork({
    fetcher: async (url, options) => {
      assert.equal(url, SYNERGY_NETWORK.rpcUrl);
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['Content-Type'], 'text/plain;charset=UTF-8');
      assert.equal(options.credentials, 'omit');
      assert.deepEqual(JSON.parse(options.body), {
        jsonrpc: '2.0', id: 1, method: 'synergy_getChainId', params: [],
      });
      return fetchResponse(rpcResponse('0x4f2'))();
    },
  });

  assert.equal(status.status, 'verified');
  assert.equal(status.chainId, 1266);
});

test('separates a verified wrong chain from an unavailable response', async () => {
  const wrongChain = await checkSynergyNetwork({ fetcher: fetchResponse(rpcResponse(3)) });
  assert.equal(wrongChain.status, 'wrong-chain');
  assert.equal(wrongChain.chainId, 3);

  const invalidReplies = [
    { ...rpcResponse(1266), id: 2 },
    { ...rpcResponse(1266), error: { code: -32001 } },
    rpcResponse('1266.0'),
    rpcResponse({ chainId: 1266 }),
    null,
  ];
  for (const reply of invalidReplies) {
    const unavailable = await checkSynergyNetwork({ fetcher: fetchResponse(reply) });
    assert.equal(unavailable.status, 'unavailable');
  }
});

test('handles network failures and non-successful HTTP responses', async () => {
  const offline = await checkSynergyNetwork({ fetcher: async () => { throw new Error('offline'); } });
  const failure = await checkSynergyNetwork({ fetcher: async () => ({ ok: false }) });
  assert.equal(offline.status, 'unavailable');
  assert.equal(failure.status, 'unavailable');
});
