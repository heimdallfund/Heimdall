/** Heimdall contracts on Robinhood Chain mainnet (chain 4663), deployed at block 122,057,226. Source-verified on Sourcify and Blockscout. */
export const HEIMDALL_MAINNET = {
  chainId: 4663,
  deployBlock: 122_057_226n,
  adminSafe: "0xaF1c3b55D204899CEd14d23C996153bC82424168",
  shieldSigner: "0xa6ce235055039a55aa438aFFAD18F7d0Ccf092d9",
  vaultFactory: "0x838fdede1ae6fbdc15f784030d78ca7543d1154d",
  vaultDeployer: "0x59c2385ee4876405f535f6fcf8f7f566f48cb9fb",
  signals: "0x14bd445999dd254090ce86bfcf96df5d4a3e301d",
  pay: "0xd8bd0bfc6ad1c5cee42c4f64bfcea9555a170265",
  autoInvest: "0xeacf613ff7d6dbc8acbf51b411ad092d48e5a932",
  riskOracle: "0x84da850303db7cca6d5194b9d9f8f392a6c9e3e0",
  guardModule: "0xd2a8815c10f1d71fc854edb7a78405db8fe86ae6",
  /** Stock tokens vaults and Auto-Invest can hold, with the price feed Heimdall uses. `weekdays`: priced Monday to
   *  Friday only (closed Saturday 00:00 to Monday 01:00 UTC); the others are priced 24/7. */
  stocks: {
    NVDA: { token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", feed: "0x1b8a95850fe344ddf67b98b61de9b5a1417edc8f", weekdays: false },
    TSLA: { token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", feed: "0xf7d7b2f8b73a5b2828625f23c2a892baf50d6d34", weekdays: false },
    GOOGL: { token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", feed: "0x51196319a3108269fe7f14d7a05b846f27be63f7", weekdays: false },
    AMZN: { token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", feed: "0x4cb68ac957a2485e01c313a4422bb40bd420e224", weekdays: true },
    AAPL: { token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", feed: "0x7f6a012be52d3d5108648b1fc9e4ed0cf29a5666", weekdays: true },
    MSFT: { token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", feed: "0x1bd6f9067c9ff8738ec02fb540fcca688d461a92", weekdays: true },
    META: { token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", feed: "0xedba6246ce68390fd8d03a2e776e06b88e11c8c1", weekdays: true },
    COIN: { token: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", feed: "0x935b7a429d2fe4fea460ce28cc7d96005b119c0b", weekdays: true },
    QQQ: { token: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", feed: "0x172545fc5e1ab84f95f16c7ee5d20c57a2134068", weekdays: true },
    SPCX: { token: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", feed: "0x404776bd5c27f2450f62aa346e0d01f8f88c3843", weekdays: true },
    GME: { token: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E", feed: "0x2648b4778c0c9e9b07a84ac9a9f1484b5d2fe2e5", weekdays: true },
    MU: { token: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", feed: "0x898ceae594b4664f5254233f7138b2975e52741f", weekdays: true },
    CRCL: { token: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", feed: "0xe0630690fd714351bf981fcb3be9246584a4dd83", weekdays: true },
    DELL: { token: "0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd", feed: "0xbc7959386bef93115cd2fd43af9d41d1e5c1237c", weekdays: true },
    USO: { token: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344", feed: "0x4de17a3a0b10cafe8ba4e87b9ee7a69b379a94a9", weekdays: true },
    SGOV: { token: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5", feed: "0xa4bc3aeaef4712c622f5c18f7a73d78e5cf4a460", weekdays: true },
  },
  /** @deprecated use `stocks` */
  stockFeeds: {
    NVDA: "0x1b8a95850fe344ddf67b98b61de9b5a1417edc8f",
    TSLA: "0xf7d7b2f8b73a5b2828625f23c2a892baf50d6d34",
    GOOGL: "0x51196319a3108269fe7f14d7a05b846f27be63f7",
  },

} as const;
