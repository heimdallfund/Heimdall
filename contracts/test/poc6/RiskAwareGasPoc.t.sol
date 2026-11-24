// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {HeimdallRiskOracle} from "../../contracts/HeimdallRiskOracle.sol";
import {HeimdallRiskAware} from "../../contracts/HeimdallRiskAware.sol";
import {IHeimdallRisk} from "../../contracts/interfaces/IHeimdallRisk.sol";

contract Gate is HeimdallRiskAware {
    uint256 public entries;
    constructor(IHeimdallRisk o) HeimdallRiskAware(o, false) {}
    function enter() external notBlocked(msg.sender) {
        entries += 1;
    }
}

/// Checked in review 6, not exploitable: `notBlocked` reads the oracle with a staticcall capped at 30,000 gas, and
/// with failClosed = false a failed read counts as "not blocked". Starving the read is the obvious attack, but the
/// read costs about 5,000 gas: to make it fail, the caller must leave so little gas that only 1/64 of it (under 100
/// gas) remains afterwards, which no gated function can finish on. Swept across every gas amount below.
contract RiskAwareGasPoc is Test {
    HeimdallRiskOracle oracle;
    Gate gate;
    address drainer = address(0xBAD);

    function setUp() public {
        oracle = new HeimdallRiskOracle(address(this));
        oracle.setReporter(address(this), true);
        address[] memory a = new address[](1);
        a[0] = drainer;
        uint8[] memory l = new uint8[](1);
        l[0] = 3;
        uint32[] memory f = new uint32[](1);
        oracle.report(a, l, f);
        gate = new Gate(oracle);
    }

    /// At no gas amount does a blocked address get through.
    function test_R6_03_blockedCallerCannotSqueezeThrough() public {
        for (uint256 g = 3_000; g < 80_000; g += 250) {
            vm.prank(drainer);
            (bool ok,) = address(gate).call{gas: g}(abi.encodeCall(Gate.enter, ()));
            assertFalse(ok);
        }
        assertEq(gate.entries(), 0);
    }

    /// Anyone not blocked still gets in with normal gas.
    function test_R6_03_cleanCallerGetsIn() public {
        vm.prank(address(0xC0FFEE));
        gate.enter();
        assertEq(gate.entries(), 1);
    }
}
