export const PROXIMA_PROTOCOL_ADDRESS = "0xef798BDC88b3D34309b178959869bB5f01c0231b" as const;
export const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955" as const;
export const MAKER_WALLET = "0xD27c9C4C5539136C652063bF69945f61eCdE17f7" as const;

// Used only to read past event logs (ticket history) via the Etherscan
// V2 unified API (covers BSC via chainid=56) instead of raw eth_getLogs -
// free RPC tiers cap eth_getLogs to tiny block ranges (e.g. 10 blocks on
// Alchemy's free plan), which makes scanning from deployment impossible
// once more than a few thousand blocks have passed. Etherscan's API has
// no such range limit. This is a low-privilege, rate-limited free key -
// fine to ship client-side.
export const ETHERSCAN_API_KEY = "YMK7JC4FNPZHMGCEJUMWZA1NKRUJWTCMCD" as const;

export const TICKET_PRICE = 1n * 10n ** 18n; // 1 USDT
export const NUMBER_MIN = 1;
export const NUMBER_MAX = 10_000;
export const FOUNDER_SLOTS = 5;
export const FOUNDER_INITIAL_PRICE = 20n * 10n ** 18n; // $20
export const FOUNDER_FORCE_BUY_INCREMENT = 10n * 10n ** 18n; // $10

export const erc20Abi = [
  {a
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const proximaProtocolAbi = [
  // --- playing ---
  {
    type: "function",
    name: "buyTicket",
    stateMutability: "nonpayable",
    inputs: [{ name: "number", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "buyRandomTickets",
    stateMutability: "nonpayable",
    inputs: [{ name: "count", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveRound",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "numbers", type: "uint256[]" },
    ],
    outputs: [],
  },

  // --- founders ---
  {
    type: "function",
    name: "claimFounderSlot",
    stateMutability: "nonpayable",
    inputs: [{ name: "slotIndex", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "forceBuyFounderSlot",
    stateMutability: "nonpayable",
    inputs: [{ name: "slotIndex", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimFounderDividend",
    stateMutability: "nonpayable",
    inputs: [{ name: "slotIndex", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "allFounderSlots",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "owners", type: "address[5]" },
      { name: "prices", type: "uint256[5]" },
      { name: "dividends", type: "uint256[5]" },
    ],
  },

  // --- maker (pull-only) ---
  {
    type: "function",
    name: "withdrawMaker",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "makerAccrued",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MAKER_WALLET",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },

  // --- pools ---
  {
    type: "function",
    name: "jackpotPool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "nearPool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "nearCarryPool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "reservePool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },

  // --- round state ---
  {
    type: "function",
    name: "currentRound",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "timeUntilNextDraw",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "lastTenWinningNumbers",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "rounds",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "resolved", type: "bool" },
      { name: "winningNumber", type: "uint256" },
      { name: "totalTickets", type: "uint256" },
      { name: "jackpotAtDraw", type: "uint256" },
      { name: "jackpotWinners", type: "uint256" },
      { name: "ranksFound", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "roundRanks",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [
      { name: "ranksFound", type: "uint256" },
      { name: "lowNumber", type: "uint256[3]" },
      { name: "highNumber", type: "uint256[3]" },
      { name: "lowCount", type: "uint256[3]" },
      { name: "highCount", type: "uint256[3]" },
      { name: "budget", type: "uint256[3]" },
    ],
  },
  {
    type: "function",
    name: "userNumberTickets",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
      { name: "", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimedNumber",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
      { name: "", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },

  // --- info text, on-chain ---
  {
    type: "function",
    name: "manifesto",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "howToPlay",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "community",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ type: "string" }],
  },

  // --- ownership (renounced post-deploy; kept for the transparency check) ---
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },

  // --- events ---
  {
    type: "event",
    name: "TicketBought",
    inputs: [
      { name: "round", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "number", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RandomTicketsBought",
    inputs: [
      { name: "round", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "numbers", type: "uint256[]", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RoundResolved",
    inputs: [
      { name: "round", type: "uint256", indexed: true },
      { name: "winningNumber", type: "uint256", indexed: false },
      { name: "jackpotAtDraw", type: "uint256", indexed: false },
      { name: "totalTickets", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "round", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FounderSlotClaimed",
    inputs: [
      { name: "slot", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FounderSlotForceBought",
    inputs: [
      { name: "slot", type: "uint256", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
      { name: "prevOwner", type: "address", indexed: true },
      { name: "newPrice", type: "uint256", indexed: false },
      { name: "paidToPrevOwner", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FounderDividendClaimed",
    inputs: [
      { name: "slot", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;
