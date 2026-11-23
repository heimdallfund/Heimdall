// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {HeimdallPay} from "../../contracts/HeimdallPay.sol";
import {MockERC20} from "../../contracts/mocks/Mocks.sol";

/// Conservation: every job's escrow is paid out exactly once, to the last unit, on every path.
contract HeimdallPayFuzzTest is Test {
    MockERC20 usdg;
    HeimdallPay pay;
    address client = address(0xC1);
    address provider = address(0xB2);
    address arbiter = address(0xA3);
    address fees = address(0xF4);

    function setUp() public {
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        pay = new HeimdallPay(usdg, address(this), fees);
        usdg.mint(client, type(uint96).max);
        vm.prank(client);
        usdg.approve(address(pay), type(uint256).max);
    }

    function testFuzz_conservation(uint96 amount, uint16 arbFee, uint16 split, uint16 feeBps, uint8 path) public {
        amount = uint96(bound(amount, 1e6, 1e18));
        arbFee = uint16(bound(arbFee, 0, 1000));
        split = uint16(bound(split, 0, 10_000));
        pay.setFee(uint16(bound(feeBps, 0, 300)), fees);
        vm.prank(client);
        uint256 id = pay.createJob(provider, arbiter, amount, uint64(block.timestamp + 1 days), 1 hours, arbFee, bytes32(0));
        path = uint8(bound(path, 0, 3));
        if (path == 0) { vm.prank(client); pay.release(id); }
        else if (path == 1) { vm.warp(block.timestamp + 2 days); pay.refund(id); }
        else {
            vm.prank(provider); pay.submit(id, bytes32("r"));
            if (path == 2) { vm.warp(block.timestamp + 1 hours); pay.claim(id); }
            else { vm.prank(client); pay.dispute(id, "x"); vm.prank(arbiter); pay.resolve(id, split); }
        }
        // client's net outflow equals what everyone else received; nothing stays in escrow
        assertEq(usdg.balanceOf(address(pay)), 0);
        assertEq(usdg.balanceOf(provider) + usdg.balanceOf(arbiter) + usdg.balanceOf(fees), uint256(type(uint96).max) - usdg.balanceOf(client));
    }
}
