import { concat, encodeFunctionData, encodePacked, getAddress, parseAbi, size } from "viem";
// Generated from contracts/deployments/robinhood.safe-route-fees.json: Signals treasury, factory fee recipient and 0 vault(s) → HeimdallFeeSplitter; $HEIM holder terms on the factory and Signals
export const BATCH_TITLE = "Route fees to $HEIM stakers";
export const BATCH: { to: `0x${string}`; data: `0x${string}` }[] = [
  { to: "0x8d3c0d6874a54cde3342031271fbdaf2c49371d3", data: "0x79ba5097" },
  { to: "0x14bd445999dd254090ce86bfcf96df5d4a3e301d", data: "0xf0f442600000000000000000000000008d3c0d6874a54cde3342031271fbdaf2c49371d3" },
  { to: "0x838fdede1ae6fbdc15f784030d78ca7543d1154d", data: "0x54841e94000000000000000000000000af1c3b55d204899ced14d23c996153bc824241680000000000000000000000008d3c0d6874a54cde3342031271fbdaf2c49371d3000000000000000000000000a6ce235055039a55aa438affad18f7d0ccf092d9" },
  { to: "0xeacf613ff7d6dbc8acbf51b411ad092d48e5a932", data: "0x30f738be00000000000000000000000000000000000000000000000000000000000000190000000000000000000000008d3c0d6874a54cde3342031271fbdaf2c49371d3" },
  { to: "0xd8bd0bfc6ad1c5cee42c4f64bfcea9555a170265", data: "0x30f738be00000000000000000000000000000000000000000000000000000000000000640000000000000000000000008d3c0d6874a54cde3342031271fbdaf2c49371d3" },
  { to: "0x838fdede1ae6fbdc15f784030d78ca7543d1154d", data: "0x247cd3a1000000000000000000000000185b29b0015d4dc5e658d6bb3f81eba8240c70a30000000000000000000000000000000000000000000422ca8b0a00a425000000" },
  { to: "0x14bd445999dd254090ce86bfcf96df5d4a3e301d", data: "0xc3d1af58000000000000000000000000185b29b0015d4dc5e658d6bb3f81eba8240c70a30000000000000000000000000000000000000000000422ca8b0a00a42500000000000000000000000000000000000000000000000000000000000000000001f4" },
];

export const SAFE = getAddress("0xaF1c3b55D204899CEd14d23C996153bC82424168");
export const MULTISEND_CALL_ONLY = getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2"); // Safe 1.4.1
export const NONCE = 3n; // the Safe nonce this batch is for; a later nonce means it already ran
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
