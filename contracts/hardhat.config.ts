import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";

const COMPILER = { version: "0.8.28", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } };
const SIZE = { version: "0.8.28", settings: { viaIR: true, optimizer: { enabled: true, runs: 1 }, evmVersion: "cancun" } };
const SIZE_OVERRIDES = { "contracts/HeimdallVault.sol": SIZE, "contracts/HeimdallVaultDeployer.sol": SIZE, "contracts/mocks/MockERC8004.sol": SIZE };

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViemPlugin],
  // The vault's creation code lives inside the deployer, which must stay under 24 KB (EIP-170): both contracts are
  // optimised for size. Declared for both build profiles: Hardhat's implicit `production` profile drops overrides,
  // which made the deployer 25.6 KB. `npm run size` checks the production build.
  solidity: {
    profiles: {
      default: { compilers: [COMPILER], overrides: SIZE_OVERRIDES },
      production: { compilers: [COMPILER], overrides: SIZE_OVERRIDES },
    },
  },
  // Solidity tests. `npx hardhat test solidity` uses the default profile; `--test-profile deep` for the long pre-release run.
  test: {
    solidity: {
      profiles: {
        default: { fuzz: { runs: 256 }, invariant: { runs: 64, depth: 64, failOnRevert: true } },
        deep: { fuzz: { runs: 10_000 }, invariant: { runs: 512, depth: 200, failOnRevert: true } },
      },
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
