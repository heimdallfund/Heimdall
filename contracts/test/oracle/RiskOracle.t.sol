// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {HeimdallRiskOracle} from "../../contracts/HeimdallRiskOracle.sol";
import {HeimdallRiskAware} from "../../contracts/HeimdallRiskAware.sol";
import {IHeimdallRisk, FLAG_DRAINER, FLAG_COMMUNITY} from "../../contracts/interfaces/IHeimdallRisk.sol";

contract Gate is HeimdallRiskAware {
    uint256 public hits;
    constructor(IHeimdallRisk o, bool failClosed) HeimdallRiskAware(o, failClosed) {}
    function enter(address who) external notBlocked(who) { hits++; }
}

contract Reverter { fallback() external { revert("no"); } }
contract GasBurner { fallback() external { while (true) {} } }

contract RiskOracleTest is Test {
    HeimdallRiskOracle oracle;
    address safe = address(0x5AFE);
    address reporter = address(0xBEEF);
    address bad = address(0xBAD);
    address ok = address(0x600D);

    function setUp() public {
        oracle = new HeimdallRiskOracle(safe);
        vm.prank(safe);
        oracle.setReporter(reporter, true);
    }

    function _one(address a, uint8 l, uint32 f) internal {
        address[] memory as_ = new address[](1); as_[0] = a;
        uint8[] memory ls = new uint8[](1); ls[0] = l;
        uint32[] memory fs = new uint32[](1); fs[0] = f;
        vm.prank(reporter);
        oracle.report(as_, ls, fs);
    }

    function test_reportAndRead() public {
        _one(bad, 3, FLAG_DRAINER | FLAG_COMMUNITY);
        (uint8 l, uint32 f, uint64 t) = oracle.riskOf(bad);
        assertEq(l, 3); assertEq(f, FLAG_DRAINER | FLAG_COMMUNITY); assertEq(t, block.timestamp);
        assertTrue(oracle.isBlocked(bad));
        assertFalse(oracle.isBlocked(ok));
        assertEq(oracle.blockedCount(), 1);
        address[] memory two = new address[](2); two[0] = ok; two[1] = bad;
        assertTrue(oracle.anyBlocked(two));
        _one(bad, 0, 0);
        assertFalse(oracle.isBlocked(bad));
        assertEq(oracle.blockedCount(), 0);
    }

    function test_onlyReporter() public {
        address[] memory a = new address[](1); uint8[] memory l = new uint8[](1); uint32[] memory f = new uint32[](1);
        vm.expectRevert(HeimdallRiskOracle.NotReporter.selector);
        oracle.report(a, l, f);
        vm.prank(safe); oracle.setReporter(reporter, false);
        vm.prank(reporter);
        vm.expectRevert(HeimdallRiskOracle.NotReporter.selector);
        oracle.report(a, l, f);
    }

    function test_validation() public {
        address[] memory a = new address[](1); uint8[] memory l = new uint8[](2); uint32[] memory f = new uint32[](1);
        vm.prank(reporter);
        vm.expectRevert(HeimdallRiskOracle.LengthMismatch.selector);
        oracle.report(a, l, f);
        vm.expectRevert(abi.encodeWithSelector(HeimdallRiskOracle.InvalidLevel.selector, 4));
        _one(bad, 4, 0);
        address[] memory big = new address[](201); uint8[] memory bl = new uint8[](201); uint32[] memory bf = new uint32[](201);
        vm.prank(reporter);
        vm.expectRevert(HeimdallRiskOracle.BatchTooLarge.selector);
        oracle.report(big, bl, bf);
    }

    function test_pinBeatsReporter() public {
        _one(ok, 3, FLAG_DRAINER); // false positive
        vm.prank(safe);
        oracle.pin(ok, 0, 0, true); // cleared for good
        _one(ok, 3, FLAG_DRAINER); // skipped, not reverted
        assertFalse(oracle.isBlocked(ok));
        assertEq(oracle.blockedCount(), 0);
        vm.prank(safe);
        oracle.pin(ok, 0, 0, false);
        _one(ok, 2, 0);
        assertEq(oracle.levelOf(ok), 2);
    }

    function test_onlyOwnerAdmin() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        oracle.setReporter(address(1), true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        oracle.pin(bad, 3, 0, true);
    }

    function test_riskAwareGate() public {
        Gate g = new Gate(oracle, false);
        _one(bad, 3, FLAG_DRAINER);
        vm.expectRevert(abi.encodeWithSelector(HeimdallRiskAware.HeimdallBlocked.selector, bad));
        g.enter(bad);
        g.enter(ok);
        _one(ok, 2, 0); // warn is not blocked
        g.enter(ok);
        assertEq(g.hits(), 2);
    }

    function test_riskAwareFailModes() public {
        for (uint256 i; i < 3; ++i) {
            IHeimdallRisk broken = i == 0 ? IHeimdallRisk(address(0x1234)) : i == 1 ? IHeimdallRisk(address(new Reverter())) : IHeimdallRisk(address(new GasBurner()));
            Gate open = new Gate(broken, false);
            Gate closed = new Gate(broken, true);
            open.enter(ok); // fail open: passes
            vm.expectRevert(abi.encodeWithSelector(HeimdallRiskAware.HeimdallBlocked.selector, ok));
            closed.enter(ok);
        }
    }

    function testFuzz_blockedCountMatches(uint8[8] memory levels, uint8[8] memory who) public {
        address[4] memory pool = [address(0xA1), address(0xA2), address(0xA3), address(0xA4)];
        for (uint256 i; i < 8; ++i) _one(pool[who[i] % 4], levels[i] % 4, 0);
        uint256 n;
        for (uint256 i; i < 4; ++i) if (oracle.isBlocked(pool[i])) n++;
        assertEq(oracle.blockedCount(), n);
    }
}
