// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {HeimdallVault} from "../../contracts/HeimdallVault.sol";
import {ShieldGuarded} from "../../contracts/ShieldGuarded.sol";
import {MockERC20, MockFeed, MockRouter} from "../../contracts/mocks/Mocks.sol";

/// R5-02: a rogue manager whose trades Shield approves (a self-sandwich looks clean when simulated alone) can lose
/// up to the daily loss limit of NAV every day, and nothing stops it onchain until the owner Safe acts.
/// The vault now has a guardian (the monitor's key) that can pause it at once, but can do nothing else.
contract VaultPoc is Test {
    uint256 constant SHIELD_PK = 0xA11CE;
    HeimdallVault vault;
    MockERC20 usdg;
    MockERC20 nvda;
    MockFeed feed;
    MockRouter router;
    address manager = address(0xBEEF);
    address guardian = address(0x6A2D);
    address user = address(0x3001);
    uint256 nonce;

    function setUp() public {
        vm.warp(1_790_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        nvda = new MockERC20("NVIDIA", "NVDA", 18);
        feed = new MockFeed(8, 100e8);
        feed.set(100e8, block.timestamp);
        router = new MockRouter();
        router.setRate(address(usdg), address(nvda), 1e28); // fair: 1 USDG -> 0.01 NVDA
        HeimdallVault.CallPerm[] memory calls = new HeimdallVault.CallPerm[](1);
        calls[0] = HeimdallVault.CallPerm(address(router), MockRouter.swap.selector);
        address[] memory spenders = new address[](1);
        spenders[0] = address(router);
        HeimdallVault.AssetInit[] memory assets = new HeimdallVault.AssetInit[](1);
        assets[0] = HeimdallVault.AssetInit(address(nvda), address(feed), 7 days);
        vault = new HeimdallVault(HeimdallVault.InitConfig({
            baseAsset: IERC20(address(usdg)), name: "Poc", symbol: "hPOC", owner: address(this), manager: manager,
            feeRecipient: address(0xFEE), shieldSigner: vm.addr(SHIELD_PK), guardian: guardian, maxTradeBps: 2500,
            maxLossBps: 300, maxDailyLossBps: 500, depositCap: type(uint256).max, heimToken: address(0), holderMin: 0,
            calls: calls, spenders: spenders, assets: assets
        }));
        usdg.mint(user, 100_000e6);
        vm.startPrank(user);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(100_000e6, user);
        vm.stopPrank();
        _exec(address(usdg), abi.encodeCall(IERC20.approve, (address(router), type(uint256).max)));
        _exec(address(nvda), abi.encodeCall(IERC20.approve, (address(router), type(uint256).max)));
    }

    function _receipt(address target, bytes memory data) internal returns (ShieldGuarded.Receipt memory r, bytes memory sig) {
        r = ShieldGuarded.Receipt(address(vault), target, keccak256(data), 0, 0, uint64(block.timestamp + 120), keccak256(abi.encode(++nonce)));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(SHIELD_PK, vault.receiptDigest(r));
        sig = abi.encodePacked(rr, s, v);
    }

    function _exec(address target, bytes memory data) internal {
        (ShieldGuarded.Receipt memory r, bytes memory sig) = _receipt(target, data);
        vm.prank(manager);
        vault.execute(target, data, r, sig);
    }

    /// The manager buys at a price 2.9% worse than the oracle, with the difference landing with the manager
    /// (a self-sandwich). Each trade fits the 3% per-trade limit; per 24 h the 5% limit stops it, then it starts again.
    function _badTrade(uint256 amount) internal {
        uint256 n = nvda.balanceOf(address(vault));
        if (n == 0) {
            router.setRate(address(usdg), address(nvda), 1e28 * 9_710 / 10_000);
            _exec(address(router), abi.encodeCall(MockRouter.swap, (address(usdg), address(nvda), amount, address(vault))));
        } else {
            router.setRate(address(nvda), address(usdg), 1e8 * 9_710 / 10_000);
            _exec(address(router), abi.encodeCall(MockRouter.swap, (address(nvda), address(usdg), n, address(vault))));
        }
    }

    function test_R5_02_withoutAGuardian_lossRepeatsEveryDay() public {
        uint256 start = vault.totalAssets();
        for (uint256 day; day < 10; ++day) {
            for (uint256 i; i < 2; ++i) {
                try this.badTradeExternal(20_000e6) {} catch {}
            }
            vm.warp(block.timestamp + 1 days);
            feed.set(100e8, block.timestamp);
        }
        // roughly 1.16% of NAV lost per day for ten days, and the vault is still trading
        assertLt(vault.totalAssets(), start * 90 / 100);
        assertFalse(vault.paused());
    }

    function badTradeExternal(uint256 amount) external { _badTrade(amount); }

    function test_R5_02_guardianPausesAtOnce_ownerUnpauses_exitsStayOpen() public {
        _badTrade(20_000e6);
        vm.prank(guardian);
        vault.pause();
        // no more trades, no deposits
        (ShieldGuarded.Receipt memory r, bytes memory sig) = _receipt(address(router), abi.encodeCall(MockRouter.swap, (address(usdg), address(nvda), 1e6, address(vault))));
        vm.prank(manager);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.execute(address(router), abi.encodeCall(MockRouter.swap, (address(usdg), address(nvda), 1e6, address(vault))), r, sig);
        // the depositor can still leave
        uint256 shares = vault.balanceOf(user) / 2;
        vm.prank(user);
        vault.redeem(shares, user, user);
        shares = vault.balanceOf(user) / 2;
        vm.prank(user);
        vault.redeemInKind(shares, user, user);
        // the guardian cannot unpause or change anything
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        vault.unpause();
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        vault.setManager(guardian);
        // nobody else can pause
        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(0xBAD)));
        vault.pause();
        vault.unpause();
        assertFalse(vault.paused());
    }
}
