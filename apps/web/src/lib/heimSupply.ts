import { erc20Abi, formatUnits, getAddress, isAddress, type Address } from "viem";
import { ADDRESSES } from "./config";
import { client } from "./reads";
import { heimAddress } from "./heim";

const DEAD = "0x000000000000000000000000000000000000dEaD" as Address;

/** Wallets whose $HEIM is not circulating (treasury, vesting, LP locks): comma-separated in HEIM_NON_CIRCULATING. */
export const nonCirculating = (): Address[] =>
  (process.env.HEIM_NON_CIRCULATING ?? "").split(",").map((s) => s.trim()).filter((a) => isAddress(a)).map((a) => getAddress(a));

export interface HeimSupply {
  token: Address; decimals: number; minted: string; burned: string; total: string; circulating: string;
  staked: string | null; nonCirculating: { address: Address; balance: string }[]; updated: string;
}

/** $HEIM supply read from Robinhood Chain. Total = minted − burned (dead address); circulating = total − listed wallets. */
export async function readHeimSupply(): Promise<HeimSupply | null> {
  const token = await heimAddress();
  if (!token) return null;
  const excluded = nonCirculating();
  const read = (functionName: "totalSupply" | "decimals") => client.readContract({ address: token, abi: erc20Abi, functionName });
  const bal = (a: Address) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a] });
  const [minted, decimals, burned, staked, ...held] = await Promise.all([
    read("totalSupply") as Promise<bigint>, read("decimals") as Promise<number>, bal(DEAD),
    ADDRESSES.staking ? bal(ADDRESSES.staking) : Promise.resolve(null), ...excluded.map(bal),
  ]);
  const total = minted - burned;
  const locked = held.reduce((s, b) => s + b, 0n);
  const f = (v: bigint) => formatUnits(v, decimals);
  return {
    token, decimals, minted: f(minted), burned: f(burned), total: f(total), circulating: f(total - locked),
    staked: staked === null ? null : f(staked), nonCirculating: excluded.map((address, i) => ({ address, balance: f(held[i]!) })),
    updated: new Date().toISOString(),
  };
}
