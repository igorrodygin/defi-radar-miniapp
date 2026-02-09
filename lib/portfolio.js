const { z } = require("zod");
const { get, set } = require("./cache");
const { ethers } = require("ethers");
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");

const supportedChains = ["evm", "btc", "sol", "ton"];

const portfolioQuerySchema = z.object({
  chain: z.enum(["evm", "btc", "sol", "ton"]),
  address: z.string().min(4)
});

// Public endpoints (no key) — MVP-friendly.
const ETH_RPC = process.env.ETH_RPC_URL || "https://cloudflare-eth.com";
const SOL_RPC = process.env.SOL_RPC_URL || "https://api.mainnet-beta.solana.com";

// TON Center API v2 (optional API key). Without a key, TON Center limits requests to ~1 rps.
const TONCENTER_BASE_URL = process.env.TONCENTER_BASE_URL || "https://toncenter.com/api/v2";
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || "";

function maskAddress(addr) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

async function getPricesUsd() {
  const cacheKey = "prices_usd";
  const cached = get(cacheKey);
  if (cached) return cached;

  const url = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,solana,the-open-network,toncoin&vs_currencies=usd";
  const resp = await fetch(url, { headers: { "accept": "application/json" } });
  if (!resp.ok) throw new Error("Price provider error");
  const data = await resp.json();

  const prices = {
    ETH: data?.ethereum?.usd ?? null,
    BTC: data?.bitcoin?.usd ?? null,
    SOL: data?.solana?.usd ?? null,
    // CoinGecko sometimes uses id "the-open-network" for Toncoin; keep fallback to "toncoin"
    TON: (data?.["the-open-network"]?.usd ?? data?.toncoin?.usd) ?? null
  };

  set(cacheKey, prices, 60_000);
  return prices;
}

async function getEvmEthBalance(address) {
  const provider = new ethers.JsonRpcProvider(ETH_RPC);
  const balWei = await provider.getBalance(address);
  const eth = Number(ethers.formatEther(balWei));
  return eth;
}

async function getBtcBalance(address) {
  // Blockstream API (no key): returns sats stats
  const url = `https://blockstream.info/api/address/${encodeURIComponent(address)}`;
  const resp = await fetch(url, { headers: { "accept": "application/json" } });
  if (!resp.ok) throw new Error("BTC provider error");
  const data = await resp.json();
  const funded = Number(data?.chain_stats?.funded_txo_sum ?? 0);
  const spent = Number(data?.chain_stats?.spent_txo_sum ?? 0);
  const sats = funded - spent;
  return sats / 1e8;
}

async function getSolBalance(address) {
  const conn = new Connection(SOL_RPC, "confirmed");
  const pub = new PublicKey(address);
  const lamports = await conn.getBalance(pub);
  return lamports / LAMPORTS_PER_SOL;
}

function nanoTonToTonNumber(nanoStr) {
  // nanoStr is a string representing nanotons (1 TON = 1e9 nanotons).
  const s = String(nanoStr || "0").replace(/^0+/, "") || "0";
  if (s.length <= 9) {
    const frac = s.padStart(9, "0");
    return Number(`0.${frac}`);
  }
  const whole = s.slice(0, -9);
  let frac = s.slice(-9);
  frac = frac.replace(/0+$/, "");
  return Number(frac ? `${whole}.${frac}` : whole);
}

async function getTonBalance(address) {
  const url = `${TONCENTER_BASE_URL}/getAddressBalance?address=${encodeURIComponent(address)}`;
  const headers = { "accept": "application/json" };
  if (TONCENTER_API_KEY) headers["X-API-Key"] = TONCENTER_API_KEY;

  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error("TON provider error");
  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || "TON provider error");
  return nanoTonToTonNumber(data.result);
}

function sumFiat(assets) {
  return assets.reduce((acc, a) => acc + (a.fiat ?? 0), 0);
}

async function buildPortfolio({ chain, address }) {
  if (!supportedChains.includes(chain)) {
    throw new Error("Unsupported chain");
  }

  const prices = await getPricesUsd();
  const updatedAt = new Date().toISOString();

  if (chain === "evm") {
    const eth = await getEvmEthBalance(address);
    const fiat = prices.ETH ? eth * prices.ETH : null;
    const assets = [
      { symbol: "ETH", amount: eth, fiat }
    ];
    return {
      chain,
      addressMasked: maskAddress(address),
      totalFiat: fiat ?? null,
      updatedAt,
      assets
    };
  }

  if (chain === "btc") {
    const btc = await getBtcBalance(address);
    const fiat = prices.BTC ? btc * prices.BTC : null;
    const assets = [
      { symbol: "BTC", amount: btc, fiat }
    ];
    return {
      chain,
      addressMasked: maskAddress(address),
      totalFiat: fiat ?? null,
      updatedAt,
      assets
    };
  }

  if (chain === "sol") {
    const sol = await getSolBalance(address);
    const fiat = prices.SOL ? sol * prices.SOL : null;
    const assets = [
      { symbol: "SOL", amount: sol, fiat }
    ];
    return {
      chain,
      addressMasked: maskAddress(address),
      totalFiat: fiat ?? null,
      updatedAt,
      assets
    };
  }

  throw new Error("Unsupported chain");
}

module.exports = { portfolioQuerySchema, buildPortfolio, maskAddress, getPricesUsd };
