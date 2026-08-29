import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { bnbChain } from "./chains";

// NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be set in .env.local
// Get a free one at https://cloud.reown.com
export const wagmiConfig = getDefaultConfig({
  appName: "Proxima Protocol",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID as string,
  chains: [bnbChain],
  ssr: true,
});