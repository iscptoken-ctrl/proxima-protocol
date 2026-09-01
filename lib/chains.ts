import { defineChain } from "viem";

export const bnbChain = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { decimals: 18, name: "BNB", symbol: "BNB" },
  rpcUrls: {
    // NodeReal's MegaNode - the BNB Chain team's own recommended free
    // replacement for the now-shut-down BscScan API / most free-tier
    // RPCs' crippling eth_getLogs range caps (e.g. Alchemy free tier
    // caps at 10 blocks per call, unusable once any real time has
    // passed since deployment).
    default: { http: ["https://bsc-mainnet.nodereal.io/v1/e2f904bfa775463e9d05364f610074f8"] },
  },
  blockExplorers: {
    default: { name: "BscScan", url: "https://bscscan.com" },
  },
});
