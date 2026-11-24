// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HeimdallStaking} from "../../contracts/HeimdallStaking.sol";
import {HeimdallFeeSplitter} from "../../contracts/HeimdallFeeSplitter.sol";
import {MockERC20} from "../../contracts/mocks/Mocks.sol";

/// R6-02: review 2 restricted notifyReward to the splitter, but the splitter's `distribute` is open to anyone, so
/// 2 raw units of USDG (0.000002 USDG) plus one call still restarts the 7-day stream. Done every hour, it pushes a
/// large part of a week's rewards out past the week, to whoever is staked later.
contract SplitterStretchPoc is Test {
    MockERC20 heim;
    MockERC20 usdg;
    HeimdallStaking staking;
    HeimdallFeeSplitter splitter;
    address alice = address(0xA11CE);
    address griefer = address(0x6EEF);

    function setUp() public {
        vm.warp(1_790_000_000);
        heim = new MockERC20("Heimdall", "HEIM", 18);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        splitter = new HeimdallFeeSplitter(IERC20(address(usdg)), address(this), address(0), address(0x7EA5), 0);
        staking = new HeimdallStaking(heim, IERC20(address(usdg)), address(splitter));
        splitter.setConfig(address(staking), address(0x7EA5), 5_000);
        heim.mint(alice, 100e18);
        vm.startPrank(alice);
        heim.approve(address(staking), type(uint256).max);
        staking.stake(100e18);
        vm.stopPrank();
        usdg.mint(address(splitter), 14_000e6); // 7,000 USDG for stakers
        splitter.distribute(IERC20(address(usdg)));
        usdg.mint(griefer, 1e6);
    }

    function _grief() internal {
        vm.prank(griefer);
        usdg.transfer(address(splitter), 2);
        splitter.distribute(IERC20(address(usdg)));
    }

    /// Fixed: staker payouts are at most daily (the keeper's own pace), so dust calls in between change nothing.
    /// Before the fix, hourly dust over a week cut Alice's week of rewards from 7,000 to 4,433 USDG.
    function test_R6_02_dustBetweenDailyPayoutsChangesNothing() public {
        uint256 finish = staking.periodFinish();
        uint256 rate = staking.rewardRate();
        for (uint256 h; h < 23; ++h) {
            vm.warp(block.timestamp + 1 hours);
            _grief();
        }
        assertEq(staking.periodFinish(), finish);
        assertEq(staking.rewardRate(), rate);
        assertEq(usdg.balanceOf(address(splitter)), 46); // the dust waits for the next daily payout
    }

    /// The daily distribution itself still goes through.
    function test_R6_02_dailyDistributionStillWorks() public {
        vm.warp(block.timestamp + 1 days);
        usdg.mint(address(splitter), 2_000e6);
        splitter.distribute(IERC20(address(usdg)));
        assertEq(usdg.balanceOf(address(staking)), 8_000e6);
    }
}
