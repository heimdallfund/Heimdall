// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HeimdallVault} from "../../contracts/HeimdallVault.sol";
import {MockERC20, MockFeed} from "../../contracts/mocks/Mocks.sol";

/// Review 3, V-01: with a performance fee pending (profit above the high-water mark, not yet harvested),
/// previews and max* limits must already account for the fee shares the call will mint.
contract Vault4626FuzzTest is Test {
    MockERC20 usdg;
    MockERC20 nvda;
    MockFeed feed;
    HeimdallVault vault;
    address user = address(0xCAFE);

    function setUp() public {
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        nvda = new MockERC20("NVIDIA", "NVDA", 18);
        feed = new MockFeed(8, 100e8);
        HeimdallVault.CallPerm[] memory calls = new HeimdallVault.CallPerm[](0);
        address[] memory spenders = new address[](0);
        HeimdallVault.AssetInit[] memory assets = new HeimdallVault.AssetInit[](1);
        assets[0] = HeimdallVault.AssetInit(address(nvda), address(feed), 7 days);
        vault = new HeimdallVault(HeimdallVault.InitConfig({
            baseAsset: IERC20(address(usdg)), name: "V", symbol: "hV", owner: address(this), manager: address(0xBEEF),
            feeRecipient: address(0xFEE), shieldSigner: address(0x5), maxTradeBps: 2500, maxLossBps: 300, maxDailyLossBps: 500,
            depositCap: type(uint256).max, heimToken: address(0), holderMin: 0, calls: calls, spenders: spenders, assets: assets
        }));
        usdg.mint(user, 1e15);
        vm.prank(user);
        usdg.approve(address(vault), type(uint256).max);
    }

    /// Deposit, then the vault gains value (NVDA position rises), leaving a fee pending.
    function _withPendingFee(uint256 dep, uint256 gainBps) internal {
        dep = bound(dep, 1e6, 1e12);
        vm.prank(user);
        vault.deposit(dep, user);
        nvda.mint(address(vault), dep * 1e12 / 100 / 2); // NVDA worth half the deposit at $100
        feed.set(int256(100e8 * (10_000 + bound(gainBps, 1, 50_000)) / 10_000), block.timestamp);
    }

    function testFuzz_withdrawMaxNeverReverts(uint256 dep, uint256 gainBps) public {
        _withPendingFee(dep, gainBps);
        uint256 m = vault.maxWithdraw(user);
        vm.assume(m > 0);
        vm.prank(user);
        vault.withdraw(m, user, user);
    }

    function testFuzz_redeemMaxNeverReverts(uint256 dep, uint256 gainBps) public {
        _withPendingFee(dep, gainBps);
        uint256 m = vault.maxRedeem(user);
        vm.assume(m > 0);
        vm.prank(user);
        vault.redeem(m, user, user);
    }

    /// previewRedeem may not promise more than redeem pays; previewDeposit may not promise more shares than deposit mints.
    function testFuzz_previewsExact(uint256 dep, uint256 gainBps, uint256 frac) public {
        _withPendingFee(dep, gainBps);
        uint256 shares = vault.maxRedeem(user) * bound(frac, 1, 100) / 100;
        vm.assume(shares > 0);
        uint256 promised = vault.previewRedeem(shares);
        uint256 before = usdg.balanceOf(user);
        vm.prank(user);
        vault.redeem(shares, user, user);
        assertEq(usdg.balanceOf(user) - before, promised);

        feed.set(int256(feed.answer() * 2), block.timestamp); // new pending fee
        uint256 promisedShares = vault.previewDeposit(1e6);
        vm.prank(user);
        assertEq(vault.deposit(1e6, user), promisedShares);
    }
}
