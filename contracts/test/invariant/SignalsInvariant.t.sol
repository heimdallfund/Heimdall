// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {HeimdallSignals} from "../../contracts/HeimdallSignals.sol";
import {MockERC20} from "../../contracts/mocks/Mocks.sol";

/// Random funding, withdrawals and voucher redemptions (including stale, replayed and lower vouchers).
contract SignalsHandler is Test {
    HeimdallSignals public signals;
    MockERC20 public usdg;
    uint256[3] public pks = [uint256(0xA11CE), uint256(0xB0B), uint256(0xC4A)];
    address[3] public payers;
    address public treasury;
    // highest cumulative amount each payer ever signed per signal
    mapping(address => mapping(uint256 => uint256)) public maxSigned;
    uint256 public ghostRedeemed; // USDG sent out by redeem (provider + treasury)
    uint256 public ghostFunded;
    uint256 public ghostWithdrawn;

    constructor(HeimdallSignals s, MockERC20 u, address t) {
        signals = s; usdg = u; treasury = t;
        for (uint256 i; i < 3; ++i) {
            payers[i] = vm.addr(pks[i]);
            usdg.mint(payers[i], 1e15);
            vm.prank(payers[i]);
            usdg.approve(address(signals), type(uint256).max);
        }
    }

    function fund(uint256 p, uint256 amt) external {
        address a = payers[p % 3];
        amt = bound(amt, 1, 1e10);
        vm.prank(a); signals.fund(amt);
        ghostFunded += amt;
    }

    function requestWithdraw(uint256 p, uint256 amt) external {
        address a = payers[p % 3];
        uint256 b = signals.balanceOf(a);
        if (b == 0) return;
        vm.prank(a); signals.requestWithdraw(bound(amt, 1, b));
    }

    function withdraw(uint256 p) external {
        address a = payers[p % 3];
        uint64 at = signals.withdrawableAt(a);
        if (at == 0 || block.timestamp < at || block.timestamp > at + signals.WITHDRAW_WINDOW()) return;
        uint256 amount = signals.pendingWithdrawal(a);
        if (amount > signals.balanceOf(a)) amount = signals.balanceOf(a);
        if (amount == 0) return;
        uint256 before = usdg.balanceOf(address(signals));
        vm.prank(a); signals.withdraw();
        ghostWithdrawn += before - usdg.balanceOf(address(signals));
    }

    /// Payer signs a voucher with any cumulative amount (may be lower than before: must pay nothing then).
    function redeem(uint256 p, uint256 sig, uint256 cumulative) external {
        uint256 i = p % 3;
        uint256 id = sig % 2;
        cumulative = bound(cumulative, 1, 5e10);
        HeimdallSignals.Voucher memory v = HeimdallSignals.Voucher(payers[i], id, cumulative, block.timestamp + 1 hours);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(pks[i], signals.voucherDigest(v));
        if (cumulative > maxSigned[payers[i]][id]) maxSigned[payers[i]][id] = cumulative;
        uint256 already = signals.claimed(payers[i], id);
        if (cumulative <= already || cumulative - already > signals.balanceOf(payers[i])) {
            vm.expectRevert();
            signals.redeem(v, abi.encodePacked(r, s, vv));
            return;
        }
        uint256 before = usdg.balanceOf(address(signals));
        signals.redeem(v, abi.encodePacked(r, s, vv));
        ghostRedeemed += before - usdg.balanceOf(address(signals));
    }

    function warp(uint32 dt) external { vm.warp(block.timestamp + bound(dt, 1, 3 days)); }

    function sumBalances() external view returns (uint256 s) { for (uint256 i; i < 3; ++i) s += signals.balanceOf(payers[i]); }
    function payer(uint256 i) external view returns (address) { return payers[i]; }
}

contract SignalsInvariantTest is Test {
    HeimdallSignals signals;
    MockERC20 usdg;
    SignalsHandler h;
    address treasury = address(0x7EA5);
    address payoutA = address(0x5A);
    address payoutB = address(0x5B);

    function setUp() public {
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        signals = new HeimdallSignals(usdg, address(this), treasury);
        vm.prank(address(0xA)); signals.register("a", 1e4, payoutA);
        vm.prank(address(0xB)); signals.register("b", 2e4, payoutB);
        h = new SignalsHandler(signals, usdg, treasury);
        targetContract(address(h));
    }

    /// The contract holds exactly the sum of all pre-funded balances.
    function invariant_balancesBacked() public view {
        assertEq(usdg.balanceOf(address(signals)), h.sumBalances());
    }

    /// No payer is ever charged more on a signal than the highest voucher they signed for it.
    function invariant_neverOverCharged() public view {
        for (uint256 i; i < 3; ++i) for (uint256 id; id < 2; ++id) {
            assertLe(signals.claimed(h.payer(i), id), h.maxSigned(h.payer(i), id));
        }
    }

    /// Funded = held + withdrawn + paid to providers and treasury.
    function invariant_conservation() public view {
        assertEq(h.ghostFunded(), usdg.balanceOf(address(signals)) + h.ghostWithdrawn() + h.ghostRedeemed());
        assertEq(h.ghostRedeemed(), usdg.balanceOf(payoutA) + usdg.balanceOf(payoutB) + usdg.balanceOf(treasury));
    }
}
