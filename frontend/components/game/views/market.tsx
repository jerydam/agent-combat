'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { api } from '@/lib/api';
import { writeContract } from '@/lib/tx';
import { getWBotPrice, usdToBotWei } from '@/lib/getWBotPrice';
import { AVATARS } from '@/lib/avatars';
import type { Agent } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ShoppingBag, Star, Zap, FlaskConical, Shirt, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { Abi, Address } from 'viem';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const SHOP_ADDRESS = (process.env.NEXT_PUBLIC_SHOP ?? '') as Address;
const SHOP_ABI = [
  {
    name: 'purchase', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'itemId', type: 'string' }, { name: 'agentId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'priceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'string' }],
    outputs: [{ name: '', type: 'uint128' }],
  },
] as const satisfies Abi;

interface Item {
  id: string; kind: 'skin' | 'boost' | 'power'; name: string; desc: string;
  point_price: number; usd_price: number; bot_price_wei: string;
  boost: number[] | null; power: Record<string, number> | null;
}

const fmtBot = (wei: bigint) => {
  const n = Number(wei / BigInt(1e12)) / 1e6;
  return n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4);
};
interface InvRow { id: number; item_id: string; source: string; consumed: boolean }

const KIND_ICON = { skin: Shirt, boost: FlaskConical, power: Zap } as const;

