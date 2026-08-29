import { defineChain } from "viem";

export const bnbChain = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { decimals: 18, name: "BNB", symbol: "BNB" },
  rpcUrls: {
    // The official public BSC endpoints (bsc-dataseed.* and similar)
    // intentionally disable eth_getLogs entirely - that's why event
    // history (ticket lookups) kept failing no matter how the request
    // was chunked. Ankr's public endpoint supports eth_getLogs.
    default: { http: ["https://1rpc.io/bnb"] },
  },
  blockExplorers: {
    default: { name: "BscScan", url: "https://bscscan.com" },
  },
});
