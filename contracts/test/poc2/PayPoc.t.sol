// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HeimdallPay} from "../../contracts/HeimdallPay.sol";

/// @notice Paxos-style token: an asset-protection role can freeze addresses; frozen addresses can neither send nor receive.
contract FreezableUSDG is ERC20 {
    mapping(address => bool) public frozen;
    constructor() ERC20("Global Dollar", "USDG") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
    function freeze(address a) external { frozen[a] = true; }
    function unfreeze(address a) external { frozen[a] = false; }
    function _update(address from, address to, uint256 v) internal override {
        require(!frozen[from] && !frozen[to], "address frozen");
        super._update(from, to, v);
    }
}

/// Regression tests for review 2 (M-01, L-01, L-02, I-01). Originally PoCs; they now assert the fixed behaviour.
contract PayRegression is Test {
    FreezableUSDG usdg;
    HeimdallPay pay;
    address owner = address(0x0A);
    address client = address(0xC1);
    address provider = address(0xB2);
    address arbiter = address(0xA3);
    address fees = address(0xF4);
    address clientPuppet = address(0xC2);
    address stranger = address(0x5);

    function setUp() public {
        vm.warp(1_790_000_000);
        usdg = new FreezableUSDG();
        pay = new HeimdallPay(usdg, owner, fees);
        usdg.mint(client, 1_000_000e6);
        vm.prank(client);
        usdg.approve(address(pay), type(uint256).max);
    }

    function _job(address arb, uint16 arbFee, uint96 amount) internal returns (uint256 id) {
        vm.prank(client);
        id = pay.createJob(provider, arb, amount, uint64(block.timestamp + 1 days), 2 hours, arbFee, bytes32("spec"));
    }

    function _held() internal view returns (uint256) { return usdg.balanceOf(address(pay)); }

    // M-01a fixed: a silent arbiter is bypassed after DISPUTE_TIMEOUT; the escrow splits 50/50 without arbiter fee.
    function test_M01a_silentArbiterTimesOut() public {
        uint256 id = _job(arbiter, 500, 1_000e6);
        vm.prank(provider); pay.submit(id, bytes32("work"));
        vm.prank(client); pay.dispute(id, "meh");
        vm.expectRevert(HeimdallPay.TooEarly.selector); pay.settleExpiredDispute(id);
        vm.warp(block.timestamp + 14 days);
        vm.prank(stranger); pay.settleExpiredDispute(id);
        assertEq(usdg.balanceOf(provider), 495e6);       // 500 − 1% fee
        assertEq(usdg.balanceOf(fees), 5e6);
        assertEq(usdg.balanceOf(arbiter), 0);
        assertEq(_held(), 0);
    }

    // M-01b fixed: a frozen arbiter's fee is deferred, so resolve goes through.
    function test_M01b_frozenArbiterCanStillResolve() public {
        uint256 id = _job(arbiter, 100, 1_000e6);
        vm.prank(provider); pay.submit(id, bytes32("work"));
        vm.prank(client); pay.dispute(id, "meh");
        usdg.freeze(arbiter);
        vm.prank(arbiter); pay.resolve(id, 5_000);
        assertEq(pay.owed(arbiter), 10e6);
        assertEq(_held(), pay.totalOwed());
    }

    // M-01c (mitigated, not removable onchain): the client picks the arbiter, so the provider must check it before
    // working. Submitting is acceptance of that arbiter; the UI, SDK and MCP show the arbiter before work starts.
    function test_M01c_arbiterIsVisibleBeforeSubmitting() public {
        uint256 id = _job(clientPuppet, 1_000, 1_000e6);
        assertEq(pay.getJob(id).arbiter, clientPuppet);
        vm.prank(provider); pay.cancel(id); // provider declines a job whose arbiter it does not trust
        assertEq(usdg.balanceOf(client), 1_000_000e6);
    }

    // L-01a fixed: a frozen fee recipient no longer blocks payouts; its fee is deferred.
    function test_L01a_frozenFeeRecipientDoesNotBlock() public {
        uint256 a = _job(arbiter, 0, 100e6);
        vm.prank(provider); pay.submit(a, bytes32("r"));
        usdg.freeze(fees);
        vm.prank(client); pay.release(a);
        assertEq(usdg.balanceOf(provider), 99e6);
        assertEq(pay.owed(fees), 1e6);
    }

    // L-01b fixed: a frozen provider's payout is deferred instead of locking the job; it can pull once unfrozen.
    function test_L01b_frozenProviderPayoutDeferred() public {
        uint256 id = _job(address(0), 0, 500e6);
        vm.prank(provider); pay.submit(id, bytes32("r"));
        usdg.freeze(provider);
        vm.warp(block.timestamp + 2 hours);
        pay.claim(id);
        assertEq(pay.owed(provider), 495e6);
        usdg.unfreeze(provider);
        vm.prank(provider); pay.withdrawOwed();
        assertEq(usdg.balanceOf(provider), 495e6);
        assertEq(pay.totalOwed(), 0);
    }

    // L-01c fixed: frozen parties no longer constrain the arbiter's split.
    function test_L01c_frozenPartiesDoNotBlockArbiter() public {
        uint256 id = _job(arbiter, 0, 500e6);
        vm.prank(provider); pay.submit(id, bytes32("r"));
        vm.prank(client); pay.dispute(id, "x");
        usdg.freeze(provider); usdg.freeze(client);
        vm.prank(arbiter); pay.resolve(id, 5_000);
        assertEq(_held(), pay.totalOwed());
    }

    // L-02 fixed: jobs below 1 USDG are rejected, so every completed job pays a non-zero fee.
    function test_L02_dustJobsRejected() public {
        vm.prank(client);
        vm.expectRevert(HeimdallPay.InvalidConfig.selector);
        pay.createJob(provider, address(0), 99, uint64(block.timestamp + 1 days), 1 hours, 0, bytes32(0));
        uint256 id = _job(address(0), 0, 1e6);
        vm.prank(client); pay.release(id);
        assertEq(usdg.balanceOf(fees), 1e4); // 0.01 USDG
    }

    // I-01 (accepted): anyone can refund an expired Open job.
    function test_I01_strangerRefundsExpiredOpenJob() public {
        uint256 id = _job(address(0), 0, 100e6);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(stranger); pay.refund(id);
        assertEq(usdg.balanceOf(client), 1_000_000e6);
    }

    // boundary sanity: deadline/review boundaries are consistent
    function test_boundaries_consistent() public {
        uint256 id = _job(arbiter, 0, 100e6);
        HeimdallPay.Job memory j = pay.getJob(id);
        vm.warp(j.deadline);
        vm.expectRevert(HeimdallPay.TooEarly.selector); pay.refund(id);
        vm.prank(provider); pay.submit(id, bytes32("r"));
        vm.warp(block.timestamp + 2 hours - 1);
        vm.expectRevert(HeimdallPay.TooEarly.selector); pay.claim(id);
        vm.warp(block.timestamp + 1);
        vm.prank(client); vm.expectRevert(HeimdallPay.TooLate.selector); pay.dispute(id, "x");
        pay.claim(id);
    }
}
