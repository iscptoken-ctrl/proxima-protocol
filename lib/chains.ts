import { defineChain } from "viem";

export const bnbChain = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { decimals: 18, name: "BNB", symbol: "BNB" },
  rpcUrls: {
    // The official public BSC endpoints (bsc-dataseed.* and similar
    // "free, no signup" RPCs) either disable eth_getLogs entirely or
    // hang/reject on it - that's why event history (ticket lookups)
    // kept failing no matter how the request was chunked. Alchemy's
    // free tier reliably supports eth_getLogs for BNB Smart Chain.
    default: { http: ["https://bnb-mainnet.g.alchemy.com/v2/alch_ejOrXkdaP3iabIlFYspVT"] },
  },
  blockExplorers: {
    default: { name: "BscScan", url: "https://bscscan.com" },
  },
});
