// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {HeimdallVault} from "../../contracts/HeimdallVault.sol";
import {HeimdallSignals} from "../../contracts/HeimdallSignals.sol";
import {ShieldGuarded} from "../../contracts/ShieldGuarded.sol";
import {MockERC20, MockFeed, MockRouter} from "../../contracts/mocks/Mocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Property-based tests for the vault guard, fee accounting and voucher accounting.
contract HeimdallFuzzTest is Test {
    uint256 constant SHIELD_PK = 0xA11CE;
    address manager = address(0xBEEF);
    address user = address(0xCAFE);
    address user2 = address(0xD00D);
    address fees = address(0xFEE);
    MockERC20 usdg;
    MockERC20 nvda;
    MockFeed feed;
    MockRouter router;
    HeimdallVault vault;
    uint256 nonce;

    function setUp() public {
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        nvda = new MockERC20("NVIDIA", "NVDA", 18);
        feed = new MockFeed(8, 100e8);
        router = new MockRouter();
        router.setRate(address(usdg), address(nvda), 1e28);
        vault = _newVault();
        usdg.mint(user, 1e15);
        usdg.mint(user2, 1e15);
        vm.prank(user);
        usdg.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        usdg.approve(address(vault), type(uint256).max);
    }

    function _newVault() internal returns (HeimdallVault) {
        HeimdallVault.CallPerm[] memory calls = new HeimdallVault.CallPerm[](1);
        calls[0] = HeimdallVault.CallPerm(address(router), MockRouter.swap.selector);
        address[] memory spenders = new address[](1);
        spenders[0] = address(router);
        HeimdallVault.AssetInit[] memory assets = new HeimdallVault.AssetInit[](1);
        assets[0] = HeimdallVault.AssetInit(address(nvda), address(feed), 7 days);
        return new HeimdallVault(
            HeimdallVault.InitConfig({
                baseAsset: IERC20(address(usdg)),
                name: "Fuzz",
                symbol: "hFZ",
                owner: address(this),
                manager: manager,
                feeRecipient: fees,
                shieldSigner: vm.addr(SHIELD_PK), guardian: address(0),
                maxTradeBps: 2500,
                maxLossBps: 300,
                maxDailyLossBps: 500,
                depositCap: type(uint256).max,
                heimToken: address(0),
                holderMin: 0,
                calls: calls,
                spenders: spenders,
                assets: assets
            })
        );
    }

    function _exec(address target, bytes memory data) internal returns (bool ok) {
        ShieldGuarded.Receipt memory r = ShieldGuarded.Receipt({
            agent: address(vault),
            target: target,
            dataHash: keccak256(data),
            value: 0,
            verdict: 0,
            expiresAt: uint64(block.timestamp + 120),
            checkId: keccak256(abi.encode("fuzz", ++nonce))
        });
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(SHIELD_PK, vault.receiptDigest(r));
        vm.prank(manager);
        try vault.execute(target, data, r, abi.encodePacked(rr, s, v)) {
            ok = true;
        } catch {
            ok = false;
        }
    }

    /// The manager can never create an allowance on a token to anyone but an allowed spender,
    /// whatever selector and arguments it uses.
    function testFuzz_tokenCallsCannotGrantAllowance(bytes4 sel, address spender, uint256 amount) public {
        vm.assume(spender != address(router) && spender != address(0));
        vm.prank(user);
        vault.deposit(1_000e6, user);
        bool ok = _exec(address(usdg), abi.encodeWithSelector(sel, spender, amount));
        if (ok) assertTrue(sel == IERC20.approve.selector && amount == 0, "only approve(x, 0) may pass");
        assertEq(usdg.allowance(address(vault), spender), 0);
        assertEq(usdg.balanceOf(address(vault)), 1_000e6);
    }

    /// Arbitrary calls to arbitrary non-allowlisted targets always revert.
    function testFuzz_unknownTargetsRevert(address target, bytes memory data) public {
        vm.assume(target != address(router) && target != address(usdg) && target != address(nvda));
        assertFalse(_exec(target, data));
    }

    /// Donations to an empty vault never become a fee, and the depositor keeps (almost) all of it.
    function testFuzz_noFeeOnDonation(uint256 donation, uint256 dep) public {
        donation = bound(donation, 0, 1e12);
        dep = bound(dep, 1e6, 1e12);
        usdg.mint(manager, donation);
        vm.prank(manager);
        usdg.transfer(address(vault), donation);
        vm.prank(user);
        vault.deposit(dep, user);
        vault.harvest();
        assertEq(vault.balanceOf(manager), 0);
        assertEq(vault.balanceOf(fees), 0);
        // Share rounding can cost the depositor a little, but griefing costs the donor a million times more
        // (decimals offset 6): loss * 1e6 <= donation + 1e6.
        uint256 value = vault.convertToAssets(vault.balanceOf(user));
        uint256 loss = value >= dep ? 0 : dep - value;
        assertLe(loss * 1e6, donation + 1e6);
    }

    /// Deposit then redeem never returns more than was deposited.
    function testFuzz_roundTripNoProfit(uint256 a, uint256 b) public {
        a = bound(a, 1, 1e13);
        b = bound(b, 1, 1e13);
        vm.prank(user2);
        vault.deposit(b, user2);
        uint256 before = usdg.balanceOf(user);
        vm.startPrank(user);
        uint256 shares = vault.deposit(a, user);
        vault.redeem(shares, user, user);
        vm.stopPrank();
        assertLe(usdg.balanceOf(user), before);
    }

    /// In-kind exits pay each holder at most their pro-rata share and never touch other holders' value.
    function testFuzz_inKindProRata(uint256 a, uint256 b) public {
        a = bound(a, 1e6, 1e12);
        b = bound(b, 1e6, 1e12);
        vm.prank(user);
        uint256 sa = vault.deposit(a, user);
        vm.prank(user2);
        vault.deposit(b, user2);
        uint256 before = usdg.balanceOf(user);
        vm.prank(user);
        vault.redeemInKind(sa, user, user);
        assertLe(usdg.balanceOf(user) - before, a);
        assertGe(vault.convertToAssets(vault.balanceOf(user2)) + 1, b);
    }
}

