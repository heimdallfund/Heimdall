// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HeimdallStaking} from "../../contracts/HeimdallStaking.sol";
import {HeimdallFeeSplitter} from "../../contracts/HeimdallFeeSplitter.sol";
import {MockERC20} from "../../contracts/mocks/Mocks.sol";

contract FreezableUSDG2 is ERC20 {
    mapping(address => bool) public frozen;
    constructor() ERC20("Global Dollar", "USDG") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
    function freeze(address a) external { frozen[a] = true; }
    function _update(address from, address to, uint256 v) internal override {
        require(!frozen[from] && !frozen[to], "address frozen");
        super._update(from, to, v);
    }
}

/// Regression tests for review 2 (L-03, L-04, I-02, I-03). Originally PoCs; they now assert the fixed behaviour.
contract StakingSplitterRegression is Test {
    MockERC20 heim;
    FreezableUSDG2 usdg;
    HeimdallStaking staking;   // distributor = this test (direct reward tests)
    HeimdallStaking stakingS;  // distributor = the splitter
    HeimdallFeeSplitter splitter;
    address safe = address(0x5AFE);
    address treasury = address(0x7EA5);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address griefer = address(0x6EEF);

    function setUp() public {
        vm.warp(1_790_000_000);
        heim = new MockERC20("Heimdall", "HEIM", 18);
        usdg = new FreezableUSDG2();
        staking = new HeimdallStaking(heim, IERC20(address(usdg)), address(this));
        splitter = new HeimdallFeeSplitter(IERC20(address(usdg)), safe, address(0), treasury, 0);
        stakingS = new HeimdallStaking(heim, IERC20(address(usdg)), address(splitter));
        vm.prank(safe); splitter.setConfig(address(stakingS), treasury, 5_000);
        for (uint256 i; i < 2; ++i) {
            address u = i == 0 ? alice : bob;
            heim.mint(u, 1_000e18);
            vm.startPrank(u);
            heim.approve(address(staking), type(uint256).max);
            heim.approve(address(stakingS), type(uint256).max);
            vm.stopPrank();
        }
        usdg.mint(address(this), 1_000_000e6);
        usdg.approve(address(staking), type(uint256).max);
        usdg.mint(griefer, 1e6);
        vm.prank(griefer); usdg.approve(address(staking), type(uint256).max);
    }

    // L-03 fixed: only the distributor can add rewards, so nobody can restart the stream with dust.
    function test_L03_onlyDistributorCanNotify() public {
        vm.prank(alice); staking.stake(100e18);
        staking.notifyReward(7_000e6);
        vm.prank(griefer);
        vm.expectRevert(HeimdallStaking.NotDistributor.selector);
        staking.notifyReward(1);
        vm.warp(block.timestamp + 7 days);
        assertApproxEqRel(staking.earned(alice), 7_000e6, 0.001e18);
    }

    // L-03b: dust sent to the splitter still restarts the period, but a dust payout is now the protocol's own
    // daily distribution, and anyone griefing it pays the full staker share of what they donate. The splitter only
    // notifies through its own call; we check the share lands and the stream math holds.
    function test_L03b_splitterDistributesToStakers() public {
        vm.prank(alice); stakingS.stake(100e18);
        usdg.transfer(address(splitter), 1_000e6);
        splitter.distribute(IERC20(address(usdg)));
        assertEq(usdg.balanceOf(address(stakingS)), 500e6);
        assertEq(usdg.balanceOf(treasury), 500e6);
        vm.warp(block.timestamp + 7 days);
        assertApproxEqAbs(stakingS.earned(alice), 500e6, 10);
    }

    // L-04 fixed: a frozen treasury no longer blocks the stakers' share; the treasury part waits in the splitter.
    function test_L04_frozenTreasuryDoesNotBlockStakers() public {
        vm.prank(alice); stakingS.stake(100e18);
        usdg.transfer(address(splitter), 1_000e6);
        usdg.freeze(treasury);
        splitter.distribute(IERC20(address(usdg)));
        assertEq(usdg.balanceOf(address(stakingS)), 500e6, "stakers paid");
        assertEq(usdg.balanceOf(address(splitter)), 500e6, "treasury share kept for later");
    }

    // I-02 fixed: with zero stakers the stakers' share goes to the staking contract and waits for the first stakers.
    function test_I02_zeroStakersShareWaitsForStakers() public {
        usdg.transfer(address(splitter), 1_000e6);
        splitter.distribute(IERC20(address(usdg)));
        assertEq(usdg.balanceOf(address(stakingS)), 500e6);
        assertEq(usdg.balanceOf(treasury), 500e6);
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice); stakingS.stake(1); // any state change books the unstaked stretch
        assertGt(stakingS.unassigned(), 499e6);
    }

    // I-03 (accepted): USDG sent straight to the staking contract outside notifyReward is not distributed.
    function test_I03_directTransferNotDistributed() public {
        vm.prank(alice); staking.stake(100e18);
        usdg.transfer(address(staking), 500e6);
        vm.warp(block.timestamp + 30 days);
        assertEq(staking.earned(alice), 0);
    }

    // sanity: rewards earned during a zero-stake gap are kept and re-streamed; solvency holds
    function test_unassigned_roundtrip_solvent() public {
        staking.notifyReward(700e6);
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice); staking.stake(1);
        staking.notifyReward(1);
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice); staking.exit();
        assertApproxEqAbs(usdg.balanceOf(alice), 700e6 + 1, 5);
        assertLe(usdg.balanceOf(address(staking)), 5);
    }
}
