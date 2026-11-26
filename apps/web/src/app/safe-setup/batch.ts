import { concat, encodeFunctionData, encodePacked, getAddress, parseAbi, size } from "viem";
// One call: the vault's manager becomes the monitor's keeper key, so the reference agent runs on the hourly cron
export const BATCH_TITLE = "Appoint the vault's agent";
export const BATCH: { to: `0x${string}`; data: `0x${string}` }[] = [
  // HeimdallVault 0x38d8…52eB (Heimdall Guardian Balanced).setManager(0x82D0…7De6, the monitor's keeper key, run hourly by the monitor cron)
  { to: "0x38d8eDb9405DF0A6C781F7954b29A995288b52eB", data: "0xd0ebdbe700000000000000000000000082d0b3b0c56175cb3318fcf64b5185d63cad7de6" },
];

export const SAFE = getAddress("0xaF1c3b55D204899CEd14d23C996153bC82424168");
export const MULTISEND_CALL_ONLY = getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2"); // Safe 1.4.1
export const NONCE = 4n; // the Safe nonce this batch is for; a later nonce means it already ran
export const SAFE_ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function approvedHashes(address owner, bytes32 hash) view returns (uint256)",
  "function approveHash(bytes32 hashToApprove)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
]);
export const BATCH_DATA = encodeFunctionData({
  abi: parseAbi(["function multiSend(bytes transactions) payable"]),
  functionName: "multiSend",
  args: [concat(BATCH.map((t) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, t.to, 0n, BigInt(size(t.data)), t.data])))],
});
