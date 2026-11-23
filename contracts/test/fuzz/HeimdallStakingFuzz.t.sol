// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {HeimdallStaking} from "../../contracts/HeimdallStaking.sol";
import {MockERC20} from "../../contracts/mocks/Mocks.sol";

/// Solvency: whatever stakers can claim never exceeds the USDG the contract holds.
contract HeimdallStakingFuzzTest is Test {
    MockERC20 heim;
    MockERC20 usdg;
    HeimdallStaking staking;
    address a = address(0xA);
    address b = address(0xB);

    function setUp() public {
        heim = new MockERC20("Heimdall", "HEIM", 18);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        staking = new HeimdallStaking(heim, usdg, address(this));
        for (uint256 i; i < 2; ++i) {
            address u = i == 0 ? a : b;
            heim.mint(u, 1e30);
            vm.prank(u);
            heim.approve(address(staking), type(uint256).max);
        }
        usdg.mint(address(this), 1e18);
        usdg.approve(address(staking), type(uint256).max);
    }

    function testFuzz_solvent(uint96 s1, uint96 s2, uint64 r1, uint64 r2, uint32 t1, uint32 t2, uint32 t3) public {
        s1 = uint96(bound(s1, 1, 1e27));
        s2 = uint96(bound(s2, 1, 1e27));
        r1 = uint64(bound(r1, 1, 1e13));
        r2 = uint64(bound(r2, 0, 1e13));
        vm.prank(a); staking.stake(s1);
        staking.notifyReward(r1);
        vm.warp(block.timestamp + bound(t1, 0, 10 days));
        vm.prank(b); staking.stake(s2);
        if (r2 > 0) staking.notifyReward(r2);
        vm.warp(block.timestamp + bound(t2, 0, 10 days));
        if (s1 > 1) { vm.prank(a); staking.withdraw(s1 / 2); }
        vm.warp(block.timestamp + bound(t3, 0, 10 days));
        assertLe(staking.earned(a) + staking.earned(b), usdg.balanceOf(address(staking)));
        vm.prank(a); staking.claim();
        vm.prank(b); staking.claim();
        assertLe(usdg.balanceOf(a) + usdg.balanceOf(b), uint256(r1) + uint256(r2));
    }
}