export function MarketView() {
  const { address, connected, connect, signMessage } = useWallet();
  const [tab, setTab] = useState<'skin' | 'boost' | 'power'>('skin');
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [inv, setInv] = useState<InvRow[]>([]);
  const [points, setPoints] = useState(0);
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [targetAgent, setTargetAgent] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [botUsd, setBotUsd] = useState<number | null>(null);

  // Confirmed on-chain price per item, read straight from Shop.priceOf.
  // Absence of a key = not yet loaded; 0n = confirmed not-for-sale.
  const [onchainPrices, setOnchainPrices] = useState<Record<string, bigint>>({});

  // Live WBOT/USD from BDEX reserves; used only for the informational
  // "$ value" label — never as the actual amount sent on-chain.
  useEffect(() => {
    let live = true;
    getWBotPrice().then((p) => live && setBotUsd(p)).catch(() => {});
    const t = setInterval(() => getWBotPrice().then((p) => live && setBotUsd(p)).catch(() => {}), 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  // Estimated BOT cost for display purposes only (used before on-chain
  // prices have loaded, or as the USD-equivalent reference). Never used
  // to build a transaction.
  const estimatedBotWei = useCallback((item: Item): bigint => {
    if (botUsd !== null) return usdToBotWei(item.point_price / 1000, botUsd);
    return BigInt(item.bot_price_wei ?? '0');
  }, [botUsd]);

  const refresh = useCallback(async () => {
    const cat = await fetch(`${API}/market/catalog`).then((r) => r.json());
    const items: Item[] = Array.isArray(cat) ? cat : cat.items;
    setCatalog(items);
    if (address) {
      const i = await fetch(`${API}/market/inventory/${address}`).then((r) => r.json());
      setInv(i.items);
      setPoints(i.points);
      setMyAgents(await api.agents(address));
    }
  }, [address]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  // Load confirmed on-chain prices for the whole catalog whenever it
  // changes. This is what actually gates the BOT buy button — items with
  // no price set on Shop never get an active button, regardless of what
  // the backend/estimate thinks they should cost.
  useEffect(() => {
    if (!SHOP_ADDRESS || catalog.length === 0) return;
    let live = true;

    (async () => {
      const { getPublicClient } = await import('@/lib/chain');
      const client = getPublicClient();
      const contracts = catalog.map((item) => ({
        address: SHOP_ADDRESS, abi: SHOP_ABI, functionName: 'priceOf' as const, args: [item.id] as const,
      }));

      try {
        // Prefer multicall — one RPC round trip for the whole catalog.
        const results = await client.multicall({ contracts, allowFailure: true });
        if (!live) return;
        const next: Record<string, bigint> = {};
        results.forEach((r, i) => {
          next[catalog[i].id] = r.status === 'success' ? (r.result as bigint) : BigInt(0);
        });
        setOnchainPrices(next);
      } catch {
        // No multicall3 on this chain, or it's not configured in the
        // client — fall back to individual reads.
        const entries = await Promise.all(catalog.map(async (item) => {
          try {
            const p = await client.readContract({
              address: SHOP_ADDRESS, abi: SHOP_ABI, functionName: 'priceOf', args: [item.id],
            }) as bigint;
            return [item.id, p] as const;
          } catch {
            return [item.id, BigInt(0)] as const;
          }
        }));
        if (!live) return;
        setOnchainPrices(Object.fromEntries(entries));
      }
    })();

    return () => { live = false; };
  }, [catalog]);

  const owned = (itemId: string) => inv.some((r) => r.item_id === itemId && !r.consumed);
  const unusedBoost = (itemId: string) => inv.find((r) => r.item_id === itemId && !r.consumed);

  /** true only once we've confirmed on-chain that this item has a price > 0. */
  const forSaleOnchain = (itemId: string) => (onchainPrices[itemId] ?? BigInt(0)) > BigInt(0);
  const priceLoaded = (itemId: string) => itemId in onchainPrices;

  async function redeem(item: Item) {
    setBusy(`redeem-${item.id}`);
    try {
      const signature = await signMessage(`agent-arena:market:redeem:${item.id}`);
      const r = await fetch(`${API}/market/redeem`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, item_id: item.id, signature }),
      });
      if (!r.ok) throw new Error((await r.json()).detail);
      toast.success(`${item.name} redeemed!`);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? 'Redeem failed');
    } finally { setBusy(null); }
  }

  async function buyWithBot(item: Item) {
    if (!SHOP_ADDRESS) return toast.error('Shop contract not configured');
    if (!forSaleOnchain(item.id)) {
      return toast.error(`${item.name} isn't listed for BOT purchase yet`);
    }
    setBusy(`buy-${item.id}`);
    try {
      const { getPublicClient } = await import('@/lib/chain');
      const client = getPublicClient();
      // Re-read right before sending: the cached price could be a few
      // minutes stale (catalog effect) and setPrice can change anytime.
      const price = await client.readContract({
        address: SHOP_ADDRESS, abi: SHOP_ABI, functionName: 'priceOf', args: [item.id],
      }) as bigint;

      if (price <= BigInt(0)) {
        setOnchainPrices((p) => ({ ...p, [item.id]: BigInt(0) }));
        throw new Error(`${item.name} isn't for sale with BOT yet`);
      }

      await writeContract({
        address: SHOP_ADDRESS, abi: SHOP_ABI as any, functionName: 'purchase',
        args: [item.id, BigInt(targetAgent || 0)], value: price, account: address as Address,
      });

      setOnchainPrices((p) => ({ ...p, [item.id]: price }));
      toast.success(`${item.name} purchased — granted in a few seconds`);
      setTimeout(() => refresh().catch(() => {}), 4000);
    } catch (e: any) {
      toast.error(e?.shortMessage ?? e?.message ?? 'Purchase failed');
    } finally { setBusy(null); }
  }

  async function equip(item: Item) {
    if (!targetAgent) return toast.error('Pick an agent first');
    setBusy(`equip-${item.id}`);
    try {
      const signature = await signMessage(`agent-arena:market:equip:${targetAgent}:${item.id}`);
      const r = await fetch(`${API}/market/equip`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, token_id: Number(targetAgent), item_id: item.id, signature }),
      });
      if (!r.ok) throw new Error((await r.json()).detail);
      toast.success(`${item.name} equipped on agent #${targetAgent}`);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? 'Equip failed');
    } finally { setBusy(null); }
  }

  async function applyBoost(item: Item) {
    if (!targetAgent) return toast.error('Pick an agent first');
    const row = unusedBoost(item.id);
    if (!row) return;
    setBusy(`apply-${item.id}`);
    try {
      const signature = await signMessage(`agent-arena:market:boost:${row.id}:${targetAgent}`);
      const r = await fetch(`${API}/market/apply-boost`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, token_id: Number(targetAgent), inventory_id: row.id, signature }),
      });
      if (!r.ok) throw new Error((await r.json()).detail);
      toast.success(`${item.name} applied on-chain to agent #${targetAgent}!`);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? 'Boost failed');
    } finally { setBusy(null); }
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <ShoppingBag className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Connect your wallet to browse the market.</p>
        <Button onClick={connect} className="font-display tracking-wider">CONNECT WALLET</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-steel">MARKET</h1>
          <div className="split-line mt-2 w-32" />
          <p className="mt-2 text-sm text-muted-foreground">
            Pay with points or BOT — 1,000 pts = $1 of BOT, same value either way.
            Boosts write stats on-chain; skins and powers equip per agent.
          </p>
          {botUsd !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              Live rate: 1 BOT ≈ ${botUsd.toFixed(2)} · 1,000 pts ≈ {(1 / botUsd).toFixed(4)} BOT
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="split-ring rounded-lg px-3 py-1.5 font-display text-xl font-bold text-warning">
            <Star className="mb-0.5 mr-1 inline h-4 w-4" />{points.toLocaleString()} pts
          </div>
          <Select value={targetAgent} onValueChange={setTargetAgent}>
            <SelectTrigger className="w-44 bg-background/60"><SelectValue placeholder="Target agent" /></SelectTrigger>
            <SelectContent>
              {myAgents.map((a) => (
                <SelectItem key={a.token_id} value={String(a.token_id)}>{a.name} (#{a.token_id})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-2">
        {(['skin', 'boost', 'power'] as const).map((k) => {
          const Icon = KIND_ICON[k];
          return (
            <button key={k} onClick={() => setTab(k)}
              className={cn('flex items-center gap-1.5 rounded-lg border px-4 py-2 font-display text-sm uppercase tracking-wider',
                tab === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
              <Icon className="h-4 w-4" /> {k === 'skin' ? 'Avatars' : k === 'boost' ? 'Boosts' : 'Powers'}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.filter((i) => i.kind === tab).map((item) => {
          const has = owned(item.id);
          const boostRow = item.kind === 'boost' ? unusedBoost(item.id) : undefined;
          const loaded = priceLoaded(item.id);
          const forSale = forSaleOnchain(item.id);
          const displayPrice = forSale ? onchainPrices[item.id] : estimatedBotWei(item);

          return (
            <div key={item.id} className={cn('rounded-xl border bg-card/50 p-4', has ? 'border-primary/40' : 'border-border')}>
              <div className="flex items-start gap-3">
                {item.kind === 'skin' && AVATARS[item.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={AVATARS[item.id].src} alt={item.name} className="h-16 w-16 rounded-xl" draggable={false} />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-border bg-background/40 text-2xl">
                    {item.kind === 'boost' ? '🧪' : '⚡'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-display font-bold">
                    {item.name}{has && <Check className="h-4 w-4 text-primary" />}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.desc}</p>
                  <p className="mt-1 text-xs font-semibold">
                    <span className="text-warning">{item.point_price.toLocaleString()} pts</span>
                    <span className="mx-1 text-muted-foreground">·</span>
                    {loaded && !forSale ? (
                      <span className="text-muted-foreground italic">not for sale with BOT</span>
                    ) : (
                      <>
                        <span className={cn(forSale ? 'text-primary' : 'text-muted-foreground italic')}>
                          {fmtBot(displayPrice)} BOT
                        </span>
                        <span className="ml-1 text-muted-foreground">(${item.usd_price?.toFixed(2)})</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                {!has && (
                  <>
                    <Button size="sm" disabled={!!busy || points < item.point_price} onClick={() => redeem(item)} className="flex-1">
                      {busy === `redeem-${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Redeem'}
                    </Button>
                    <Button
                      size="sm" variant="outline" className="flex-1"
                      disabled={!!busy || !loaded || !forSale}
                      title={loaded && !forSale ? 'Not listed on Shop yet' : undefined}
                      onClick={() => buyWithBot(item)}
                    >
                      {busy === `buy-${item.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : !loaded ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : forSale ? (
                        `${fmtBot(onchainPrices[item.id])} BOT`
                      ) : (
                        'Not for sale'
                      )}
                    </Button>
                  </>
                )}
                {has && item.kind !== 'boost' && (
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => equip(item)} className="flex-1">
                    {busy === `equip-${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Equip${targetAgent ? ` on #${targetAgent}` : ''}`}
                  </Button>
                )}
                {boostRow && (
                  <Button size="sm" disabled={!!busy} onClick={() => applyBoost(item)} className="flex-1">
                    {busy === `apply-${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply on-chain'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}