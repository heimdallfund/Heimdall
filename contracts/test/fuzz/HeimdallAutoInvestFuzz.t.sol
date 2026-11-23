// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {HeimdallAutoInvest, ISwapRouter02} from "../../contracts/HeimdallAutoInvest.sol";
import {MockERC20, MockFeed, MockSwapRouter02} from "../../contracts/mocks/Mocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// A keeper can never take more than one `amountPerBuy`, never fill worse than the user's bound versus the oracle,
/// and never leave USDG, stock or router allowance behind beyond the accrued fee.
contract HeimdallAutoInvestFuzzTest is Test {
    MockERC20 usdg;
    MockERC20 nvda;
    MockFeed feed;
    MockSwapRouter02 router;
    HeimdallAutoInvest ai;
    address user = address(0xA11CE);
    address fees = address(0xFEE);

    function setUp() public {
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        nvda = new MockERC20("NVIDIA", "NVDA", 18);
        feed = new MockFeed(8, 134e8);
        router = new MockSwapRouter02();
        ai = new HeimdallAutoInvest(IERC20(address(usdg)), ISwapRouter02(address(router)), address(this), fees);
        ai.setAsset(address(nvda), address(feed), 500, 1 days, true);
        usdg.mint(user, type(uint96).max);
        vm.prank(user);
        usdg.approve(address(ai), type(uint256).max);
    }

    function testFuzz_boundedBuy(uint96 amount, uint64 priceUsd8, uint16 slip, int16 deviationBps) public {
        amount = uint96(bound(amount, 1e6, 1e15));
        priceUsd8 = uint64(bound(priceUsd8, 1e6, 1e14)); // $0.01 to $1,000,000
        slip = uint16(bound(slip, 0, 500));
        int256 dev = bound(int256(deviationBps), -2_000, 2_000); // router fills up to 20% better or worse than the oracle
        feed.set(int256(uint256(priceUsd8)), block.timestamp);
        uint256 oracleRate = 1e18 * 1e18 / (uint256(priceUsd8) * 1e6 / 1e8); // token raw per 1e18 USDG raw
        uint256 fillRate = oracleRate * uint256(10_000 + dev) / 10_000;
        router.setRate(address(usdg), address(nvda), fillRate);

        vm.prank(user);
        uint256 id = ai.createPlan(address(nvda), amount, 1 hours, 1, slip);
        uint256 before = usdg.balanceOf(user);

        uint256 swapIn = amount - uint256(amount) * 25 / 10_000;
        uint256 price = uint256(priceUsd8) * 1e6 / 1e8;
        uint256 minOut = swapIn * 1e18 / price * (10_000 - slip) / 10_000;
        uint256 expectedOut = swapIn * fillRate / 1e18;

        try ai.execute(id) returns (uint256 out) {
            assertGe(out, minOut, "filled worse than the bound");
            assertEq(out, expectedOut);
            assertEq(before - usdg.balanceOf(user), amount, "took more or less than one buy");
            assertEq(nvda.balanceOf(user), out, "stock not sent to the user");
            assertEq(usdg.balanceOf(address(ai)), ai.accruedFees(), "USDG left beyond fees");
            assertEq(nvda.balanceOf(address(ai)), 0);
            assertEq(usdg.allowance(address(ai), address(router)), 0, "router allowance left");
        } catch {
            // Liveness: a fill that meets the bound must not be refused.
            assertLt(expectedOut, minOut, "refused a fill within the bound");
            assertEq(usdg.balanceOf(user), before);
        }
    }

    function testFuzz_staleOracleNeverBuys(uint32 age) public {
        age = uint32(bound(age, 1 days + 1, 365 days));
        vm.warp(400 days);
        feed.set(134e8, block.timestamp - age);
        router.setRate(address(usdg), address(nvda), uint256(1e30) / 134);
        vm.prank(user);
        uint256 id = ai.createPlan(address(nvda), 100e6, 1 hours, 1, 100);
        vm.expectRevert(HeimdallAutoInvest.OracleUnavailable.selector);
        ai.execute(id);
    }
}
