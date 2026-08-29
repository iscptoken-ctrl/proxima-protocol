import { defineChain } from "viem";

export const bnbChain = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { decimals: 18, name: "BNB", symbol: "BNB" },
  rpcUrls: {
    // bsc-dataseed.binance.org has been unreliable for eth_getLogs
    // (event history) from browsers - publicnode's endpoint handles
    // it much more consistently for dapp use.
    default: { http: ["https://bsc-rpc.publicnode.com"] },
  },
  blockExplorers: {
    default: { name: "BscScan", url: "https://bscscan.com" },
  },
});
