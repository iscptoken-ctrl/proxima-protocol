"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { readContract, waitForTransactionReceipt } from "@wagmi/core";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/lib/wagmi";
import {
  PROXIMA_PROTOCOL_ADDRESS,
  USDT_ADDRESS,
  MAKER_WALLET,
  TICKET_PRICE,
  FOUNDER_SLOTS,
  FOUNDER_INITIAL_PRICE,
  FOUNDER_FORCE_BUY_INCREMENT,
  erc20Abi,
  proximaProtocolAbi,
} from "@/lib/contract";

const fmt = (v?: bigint) =>
  v === undefined ? "..." : (Number(v) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 2 });

// Approve a generous multiple so the user doesn't need to re-approve every purchase.
const APPROVE_AMOUNT = TICKET_PRICE * 5000n;

// TODO: replace with the actual block ProximaProtocol was deployed in
// (look it up on the contract's BscScan page - "at txn" on the creation
// transaction - and paste the block number here). Without this, event
// scans start from block 0 and can fail or time out on public RPCs that
// cap eth_getLogs block ranges.
const DEPLOY_BLOCK = 118665381n;

type RoundInfo = {
  startTime: bigint;
  endTime: bigint;
  resolved: boolean;
  winningNumber: bigint;
  totalTickets: bigint;
  jackpotAtDraw: bigint;
  jackpotWinners: bigint;
  ranksFound: bigint;
};

function parseRoundInfo(info: any): RoundInfo {
  return {
    startTime: info[0] as bigint,
    endTime: info[1] as bigint,
    resolved: info[2] as boolean,
    winningNumber: info[3] as bigint,
    totalTickets: info[4] as bigint,
    jackpotAtDraw: info[5] as bigint,
    jackpotWinners: info[6] as bigint,
    ranksFound: info[7] as bigint,
  };
}

type RoundRanks = {
  ranksFound: bigint;
  lowNumber: readonly [bigint, bigint, bigint];
  highNumber: readonly [bigint, bigint, bigint];
  lowCount: readonly [bigint, bigint, bigint];
  highCount: readonly [bigint, bigint, bigint];
  budget: readonly [bigint, bigint, bigint];
};

function parseRoundRanks(r: any): RoundRanks {
  return {
    ranksFound: r[0] as bigint,
    lowNumber: r[1],
    highNumber: r[2],
    lowCount: r[3],
    highCount: r[4],
    budget: r[5],
  };
}

// Mirrors the contract's own eligibility logic exactly, so the UI never
// offers a "Claim" button for a ticket that would actually revert.
function ticketOutcome(
  number: bigint,
  info: RoundInfo,
  ranks: RoundRanks | null
): { status: "win" | "lost"; pool: bigint; count: bigint; label: string } {
  if (number === info.winningNumber && info.jackpotWinners > 0n) {
    return { status: "win", pool: info.jackpotAtDraw, count: info.jackpotWinners, label: "Jackpot" };
  }
  if (ranks) {
    for (let k = 0; k < Number(ranks.ranksFound); k++) {
      if (number === ranks.lowNumber[k] || number === ranks.highNumber[k]) {
        const count = ranks.lowCount[k] + ranks.highCount[k];
        return { status: "win", pool: ranks.budget[k], count, label: `Rank ${k + 1}` };
      }
    }
  }
  return { status: "lost", pool: 0n, count: 0n, label: "" };
}

type TicketRow = { number: bigint; status: "win" | "lost" | "claimed"; estAmount: bigint; label: string };
type MyRound = {
  round: bigint;
  resolved: boolean;
  winningNumber?: bigint;
  tickets: TicketRow[];
  claimableNumbers: bigint[];
};

type HistoryRound = {
  round: bigint;
  info: RoundInfo;
  ranks: RoundRanks;
};

type FounderSlotUI = { owner: `0x${string}`; price: bigint; dividend: bigint };

