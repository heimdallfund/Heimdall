import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    compilers: [{ version: "0.8.28", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } }],
    // The vault's creation code lives inside the deployer, which must stay under 24 KB: optimise these for size.
    overrides: {
      "contracts/HeimdallVault.sol": { version: "0.8.28", settings: { viaIR: true, optimizer: { enabled: true, runs: 1 }, evmVersion: "cancun" } },
      "contracts/HeimdallVaultDeployer.sol": { version: "0.8.28", settings: { viaIR: true, optimizer: { enabled: true, runs: 1 }, evmVersion: "cancun" } },
    },
  },
  // Lets the local fork execute calls at historical Robinhood Chain blocks (EVM rules: Cancun from genesis).
  chainDescriptors: {
    4663: {
      name: "Robinhood Chain", chainType: "generic", hardforkHistory: { cancun: { blockNumber: 0 } },
      // Source verification: npx hardhat verify blockscout --network robinhood <address> <constructor args…>
      blockExplorers: { blockscout: { name: "Robinhood Chain Blockscout", url: "https://robinhoodchain.blockscout.com", apiUrl: "https://robinhoodchain.blockscout.com/api" } },
    },
  },
  networks: {
    // Local fork of Robinhood Chain mainnet for integration tests: FORK=1 npx hardhat test nodejs test/fork/*.ts
    robinhoodFork: {
      type: "edr-simulated",
      chainType: "generic",
      chainId: 4663,
      forking: { url: process.env.RPC_URL_MAINNET ?? "https://rpc.mainnet.chain.robinhood.com", blockNumber: process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined },
    },
    robinhood: {
      type: "http",
      chainType: "generic",
      url: process.env.RPC_URL_MAINNET ?? "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    robinhoodTestnet: {
      type: "http",
      chainType: "generic",
      url: process.env.RPC_URL_TESTNET ?? "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
};
export default config;
