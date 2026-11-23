// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GuardBase} from "../guard/GuardModule.t.sol";
import {ShieldGuarded} from "../../contracts/ShieldGuarded.sol";
import {HeimdallGuardModule} from "../../contracts/HeimdallGuardModule.sol";

/// A compromised agent (with every Shield receipt granted) tries transfers, approvals, pulls and ETH sends.
contract GuardHandler {
    GuardInvariantTest t;
    constructor(GuardInvariantTest t_) { t = t_; }
    function transfer(uint256 amt) external { t.agentTry(0, amt); }
    function approve(uint256 amt) external { t.agentTry(1, amt); }
    function pull(uint256 amt) external { t.agentTry(2, amt); }
    function sendEth(uint256 amt) external { t.agentTry(3, amt); }
    function warp(uint256 dt) external { t.warpBy(dt); }
}

contract GuardInvariantTest is GuardBase {
    GuardHandler h;
    address thief = address(0x7E1F);
    uint64 windowStart;
    uint256 usdgAtWindow;
    uint256 ethAtWindow;
    uint256 public succeeded;

    function setUp() public override {
        super.setUp();
        usdg.mint(address(safe), 1_000_000e6);
        vm.deal(address(safe), 1_000 ether);
        h = new GuardHandler(this);
        targetContract(address(h));
        _startWindow();
    }

    function _startWindow() internal {
        windowStart = uint64(block.timestamp);
        usdgAtWindow = usdg.balanceOf(address(safe)) - usdg.allowance(address(safe), thief);
        ethAtWindow = address(safe).balance;
    }

    function warpBy(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 2 days));
        (uint64 start,) = module.windowOf(address(safe), address(usdg));
        (uint64 estart,) = module.windowOf(address(safe), address(0));
        if (block.timestamp >= uint256(windowStart) + 1 days && start < block.timestamp && estart < block.timestamp) {
            // a new window may start with the next spend; measure from here
            if (block.timestamp >= uint256(start) + 1 days && block.timestamp >= uint256(estart) + 1 days) _startWindow();
        }
    }

    function agentTry(uint8 kind, uint256 amt) external {
        amt = bound(amt, 0, kind == 3 ? 2 ether : 1_500e6);
        address to = kind == 3 ? thief : address(usdg);
        uint256 value = kind == 3 ? amt : 0;
        bytes memory data = kind == 0 ? abi.encodeCall(usdg.transfer, (thief, amt))
            : kind == 1 ? abi.encodeCall(usdg.approve, (thief, amt))
            : kind == 2 ? abi.encodeWithSignature("transferFrom(address,address,uint256)", address(safe), thief, amt)
            : bytes("");
        (ShieldGuarded.Receipt memory r, bytes memory sig) = _receipt(to, value, data, 0, SHIELD_PK);
        vm.prank(agent);
        try module.execute(address(safe), to, value, data, r, sig) { succeeded++; } catch {}
        // the thief also uses any allowance it got, outside the module
        uint256 al = usdg.allowance(address(safe), thief);
        if (al > 0) { vm.prank(thief); usdg.transferFrom(address(safe), thief, al); }
    }

    /// USDG that left the Safe (or is approved away) since the window began never exceeds the daily token limit
    /// times the windows that could have started since; ETH likewise.
    function invariant_lossBoundedByLimits() public view {
        uint256 windows = (block.timestamp - windowStart) / 1 days + 2; // a window open at the start, plus new ones
        uint256 usdgNow = usdg.balanceOf(address(safe)) - usdg.allowance(address(safe), thief);
        assertLe(usdgAtWindow - usdgNow, windows * 1_000e6);
        assertLe(ethAtWindow - address(safe).balance, windows * 1 ether);
    }

    /// Within the module's own bookkeeping, spent never exceeds the limit.
    function invariant_spentWithinLimit() public view {
        (, uint192 spent) = module.windowOf(address(safe), address(usdg));
        (, uint192 espent) = module.windowOf(address(safe), address(0));
        assertLe(spent, 1_000e6);
        assertLe(espent, 1 ether);
    }
}