export default function ProximaProtocolApp() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [mode, setMode] = useState<"manual" | "random">("manual");
  const [number, setNumber] = useState("");
  const [count, setCount] = useState("1");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [claimRound, setClaimRound] = useState("");
  const [claimNumbers, setClaimNumbers] = useState("");

  const [myTickets, setMyTickets] = useState<MyRound[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [roundHistory, setRoundHistory] = useState<HistoryRound[]>([]);
  const [loadingRoundHistory, setLoadingRoundHistory] = useState(false);

  const [makerAccrued, setMakerAccrued] = useState<bigint | null>(null);
  const [founders, setFounders] = useState<FounderSlotUI[]>([]);
  const [loadingFounders, setLoadingFounders] = useState(false);

  const contractBase = { address: PROXIMA_PROTOCOL_ADDRESS, abi: proximaProtocolAbi } as const;
  const isMaker = !!address && address.toLowerCase() === MAKER_WALLET.toLowerCase();

  const { data: jackpot, refetch: refetchJackpot } = useReadContract({ ...contractBase, functionName: "jackpotPool" });
  const { data: nearPool, refetch: refetchNearPool } = useReadContract({ ...contractBase, functionName: "nearPool" });
  const { data: nearCarryPool } = useReadContract({ ...contractBase, functionName: "nearCarryPool" });
  const { data: reserve } = useReadContract({ ...contractBase, functionName: "reservePool" });
  const { data: currentRound, refetch: refetchRound } = useReadContract({ ...contractBase, functionName: "currentRound" });
  const { data: timeLeft, refetch: refetchTime } = useReadContract({ ...contractBase, functionName: "timeUntilNextDraw" });
  const { data: lastWinners } = useReadContract({ ...contractBase, functionName: "lastTenWinningNumbers" });

  // Poll the countdown every 15s
  useEffect(() => {
    const id = setInterval(() => refetchTime(), 15000);
    return () => clearInterval(id);
  }, [refetchTime]);

  const mins = timeLeft ? Math.floor(Number(timeLeft) / 60) : 0;
  const secs = timeLeft ? Number(timeLeft) % 60 : 0;

  // ---------------------------------------------------------------------
  // My tickets (per-user history, with correct win/lose detection)
  // ---------------------------------------------------------------------
  //
  // Free-tier RPC eth_getLogs is capped to tiny block ranges on some
  // providers (e.g. 10 blocks on Alchemy's free plan) and BscScan's old
  // free log-search API was shut down in Dec 2025. NodeReal's MegaNode
  // (the BNB Chain team's own recommended replacement) is used here via
  // plain eth_getLogs, with an adaptive chunk size: start optimistic,
  // shrink only on range-shaped errors, back off with a real delay on
  // rate-limit errors, and never retry the same failure forever.
  function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)),
    ]);
  }

  function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isRateLimitError(e: any): boolean {
    const msg = String(e?.message || e?.details || e || "").toLowerCase();
    return msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests");
  }

  const fetchEventsChunked = useCallback(
    async (eventName: "TicketBought" | "RandomTicketsBought", player: `0x${string}`) => {
      if (!publicClient) return [];
      const latest = await withTimeout(publicClient.getBlockNumber(), 15000, "getBlockNumber");
      let chunkSize = 5000n;
      const MIN_CHUNK = 5n;
      let from = DEPLOY_BLOCK;
      const allLogs: any[] = [];
      let attempts = 0;
      let rateLimitBackoffMs = 1000;
      const playerLower = player.toLowerCase();

      while (from <= latest) {
        attempts++;
        if (attempts > 3000) {
          throw new Error("Gave up after 3000 attempts - RPC seems to be rejecting every request.");
        }
        const to = from + chunkSize > latest ? latest : from + chunkSize;
        try {
          const logs = await withTimeout(
            publicClient.getContractEvents({
              address: PROXIMA_PROTOCOL_ADDRESS,
              abi: proximaProtocolAbi,
              eventName,
              fromBlock: from,
              toBlock: to,
            }),
            15000,
            "getContractEvents"
          );
          const mine = logs.filter((log: any) => (log.args?.player as string | undefined)?.toLowerCase() === playerLower);
          allLogs.push(...mine);
          from = to + 1n;
          rateLimitBackoffMs = 1000; // reset backoff after a success
        } catch (e) {
          if (isRateLimitError(e)) {
            await delay(rateLimitBackoffMs);
            rateLimitBackoffMs = Math.min(rateLimitBackoffMs * 2, 10000);
            continue; // retry the same range after waiting
          }
          if (chunkSize > MIN_CHUNK) {
            chunkSize = chunkSize / 2n > MIN_CHUNK ? chunkSize / 2n : MIN_CHUNK;
            continue; // retry the same starting point with a smaller range
          }
          // already at the minimum chunk size and still failing - skip
          // this slice so one bad range can't hang the whole load
          from = to + 1n;
        }
      }
      return allLogs;
    },
    [publicClient]
  );

  const loadMyTickets = useCallback(async () => {
    if (!address || !publicClient) return;
    setLoadingHistory(true);
    try {
      const manualLogs = await fetchEventsChunked("TicketBought", address);
      const randomLogs = await fetchEventsChunked("RandomTicketsBought", address);

      const byRound = new Map<string, Set<bigint>>();
      for (const log of manualLogs) {
        const round = (log.args as any).round as bigint;
        const num = (log.args as any).number as bigint;
        const key = round.toString();
        if (!byRound.has(key)) byRound.set(key, new Set());
        byRound.get(key)!.add(num);
      }
      for (const log of randomLogs) {
        const round = (log.args as any).round as bigint;
        const nums = (log.args as any).numbers as bigint[];
        const key = round.toString();
        if (!byRound.has(key)) byRound.set(key, new Set());
        nums.forEach((n) => byRound.get(key)!.add(n));
      }

      const rounds = Array.from(byRound.entries()).map(([k, set]) => ({
        round: BigInt(k),
        numbers: Array.from(set),
      }));
      rounds.sort((a, b) => (a.round > b.round ? -1 : 1)); // newest first

      const withStatus: MyRound[] = [];
      for (const r of rounds) {
        const raw = await readContract(wagmiConfig, { ...contractBase, functionName: "rounds", args: [r.round] });
        const info = parseRoundInfo(raw);

        const tickets: TicketRow[] = [];
        const claimableNumbers: bigint[] = [];

        if (!info.resolved) {
          for (const num of r.numbers) tickets.push({ number: num, status: "lost", estAmount: 0n, label: "" }); // placeholder, hidden while in progress
        } else {
          const rawRanks = await readContract(wagmiConfig, { ...contractBase, functionName: "roundRanks", args: [r.round] });
          const ranks = parseRoundRanks(rawRanks);

          for (const num of r.numbers) {
            const outcome = ticketOutcome(num, info, ranks);
            if (outcome.status === "lost") {
              tickets.push({ number: num, status: "lost", estAmount: 0n, label: "" });
              continue;
            }
            const claimed = (await readContract(wagmiConfig, {
              ...contractBase,
              functionName: "claimedNumber",
              args: [r.round, address, num],
            } as any)) as boolean;
            const perTicket = outcome.count > 0n ? outcome.pool / outcome.count : 0n;
            if (claimed) {
              tickets.push({ number: num, status: "claimed", estAmount: perTicket, label: outcome.label });
            } else {
              tickets.push({ number: num, status: "win", estAmount: perTicket, label: outcome.label });
              claimableNumbers.push(num);
            }
          }
        }

        withStatus.push({ round: r.round, resolved: info.resolved, winningNumber: info.winningNumber, tickets, claimableNumbers });
      }

      setMyTickets(withStatus);
    } catch (e: any) {
      console.error("loadMyTickets failed:", e);
      setError(`History load failed: ${e?.shortMessage || e?.message || String(e)}`);
    } finally {
      setLoadingHistory(false);
    }
  }, [address, publicClient, fetchEventsChunked]);

  useEffect(() => {
    loadMyTickets();
    // Intentionally only re-run when the connected address changes.
    // loadMyTickets/fetchEventsChunked close over publicClient, which
    // can get a new object reference on unrelated re-renders with wagmi -
    // depending on the function reference itself here caused this effect
    // to refire continuously, resetting the loading state before any
    // single fetch could ever finish (looked exactly like an infinite
    // "Refreshing..." even though each fetch was completing fine).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // ---------------------------------------------------------------------
  // Public round history (last 10 resolved rounds, for everyone to browse)
  // ---------------------------------------------------------------------
  const loadRoundHistory = useCallback(async () => {
    if (!currentRound || currentRound < 2n) return;
    setLoadingRoundHistory(true);
    try {
      const latestResolved = currentRound - 1n;
      const oldest = latestResolved > 9n ? latestResolved - 9n : 1n;
      const ids: bigint[] = [];
      for (let i = latestResolved; i >= oldest; i--) ids.push(i);

      const results: HistoryRound[] = [];
      for (const id of ids) {
        const raw = await readContract(wagmiConfig, { ...contractBase, functionName: "rounds", args: [id] });
        const info = parseRoundInfo(raw);
        if (info.totalTickets > 0n || info.resolved) {
          const rawRanks = await readContract(wagmiConfig, { ...contractBase, functionName: "roundRanks", args: [id] });
          results.push({ round: id, info, ranks: parseRoundRanks(rawRanks) });
        }
      }
      setRoundHistory(results);
    } catch (e) {
      console.error("loadRoundHistory failed:", e);
    } finally {
      setLoadingRoundHistory(false);
    }
  }, [currentRound]);

  useEffect(() => {
    loadRoundHistory();
  }, [loadRoundHistory]);

  // ---------------------------------------------------------------------
  // Founders slots
  // ---------------------------------------------------------------------
  const loadFounders = useCallback(async () => {
    setLoadingFounders(true);
    try {
      const raw = (await readContract(wagmiConfig, { ...contractBase, functionName: "allFounderSlots" })) as any;
      const [owners, prices, dividends] = raw as [readonly `0x${string}`[], readonly bigint[], readonly bigint[]];
      const slots: FounderSlotUI[] = [];
      for (let i = 0; i < FOUNDER_SLOTS; i++) {
        slots.push({ owner: owners[i], price: prices[i], dividend: dividends[i] });
      }
      setFounders(slots);
    } catch (e) {
      console.error("loadFounders failed:", e);
    } finally {
      setLoadingFounders(false);
    }
  }, []);

  useEffect(() => {
    loadFounders();
  }, [loadFounders]);

  // ---------------------------------------------------------------------
  // Maker fee (pull-only, visible only to the maker wallet)
  // ---------------------------------------------------------------------
  const loadMakerAccrued = useCallback(async () => {
    if (!isMaker) return;
    try {
      const val = (await readContract(wagmiConfig, { ...contractBase, functionName: "makerAccrued" })) as bigint;
      setMakerAccrued(val);
    } catch {
      // ignore
    }
  }, [isMaker]);

  useEffect(() => {
    loadMakerAccrued();
  }, [loadMakerAccrued]);

  async function handleWithdrawMaker() {
    setError(null);
    try {
      setStatus("Withdrawing Maker share...");
      const hash = await writeContractAsync({ address: PROXIMA_PROTOCOL_ADDRESS, abi: proximaProtocolAbi, functionName: "withdrawMaker" });
      setStatus("Waiting for confirmation...");
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setStatus("Maker share withdrawn.");
      loadMakerAccrued();
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Withdraw failed");
      setStatus(null);
    }
  }

  async function ensureUsdtApproved(needed: bigint) {
    if (!address) return;
    const allowance = (await readContract(wagmiConfig, {
      address: USDT_ADDRESS,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, PROXIMA_PROTOCOL_ADDRESS],
    })) as bigint;

    if (allowance < needed) {
      setStatus("Approving USDT (1 of 2 signatures)...");
      const approveHash = await writeContractAsync({
        address: USDT_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [PROXIMA_PROTOCOL_ADDRESS, APPROVE_AMOUNT],
      });
      setStatus("Waiting for approval to confirm...");
      await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
    }
  }

  async function handleResolve() {
    setError(null);
    try {
      setStatus("Resolving round...");
      const hash = await writeContractAsync({
        address: PROXIMA_PROTOCOL_ADDRESS,
        abi: proximaProtocolAbi,
        functionName: "resolveRound",
      });
      setStatus("Waiting for confirmation...");
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setStatus("Round resolved!");
      refetchJackpot();
      refetchNearPool();
      refetchTime();
      refetchRound();
      loadRoundHistory();
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Resolve failed");
      setStatus(null);
    }
  }

  async function handleBuy() {
    if (!address) return;
    setError(null);
    try {
      const ticketCount = mode === "manual" ? 1 : Math.max(1, parseInt(count || "1", 10));
      const needed = TICKET_PRICE * BigInt(ticketCount);

      setStatus("Checking allowance...");
      await ensureUsdtApproved(needed);

      setStatus(mode === "manual" ? "Buying your ticket..." : `Buying ${ticketCount} random tickets...`);
      const buyHash = await writeContractAsync(
        mode === "manual"
          ? {
              address: PROXIMA_PROTOCOL_ADDRESS,
              abi: proximaProtocolAbi,
              functionName: "buyTicket",
              args: [BigInt(number)],
            }
          : {
              address: PROXIMA_PROTOCOL_ADDRESS,
              abi: proximaProtocolAbi,
              functionName: "buyRandomTickets",
              args: [BigInt(ticketCount)],
            }
      );
      setStatus("Waiting for purchase to confirm...");
      await waitForTransactionReceipt(wagmiConfig, { hash: buyHash });

      setStatus("Done! Your ticket is in.");
      refetchJackpot();
      refetchNearPool();
      refetchTime();
      refetchRound();
      loadMyTickets();
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Transaction failed");
      setStatus(null);
    }
  }

  async function handleClaim() {
    if (!claimRound || !claimNumbers) return;
    setError(null);
    try {
      const numbersArr = claimNumbers
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => BigInt(n));

      setStatus("Claiming winnings...");
      const hash = await writeContractAsync({
        address: PROXIMA_PROTOCOL_ADDRESS,
        abi: proximaProtocolAbi,
        functionName: "claim",
        args: [BigInt(claimRound), numbersArr],
      });
      setStatus("Waiting for claim to confirm...");
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setStatus("Claimed! Check your wallet.");
      loadMyTickets();
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Claim failed");
      setStatus(null);
    }
  }

  async function handleClaimRound(round: bigint, numbers: bigint[]) {
    setError(null);
    try {
      setStatus(`Claiming round ${round}...`);
      const hash = await writeContractAsync({
        address: PROXIMA_PROTOCOL_ADDRESS,
        abi: proximaProtocolAbi,
        functionName: "claim",
        args: [round, numbers],
      });
      setStatus("Waiting for claim to confirm...");
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setStatus("Claimed! Check your wallet.");
      loadMyTickets();
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Claim failed");
      setStatus(null);
    }
  }

  async function handleClaimFounderSlot(slotIndex: number) {
    setError(null);
    try {
      setStatus("Checking allowance...");
      await ensureUsdtApproved(FOUNDER_INITIAL_PRICE);
      setStatus(`Claiming Founder Slot ${slotIndex + 1}...`);
      const hash = await writeContractAsync({
        address: PROXIMA_PROTOCOL_ADDRESS,
        abi: proximaProtocolAbi,
        functionName: "claimFounderSlot",
        args: [BigInt(slotIndex)],
      });
      setStatus("Waiting for confirmation...");
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setStatus("Founder slot claimed!");
      loadFounders();
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Claim failed");
      setStatus(null);
    }
  }

  async function handleForceBuy(slotIndex: number, currentPrice: bigint) {
    setError(null);
    try {
      const needed = currentPrice + FOUNDER_FORCE_BUY_INCREMENT;
      setStatus("Checking allowance...");
      await ensureUsdtApproved(needed);
      setStatus(`Force-buying Founder Slot ${slotIndex + 1}...`);
      const hash = await writeContractAsync({
        address: PROXIMA_PROTOCOL_ADDRESS,
        abi: proximaProtocolAbi,
        functionName: "forceBuyFounderSlot",
        args: [BigInt(slotIndex)],
      });
      setStatus("Waiting for confirmation...");
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setStatus("Force-buy complete - previous owner was paid out.");
      loadFounders();
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Force-buy failed");
      setStatus(null);
    }
  }

  async function handleClaimFounderDividend(slotIndex: number) {
    setError(null);
    try {
      setStatus(`Claiming dividend for slot ${slotIndex + 1}...`);
      const hash = await writeContractAsync({
        address: PROXIMA_PROTOCOL_ADDRESS,
        abi: proximaProtocolAbi,
        functionName: "claimFounderDividend",
        args: [BigInt(slotIndex)],
      });
      setStatus("Waiting for confirmation...");
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setStatus("Dividend claimed!");
      loadFounders();
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Claim failed");
      setStatus(null);
    }
  }

  return (
    <div className="min-h-screen w-full" style={{ background: "#0A0A14", color: "#F5F5FA", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="sticky top-0 z-10 backdrop-blur border-b px-4 py-3 flex items-center justify-between" style={{ background: "rgba(10,10,20,0.85)", borderColor: "rgba(255,255,255,0.08)" }}>
        <span className="font-bold tracking-tight">PROXIMA PROTOCOL</span>
        <ConnectButton />
      </div>

      <div className="p-4 max-w-2xl mx-auto space-y-4">
        {(status || error) && (
          <div
            className="rounded-xl px-4 py-2.5 text-sm"
            style={{
              background: error ? "rgba(248,113,113,0.1)" : "rgba(139,92,246,0.1)",
              color: error ? "#F87171" : "#8B8B9E",
              border: `1px solid ${error ? "rgba(248,113,113,0.25)" : "rgba(139,92,246,0.25)"}`,
            }}
          >
            {error || status}
          </div>
        )}

        {/* Maker fee panel - only visible when connected as the maker wallet */}
        {isMaker && (
          <div className="rounded-2xl p-4 border" style={{ background: "#13131F", borderColor: "rgba(139,92,246,0.3)" }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "#8B8B9E" }}>Maker share accrued</div>
                <div className="font-mono font-semibold">{fmt(makerAccrued ?? undefined)} USDT</div>
              </div>
              <button
                onClick={handleWithdrawMaker}
                disabled={!makerAccrued || makerAccrued === 0n}
                className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
                style={{ background: "#8B5CF6", color: "#fff" }}
              >
                Withdraw
              </button>
            </div>
          </div>
        )}

        {/* Live stats */}
        <div className="rounded-2xl p-5 border" style={{ background: "#13131F", borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "#8B8B9E" }}>
            Round #{currentRound?.toString() ?? "..."} | next draw in {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
          </div>
          <div className="text-3xl font-bold font-mono" style={{ color: "#E8B23D" }}>
            {fmt(jackpot)} USDT
          </div>
          <div className="text-xs mt-1" style={{ color: "#8B8B9E" }}>Jackpot - exact number match</div>

          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            <div>
              <div className="font-mono font-semibold">{fmt(nearPool)}</div>
              <div className="text-[10px]" style={{ color: "#8B8B9E" }}>Near-prize (this round)</div>
            </div>
            <div>
              <div className="font-mono font-semibold">{fmt(nearCarryPool)}</div>
              <div className="text-[10px]" style={{ color: "#8B8B9E" }}>Carrying to next round</div>
            </div>
            <div>
              <div className="font-mono font-semibold">{fmt(reserve)}</div>
              <div className="text-[10px]" style={{ color: "#8B8B9E" }}>Reserve</div>
            </div>
          </div>
          <div className="text-[10px] mt-3" style={{ color: "#6B6B7E" }}>
            No exact match wins the nearest 3 distinct numbers played this round: rank 1 (5% of tickets), rank 2 (3.75%), rank 3 (2.5%). A ticket only ever wins its single best prize.
          </div>

          <button
            onClick={handleResolve}
            disabled={!isConnected || !!(timeLeft && timeLeft > 0n)}
            className="w-full mt-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
            style={{ background: "#1B1B2C", color: "#F5F5FA", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            {timeLeft && timeLeft > 0n ? "Resolve available when the timer hits 00:00" : "Resolve Round"}
          </button>
        </div>

        {/* Last winners */}
        {lastWinners && lastWinners.length > 0 && (
          <div className="rounded-2xl p-4 border text-sm" style={{ background: "#13131F", borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: "#8B8B9E" }}>Last winning numbers</div>
            <div className="flex flex-wrap gap-2 font-mono">
              {lastWinners.map((n, i) => (
                <span key={i} className="px-2 py-1 rounded-full" style={{ background: "rgba(52,211,153,0.12)", color: "#34D399" }}>
                  {n.toString()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Buy tickets */}
        <div className="rounded-2xl p-4 border" style={{ background: "#13131F", borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="font-semibold mb-3">Buy tickets - 1 USDT each</div>
          <div className="flex gap-2 mb-3">
            <button onClick={() => setMode("manual")} className="flex-1 py-2 rounded-lg text-sm font-medium" style={{ background: mode === "manual" ? "#E8B23D" : "#1B1B2C", color: mode === "manual" ? "#0A0A14" : "#F5F5FA" }}>
              Pick a number
            </button>
            <button onClick={() => setMode("random")} className="flex-1 py-2 rounded-lg text-sm font-medium" style={{ background: mode === "random" ? "#E8B23D" : "#1B1B2C", color: mode === "random" ? "#0A0A14" : "#F5F5FA" }}>
              Random tickets
            </button>
          </div>

          {mode === "manual" ? (
            <input
              type="number"
              min={1}
              max={10000}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Number 1-10000"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none mb-3"
              style={{ background: "#0D0D18", borderColor: "rgba(255,255,255,0.1)", color: "#F5F5FA" }}
            />
          ) : (
            <input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              placeholder="How many tickets"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none mb-3"
              style={{ background: "#0D0D18", borderColor: "rgba(255,255,255,0.1)", color: "#F5F5FA" }}
            />
          )}

          <button
            onClick={handleBuy}
            disabled={!isConnected || (mode === "manual" && !number)}
            className="w-full py-2.5 rounded-lg font-semibold disabled:opacity-40"
            style={{ background: "#E8B23D", color: "#0A0A14" }}
          >
            {isConnected ? "Buy" : "Connect wallet first"}
          </button>
        </div>

        {/* My tickets / history */}
        {isConnected && (
          <div className="rounded-2xl p-4 border" style={{ background: "#13131F", borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">My tickets</div>
              <button onClick={loadMyTickets} className="text-xs underline" style={{ color: "#8B8B9E" }}>
                {loadingHistory ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {myTickets.length === 0 && !loadingHistory && (
              <div className="text-xs" style={{ color: "#8B8B9E" }}>No tickets found for this wallet yet.</div>
            )}

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {myTickets.map((r) => (
                <div key={r.round.toString()} className="rounded-xl p-3" style={{ background: "#0D0D18" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold">Round #{r.round.toString()}</span>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: r.resolved ? "#34D399" : "#8B8B9E" }}>
                      {r.resolved ? `Resolved | winner ${r.winningNumber}` : "In progress"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2 font-mono text-xs">
                    {r.tickets.map((t, idx) => (
                      <span
                        key={`${t.number.toString()}-${idx}`}
                        className="px-2 py-0.5 rounded-full"
                        style={{
                          background: t.status === "win" ? "rgba(52,211,153,0.15)" : t.status === "claimed" ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.06)",
                          color: t.status === "win" ? "#34D399" : t.status === "claimed" ? "#8B5CF6" : "#8B8B9E",
                        }}
                      >
                        {t.number.toString()}
                        {t.status === "win" && ` | ${t.label} | won ${fmt(t.estAmount)}`}
                        {t.status === "claimed" && ` | ${t.label} | claimed`}
                      </span>
                    ))}
                  </div>
                  {r.resolved && r.claimableNumbers.length > 0 && (
                    <button
                      onClick={() => handleClaimRound(r.round, r.claimableNumbers)}
                      className="w-full py-1.5 rounded-lg text-xs font-semibold"
                      style={{ background: "#8B5CF6", color: "#fff" }}
                    >
                      Claim this round
                    </button>
                  )}
                  {r.resolved && r.claimableNumbers.length === 0 && (
                    <div className="text-[11px]" style={{ color: "#8B8B9E" }}>Nothing to claim here.</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Founders slots */}
        <div className="rounded-2xl p-4 border" style={{ background: "#13131F", borderColor: "rgba(232,178,61,0.25)" }}>
          <div className="flex items-center justify-between mb-1">
            <div className="font-semibold">Founders Slots</div>
            <button onClick={loadFounders} className="text-xs underline" style={{ color: "#8B8B9E" }}>
              {loadingFounders ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div className="text-[11px] mb-3" style={{ color: "#8B8B9E" }}>
            5 slots, each earning 2% of every round's ticket revenue. First claim $20. Any slot can be force-bought for $10 more than its last price - the outbid owner is paid back in full, plus a $5 premium, plus every unclaimed dividend, instantly.
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {founders.map((f, i) => {
              const empty = !f.owner || f.owner === "0x0000000000000000000000000000000000000000";
              const isMine = !!address && f.owner?.toLowerCase() === address.toLowerCase();
              return (
                <div key={i} className="rounded-lg p-2.5" style={{ background: "#0D0D18" }}>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#8B8B9E" }}>Slot {i + 1}</div>
                  <div className="text-xs font-mono mb-1 truncate" style={{ color: empty ? "#8B8B9E" : isMine ? "#34D399" : "#F5F5FA" }}>
                    {empty ? "empty" : isMine ? "you" : `${f.owner.slice(0, 6)}...${f.owner.slice(-4)}`}
                  </div>
                  <div className="text-[10px] mb-2" style={{ color: "#8B8B9E" }}>
                    {empty ? "start $20" : `price $${fmt(f.price)}`} | div ${fmt(f.dividend)}
                  </div>
                  {empty ? (
                    <button
                      onClick={() => handleClaimFounderSlot(i)}
                      disabled={!isConnected}
                      className="w-full py-1.5 rounded-md text-[11px] font-semibold disabled:opacity-40"
                      style={{ background: "#E8B23D", color: "#0A0A14" }}
                    >
                      Claim $20
                    </button>
                  ) : (
                    <div className="space-y-1">
                      <button
                        onClick={() => handleForceBuy(i, f.price)}
                        disabled={!isConnected}
                        className="w-full py-1.5 rounded-md text-[11px] font-semibold disabled:opacity-40"
                        style={{ background: "#1B1B2C", color: "#F5F5FA" }}
                      >
                        Force-buy ${fmt(f.price + FOUNDER_FORCE_BUY_INCREMENT)}
                      </button>
                      {isMine && f.dividend > 0n && (
                        <button
                          onClick={() => handleClaimFounderDividend(i)}
                          className="w-full py-1.5 rounded-md text-[11px] font-semibold"
                          style={{ background: "#8B5CF6", color: "#fff" }}
                        >
                          Claim ${fmt(f.dividend)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Round history - visible to everyone, no wallet needed */}
        <div className="rounded-2xl p-4 border" style={{ background: "#13131F", borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Round history</div>
            <button onClick={loadRoundHistory} className="text-xs underline" style={{ color: "#8B8B9E" }}>
              {loadingRoundHistory ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {roundHistory.length === 0 && !loadingRoundHistory && (
            <div className="text-xs" style={{ color: "#8B8B9E" }}>No completed rounds yet.</div>
          )}

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {roundHistory.map((h) => (
              <div key={h.round.toString()} className="rounded-lg px-3 py-2 text-xs font-mono" style={{ background: "#0D0D18" }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold">Round #{h.round.toString()}</span>
                  <span style={{ color: "#34D399" }}>winner {h.info.winningNumber.toString()}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ color: "#8B8B9E" }}>
                  <span>Tickets: {h.info.totalTickets.toString()}</span>
                  <span>Jackpot: {h.info.jackpotWinners > 0n ? `${fmt(h.info.jackpotAtDraw)} paid` : "carried over"}</span>
                  <span>Near ranks found: {h.ranks.ranksFound.toString()}/3</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Manual claim (fallback / advanced) */}
        <div className="rounded-2xl p-4 border" style={{ background: "#13131F", borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="font-semibold mb-3">Claim manually</div>
          <input
            type="number"
            value={claimRound}
            onChange={(e) => setClaimRound(e.target.value)}
            placeholder="Round number"
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none mb-2"
            style={{ background: "#0D0D18", borderColor: "rgba(255,255,255,0.1)", color: "#F5F5FA" }}
          />
          <input
            value={claimNumbers}
            onChange={(e) => setClaimNumbers(e.target.value)}
            placeholder="Your numbers, comma-separated e.g. 1234, 5678"
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none mb-3"
            style={{ background: "#0D0D18", borderColor: "rgba(255,255,255,0.1)", color: "#F5F5FA" }}
          />
          <button
            onClick={handleClaim}
            disabled={!isConnected || !claimRound || !claimNumbers}
            className="w-full py-2.5 rounded-lg font-semibold disabled:opacity-40"
            style={{ background: "#8B5CF6", color: "#fff" }}
          >
            Claim
          </button>
        </div>

        {/* Verification / trust footer */}
        <div className="text-center text-xs pt-2 space-y-1" style={{ color: "#8B8B9E" }}>
          <div>
            Contract{" "}
            <a href={`https://bscscan.com/address/${PROXIMA_PROTOCOL_ADDRESS}#code`} target="_blank" rel="noreferrer" className="underline">
              {PROXIMA_PROTOCOL_ADDRESS.slice(0, 6)}...{PROXIMA_PROTOCOL_ADDRESS.slice(-4)}
            </a>{" "}
            | Source verified on BscScan
          </div>
          <div className="pb-6">
            <a href="https://t.me/ProximaProtocol" target="_blank" rel="noreferrer" className="underline font-semibold" style={{ color: "#E8B23D" }}>
              Join the community on Telegram
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
