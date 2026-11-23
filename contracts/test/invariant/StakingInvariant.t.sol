// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {HeimdallStaking} from "../../contracts/HeimdallStaking.sol";
import {HeimdallFeeSplitter} from "../../contracts/HeimdallFeeSplitter.sol";
import {MockERC20} from "../../contracts/mocks/Mocks.sol";

/// Random stakes, withdrawals, claims, exits, fee distributions and time jumps.
contract StakingHandler is Test {
    HeimdallStaking public staking;
    HeimdallFeeSplitter public splitter;
    MockERC20 public heim;
    MockERC20 public usdg;
    address[4] public actors = [address(0x2001), address(0x2002), address(0x2003), address(0x2004)];
    uint256 public ghostRewardsIn;
    uint256 public ghostClaimed;

    constructor(HeimdallStaking s, HeimdallFeeSplitter sp, MockERC20 h, MockERC20 u) {
        staking = s; splitter = sp; heim = h; usdg = u;
        for (uint256 i; i < 4; ++i) {
            heim.mint(actors[i], 1e27);
            vm.prank(actors[i]);
            heim.approve(address(staking), type(uint256).max);
        }
    }

    function stake(uint256 a, uint256 amt) external {
        address u = actors[a % 4];
        if (heim.balanceOf(u) == 0) return;
        amt = bound(amt, 1, heim.balanceOf(u));
        vm.prank(u); staking.stake(amt);
    }

    function withdraw(uint256 a, uint256 amt) external {
        address u = actors[a % 4];
        uint256 s = staking.stakedOf(u);
        if (s == 0) return;
        vm.prank(u); staking.withdraw(bound(amt, 1, s));
    }

    function claim(uint256 a) external {
        address u = actors[a % 4];
        uint256 b = usdg.balanceOf(u);
        vm.prank(u); staking.claim();
        ghostClaimed += usdg.balanceOf(u) - b;
    }

    function exit(uint256 a) external {
        address u = actors[a % 4];
        uint256 b = usdg.balanceOf(u);
        vm.prank(u); staking.exit();
        ghostClaimed += usdg.balanceOf(u) - b;
    }

    /// Protocol fees arrive at the splitter and are distributed (anyone can call distribute).
    function distribute(uint256 amt) external {
        amt = bound(amt, 2, 1e12);
        usdg.mint(address(splitter), amt);
        uint256 b = usdg.balanceOf(address(staking));
        splitter.distribute(usdg);
        ghostRewardsIn += usdg.balanceOf(address(staking)) - b;
    }

    function warp(uint32 dt) external { vm.warp(block.timestamp + bound(dt, 1, 10 days)); }

    function sumStaked() external view returns (uint256 s) { for (uint256 i; i < 4; ++i) s += staking.stakedOf(actors[i]); }
    function sumEarned() external view returns (uint256 s) { for (uint256 i; i < 4; ++i) s += staking.earned(actors[i]); }
}

contract StakingInvariantTest is Test {
    HeimdallStaking staking;
    HeimdallFeeSplitter splitter;
    MockERC20 heim;
    MockERC20 usdg;
    StakingHandler h;

    function setUp() public {
        heim = new MockERC20("Heimdall", "HEIM", 18);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        splitter = new HeimdallFeeSplitter(usdg, address(this), address(0), address(0x7EA), 0);
        staking = new HeimdallStaking(heim, usdg, address(splitter));
        splitter.setConfig(address(staking), address(0x7EA), 5000);
        h = new StakingHandler(staking, splitter, heim, usdg);
        targetContract(address(h));
    }

    /// Every staked HEIM is held, and the books add up per user.
    function invariant_heimBacked() public view {
        assertEq(heim.balanceOf(address(staking)), staking.totalStaked());
        assertEq(h.sumStaked(), staking.totalStaked());
    }

    /// Stakers can never claim more USDG than the contract holds.
    function invariant_rewardsSolvent() public view {
        assertGe(usdg.balanceOf(address(staking)), h.sumEarned() + staking.unassigned());
    }

    /// Claimed rewards never exceed rewards that came in.
    function invariant_noRewardCreation() public view {
        assertLe(h.ghostClaimed(), h.ghostRewardsIn());
        assertEq(usdg.balanceOf(address(staking)), h.ghostRewardsIn() - h.ghostClaimed());
    }
}
