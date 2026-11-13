export const SYNERGY_NETWORK = Object.freeze({
  name: 'Synergy Testnet v3',
  slug: 'synergy-testnet-v3',
  chainId: 1266,
  hexChainId: '0x4f2',
  currency: 'SNRG',
  decimals: 9,
  rpcUrl: 'https://testnet-core-rpc.synergy-network.io',
});

function readChainId(value) {
  if (typeof value === 'string' && /^(?:\d+|0x[\da-f]+)$/i.test(value)) {
    value = Number(value);
  }
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function checkSynergyNetwork({ fetcher = globalThis.fetch } = {}) {
  const id = 1;
  const unavailable = { status: 'unavailable', message: 'Testnet RPC unavailable.' };

  try {
    const response = await fetcher(SYNERGY_NETWORK.rpcUrl, {
      method: 'POST',
      // The endpoint accepts a JSON-RPC body with this CORS-safelisted content type.
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'synergy_getChainId', params: [] }),
      signal: AbortSignal.timeout(6000),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) return unavailable;

    const reply = await response.json();
    if (reply?.jsonrpc !== '2.0' || reply.id !== id || !Object.hasOwn(reply, 'result') || Object.hasOwn(reply, 'error')) {
      return unavailable;
    }

    const chainId = readChainId(reply.result);
    if (chainId === null) return unavailable;
    if (chainId !== SYNERGY_NETWORK.chainId) {
      return { status: 'wrong-chain', chainId, message: `RPC returned chain ${chainId}. Expected ${SYNERGY_NETWORK.chainId}.` };
    }

    return { status: 'verified', chainId, message: 'Testnet RPC verified chain 1266.' };
  } catch {
    return unavailable;
  }
}
