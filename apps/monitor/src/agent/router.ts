import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

/** Builds the swap call the vault will execute. */
export interface RouterAdapter {
  address: Address;
  swapCalldata(o: { tokenIn: Address; tokenOut: Address; amountIn: bigint; minOut: bigint; recipient: Address }): Hex;
}

const SWAP_ROUTER_02 = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

/** Uniswap v3 SwapRouter02 (no deadline field). Fee tier per pair, default 0.3%. */
export function uniswapV3(address: Address, feeFor: (a: Address, b: Address) => number = () => 3000): RouterAdapter {
  return {
    address,
    swapCalldata: ({ tokenIn, tokenOut, amountIn, minOut, recipient }) =>
      encodeFunctionData({
        abi: SWAP_ROUTER_02, functionName: "exactInputSingle",
        args: [{ tokenIn, tokenOut, fee: feeFor(tokenIn, tokenOut), recipient, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
      }),
  };
}

/** Local tests: contracts/mocks MockRouter. */
export function mockRouter(address: Address): RouterAdapter {
  const abi = parseAbi(["function swap(address,address,uint256,address) returns (uint256)"]);
  return { address, swapCalldata: ({ tokenIn, tokenOut, amountIn, recipient }) => encodeFunctionData({ abi, functionName: "swap", args: [tokenIn, tokenOut, amountIn, recipient] }) };
}