contract SignalsFuzzTest is Test {
    uint256 constant PAYER_PK = 0xB0B;
    MockERC20 usdg;
    HeimdallSignals signals;
    address payer;
    address provider = address(0x9999);
    address treasury = address(0x7777);

    function setUp() public {
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        signals = new HeimdallSignals(IERC20(address(usdg)), address(this), treasury);
        vm.prank(provider);
        signals.register("sig", 1e4, provider);
        payer = vm.addr(PAYER_PK);
        usdg.mint(payer, 1e12);
        vm.prank(payer);
        usdg.approve(address(signals), type(uint256).max);
    }

    function _sign(uint256 cumulative) internal view returns (HeimdallSignals.Voucher memory v, bytes memory sig) {
        v = HeimdallSignals.Voucher(payer, 0, cumulative, block.timestamp + 1 hours);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(PAYER_PK, signals.voucherDigest(v));
        sig = abi.encodePacked(r, s, vv);
    }

    /// However vouchers are redeemed, the provider side never receives more than the highest cumulative
    /// amount signed, and funded = balance + paid out.
    function testFuzz_vouchersNeverOverpay(uint256 funded, uint256 c1, uint256 c2) public {
        funded = bound(funded, 1, 1e12);
        c1 = bound(c1, 1, 2e12);
        c2 = bound(c2, 1, 2e12);
        vm.prank(payer);
        signals.fund(funded);
        (HeimdallSignals.Voucher memory v1, bytes memory s1) = _sign(c1);
        (HeimdallSignals.Voucher memory v2, bytes memory s2) = _sign(c2);
        try signals.redeem(v1, s1) {} catch {}
        try signals.redeem(v2, s2) {} catch {}
        try signals.redeem(v1, s1) {} catch {}
        uint256 out = usdg.balanceOf(provider) + usdg.balanceOf(treasury);
        assertLe(out, c1 > c2 ? c1 : c2);
        assertEq(signals.balanceOf(payer) + out, funded);
        assertEq(usdg.balanceOf(address(signals)), signals.balanceOf(payer));
    }
}
