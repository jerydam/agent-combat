// lib/getWBotPrice.ts
// Live WBOT/USD spot price from the BDEX V2 pair reserves.
// Ported to viem (this project has no ethers dependency).
import { createPublicClient, formatUnits, http, zeroAddress, type Address } from 'viem';

// From the docs
const BDEX_V2_FACTORY: Address = '0x117115f3B72C8d1989178089A67D0C26f8EE0AA3';
const WBOT_ADDRESS: Address    = '0xD5452816194a3784dBa983426cCe7c122F4abd30';
// Same RPC the rest of the app uses unless explicitly overridden —
// a wrong/dead RPC here would silently pin the price to the fallback.
const BOTCHAIN_RPC =
  process.env.NEXT_PUBLIC_BOTCHAIN_RPC_URL ??
  process.env.NEXT_PUBLIC_RPC_URL ??
  'https://rpc.botchain.ai';

// Confirm on scan.botchain.ai — "Common Tokens (Mainnet)"
const STABLE_ADDRESS: Address = '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C'; // USDT/USDC
const STABLE_DECIMALS = 6;
const WBOT_DECIMALS = 18;
export const WBOT_FALLBACK_PRICE_USD = 9.7;

const FACTORY_ABI = [
  { name: 'getPair', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }],
    outputs: [{ name: 'pair', type: 'address' }] },
] as const;

const PAIR_ABI = [
  { name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ] },
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'address' }] },
] as const;

// ── In-memory cache ──────────────────────────────────────────────────────────
let cached: { price: number; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 60 seconds

let client: ReturnType<typeof createPublicClient> | null = null;
function rpc() {
  if (!client) client = createPublicClient({ transport: http(BOTCHAIN_RPC) });
  return client;
}

export async function getWBotPrice(): Promise<number> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    // 1. Resolve pair address from factory
    const pairAddress = await rpc().readContract({
      address: BDEX_V2_FACTORY, abi: FACTORY_ABI,
      functionName: 'getPair', args: [WBOT_ADDRESS, STABLE_ADDRESS],
    });

    if (!pairAddress || pairAddress === zeroAddress) {
      console.warn('[getWBotPrice] Pair not found on BDEX V2, using fallback');
      return WBOT_FALLBACK_PRICE_USD;
    }

    // 2. Read reserves
    const [reserves, token0] = await Promise.all([
      rpc().readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'getReserves' }),
      rpc().readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token0' }),
    ]);

    const isWBotToken0  = token0.toLowerCase() === WBOT_ADDRESS.toLowerCase();
    const reserveWBOT   = isWBotToken0 ? reserves[0] : reserves[1];
    const reserveStable = isWBotToken0 ? reserves[1] : reserves[0];

    // 3. Compute spot price
    const wbotNorm   = parseFloat(formatUnits(reserveWBOT, WBOT_DECIMALS));
    const stableNorm = parseFloat(formatUnits(reserveStable, STABLE_DECIMALS));

    if (wbotNorm === 0) throw new Error('Zero WBOT reserve');

    const price = stableNorm / wbotNorm;

    // Sanity check — reject obviously bad prices
    if (price <= 0 || price > 100_000) throw new Error(`Suspicious price: ${price}`);

    cached = { price, fetchedAt: Date.now() };
    return price;
  } catch (err) {
    console.error('[getWBotPrice] Failed, using fallback:', err);
    // Return stale cache if available, otherwise hardcoded fallback
    return cached?.price ?? WBOT_FALLBACK_PRICE_USD;
  }
}

/** BOT wei for a USD amount at the live price: 1000 pts = $1 of BOT. */
export function usdToBotWei(usd: number, botUsdPrice: number): bigint {
  if (botUsdPrice <= 0) return BigInt(0);
  // 6-decimal precision on the BOT amount, then scale to wei
  return BigInt(Math.round((usd / botUsdPrice) * 1e6)) * BigInt(1e12);
}
