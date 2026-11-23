// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/src/Test.sol";
import {Safe} from "@safe-global/safe-contracts/contracts/Safe.sol";
import {SafeProxyFactory} from "@safe-global/safe-contracts/contracts/proxies/SafeProxyFactory.sol";
import {SafeProxy} from "@safe-global/safe-contracts/contracts/proxies/SafeProxy.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";
import {HeimdallGuardModule} from "../../contracts/HeimdallGuardModule.sol";
import {ShieldGuarded} from "../../contracts/ShieldGuarded.sol";
import {MockERC20} from "../../contracts/mocks/Mocks.sol";

contract Sink { receive() external payable {} function ping() external payable returns (uint256) { return 42; } }

/// Base: a real Safe 1.4.1 (one human owner) with the module enabled and an agent configured.
contract GuardBase is Test {
    uint256 constant SHIELD_PK = 0xA11CE;
    uint256 constant OTHER_PK = 0xB0B;
    address owner = address(0x0A11);
    address agent = address(0xA6E7);
    address heimdall = address(0x4E1D);
    Safe safe;
    HeimdallGuardModule module;
    MockERC20 usdg;
    MockERC20 nvda;
    Sink sink;
    uint256 nonce;

    function setUp() public virtual {
        Safe singleton = new Safe();
        SafeProxyFactory factory = new SafeProxyFactory();
        address[] memory owners = new address[](1);
        owners[0] = owner;
        bytes memory init = abi.encodeCall(Safe.setup, (owners, 1, address(0), "", address(0), address(0), 0, payable(address(0))));
        safe = Safe(payable(address(factory.createProxyWithNonce(address(singleton), init, 1))));
        module = new HeimdallGuardModule(heimdall, vm.addr(SHIELD_PK));
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        nvda = new MockERC20("NVIDIA", "NVDA", 18);
        sink = new Sink();
        usdg.mint(address(safe), 5_000e6);
        nvda.mint(address(safe), 100e18);
        vm.deal(address(safe), 10 ether);

        _ownerExec(address(safe), abi.encodeCall(safe.enableModule, (address(module))));
        _ownerExec(address(module), abi.encodeCall(module.setAgent, (agent, true, 0)));
        _ownerExec(address(module), abi.encodeCall(module.setPolicy, (1 ether, false, false)));
        _ownerExec(address(module), abi.encodeCall(module.setTokenLimit, (address(usdg), 1_000e6, true)));
    }

    /// The human owner signs a Safe transaction (threshold 1, pre-validated signature: msg.sender is the owner).
    function _ownerExec(address to, bytes memory data) internal {
        bytes memory sig = abi.encodePacked(uint256(uint160(owner)), bytes32(0), uint8(1));
        vm.prank(owner);
        bool ok = safe.execTransaction(to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), sig);
        require(ok, "owner exec failed");
    }

    function _receipt(address to, uint256 value, bytes memory data, uint8 verdict, uint256 pk)
        internal
        returns (ShieldGuarded.Receipt memory r, bytes memory sig)
    {
        r = ShieldGuarded.Receipt(address(safe), to, keccak256(data), value, verdict, uint64(block.timestamp + 120), keccak256(abi.encode("guard", ++nonce)));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, module.receiptDigest(r));
        sig = abi.encodePacked(rr, s, v);
    }

    function _agentExec(address to, uint256 value, bytes memory data) internal returns (bytes memory) {
        (ShieldGuarded.Receipt memory r, bytes memory sig) = _receipt(to, value, data, 0, SHIELD_PK);
        vm.prank(agent);
        return module.execute(address(safe), to, value, data, r, sig);
    }

    function _agentExecExpect(address to, uint256 value, bytes memory data, bytes memory err) internal {
        (ShieldGuarded.Receipt memory r, bytes memory sig) = _receipt(to, value, data, 0, SHIELD_PK);
        vm.prank(agent);
        vm.expectRevert(err);
        module.execute(address(safe), to, value, data, r, sig);
    }
}

contract GuardModuleTest is GuardBase {
    address bob = address(0xB0B0);

    function test_happyPath_andDailyTokenLimit() public {
        _agentExec(address(usdg), 0, abi.encodeCall(usdg.transfer, (bob, 600e6)));
        assertEq(usdg.balanceOf(bob), 600e6);
        assertEq(module.remaining(address(safe), address(usdg)), 400e6);
        _agentExecExpect(address(usdg), 0, abi.encodeCall(usdg.transfer, (bob, 401e6)),
            abi.encodeWithSelector(HeimdallGuardModule.LimitExceeded.selector, address(usdg), 401e6, 400e6));
        _agentExec(address(usdg), 0, abi.encodeCall(usdg.transfer, (bob, 400e6)));
        vm.warp(block.timestamp + 1 days);
        _agentExec(address(usdg), 0, abi.encodeCall(usdg.transfer, (bob, 1_000e6)));
        assertEq(usdg.balanceOf(bob), 2_000e6);
    }

    function test_ethLimit_andReturnData() public {
        bytes memory ret = _agentExec(address(sink), 0.6 ether, abi.encodeCall(Sink.ping, ()));
        assertEq(abi.decode(ret, (uint256)), 42);
        _agentExecExpect(address(sink), 0.5 ether, "", abi.encodeWithSelector(HeimdallGuardModule.LimitExceeded.selector, address(0), 0.5 ether, 0.4 ether));
        assertEq(address(sink).balance, 0.6 ether);
    }

    function test_approvalsCount_unlimitedImpossible_revokeAlwaysOk() public {
        _agentExecExpect(address(usdg), 0, abi.encodeCall(usdg.approve, (bob, type(uint256).max)),
            abi.encodeWithSelector(HeimdallGuardModule.LimitExceeded.selector, address(usdg), type(uint256).max, 1_000e6));
        _agentExec(address(usdg), 0, abi.encodeCall(usdg.approve, (bob, 700e6)));
        assertEq(module.remaining(address(safe), address(usdg)), 300e6);
        _agentExec(address(usdg), 0, abi.encodeCall(usdg.approve, (bob, 0)));
        // transferFrom pulling from the Safe counts too
        _agentExecExpect(address(usdg), 0, abi.encodeWithSignature("transferFrom(address,address,uint256)", address(safe), bob, 301e6),
            abi.encodeWithSelector(HeimdallGuardModule.LimitExceeded.selector, address(usdg), 301e6, 300e6));
    }

    function test_agentCannotAdministerSafeOrModule() public {
        _agentExecExpect(address(safe), 0, abi.encodeWithSignature("addOwnerWithThreshold(address,uint256)", agent, 1),
            abi.encodeWithSelector(HeimdallGuardModule.ForbiddenTarget.selector, address(safe)));
        _agentExecExpect(address(module), 0, abi.encodeCall(module.setTokenLimit, (address(usdg), type(uint256).max, true)),
            abi.encodeWithSelector(HeimdallGuardModule.ForbiddenTarget.selector, address(module)));
        // calling setPolicy directly configures the agent's own (empty) namespace, never the Safe's
        vm.prank(agent);
        module.setPolicy(type(uint128).max, false, false);
        (uint128 eth,,) = module.policyOf(address(safe));
        assertEq(eth, 1 ether);
    }

    function test_receiptChecks() public {
        bytes memory data = abi.encodeCall(usdg.transfer, (bob, 1e6));
        // wrong signer
        (ShieldGuarded.Receipt memory r, bytes memory sig) = _receipt(address(usdg), 0, data, 0, OTHER_PK);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ShieldGuarded.InvalidReceiptSigner.selector, vm.addr(OTHER_PK)));
        module.execute(address(safe), address(usdg), 0, data, r, sig);
        // WARN / DENY receipts are refused
        (r, sig) = _receipt(address(usdg), 0, data, 1, SHIELD_PK);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ShieldGuarded.ReceiptNotAllow.selector, 1));
        module.execute(address(safe), address(usdg), 0, data, r, sig);
        // receipt for other calldata
        (r, sig) = _receipt(address(usdg), 0, abi.encodeCall(usdg.transfer, (bob, 2e6)), 0, SHIELD_PK);
        vm.prank(agent);
        vm.expectRevert(ShieldGuarded.ReceiptMismatch.selector);
        module.execute(address(safe), address(usdg), 0, data, r, sig);
        // replay
        (r, sig) = _receipt(address(usdg), 0, data, 0, SHIELD_PK);
        vm.prank(agent);
        module.execute(address(safe), address(usdg), 0, data, r, sig);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ShieldGuarded.ReceiptAlreadyUsed.selector, r.checkId));
        module.execute(address(safe), address(usdg), 0, data, r, sig);
        // expired
        (r, sig) = _receipt(address(usdg), 0, data, 0, SHIELD_PK);
        vm.warp(block.timestamp + 121);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ShieldGuarded.ReceiptExpired.selector, r.expiresAt));
        module.execute(address(safe), address(usdg), 0, data, r, sig);
        // a receipt issued to another account (e.g. the agent's own wallet) is not valid for the Safe
        r = ShieldGuarded.Receipt(agent, address(usdg), keccak256(data), 0, 0, uint64(block.timestamp + 120), bytes32("x"));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(SHIELD_PK, module.receiptDigest(r));
        vm.prank(agent);
        vm.expectRevert(ShieldGuarded.ReceiptMismatch.selector);
        module.execute(address(safe), address(usdg), 0, data, r, abi.encodePacked(rr, s, v));
    }

    function test_agentLifecycle_andPause() public {
        bytes memory data = abi.encodeCall(usdg.transfer, (bob, 1e6));
        (ShieldGuarded.Receipt memory r, bytes memory sig) = _receipt(address(usdg), 0, data, 0, SHIELD_PK);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(HeimdallGuardModule.NotAgent.selector, bob));
        module.execute(address(safe), address(usdg), 0, data, r, sig);

        _ownerExec(address(module), abi.encodeCall(module.setPaused, (true)));
        _agentExecExpect(address(usdg), 0, data, abi.encodeWithSelector(HeimdallGuardModule.SafePaused.selector));
        _ownerExec(address(module), abi.encodeCall(module.setPaused, (false)));

        uint64 exp = uint64(block.timestamp + 1 hours);
        _ownerExec(address(module), abi.encodeCall(module.setAgent, (agent, true, exp)));
        _agentExec(address(usdg), 0, data);
        vm.warp(exp + 1);
        _agentExecExpect(address(usdg), 0, data, abi.encodeWithSelector(HeimdallGuardModule.AgentExpired.selector, exp));

        _ownerExec(address(module), abi.encodeCall(module.setAgent, (agent, false, 0)));
        _agentExecExpect(address(usdg), 0, data, abi.encodeWithSelector(HeimdallGuardModule.NotAgent.selector, agent));
    }

    function test_strictModes() public {
        _ownerExec(address(module), abi.encodeCall(module.setPolicy, (1 ether, true, true)));
        // unlisted token
        _agentExecExpect(address(nvda), 0, abi.encodeCall(nvda.transfer, (bob, 1e18)),
            abi.encodeWithSelector(HeimdallGuardModule.TargetNotAllowed.selector, address(nvda)));
        _ownerExec(address(module), abi.encodeCall(module.setTarget, (address(nvda), true)));
        _agentExecExpect(address(nvda), 0, abi.encodeCall(nvda.transfer, (bob, 1e18)),
            abi.encodeWithSelector(HeimdallGuardModule.TokenNotAllowed.selector, address(nvda)));
        // revoking an approval is always allowed
        _agentExec(address(nvda), 0, abi.encodeCall(nvda.approve, (bob, 0)));
        // operator approvals blocked
        _agentExecExpect(address(nvda), 0, abi.encodeWithSignature("setApprovalForAll(address,bool)", bob, true),
            abi.encodeWithSelector(HeimdallGuardModule.TokenNotAllowed.selector, address(nvda)));
        // random target
        _agentExecExpect(address(sink), 0, abi.encodeCall(Sink.ping, ()), abi.encodeWithSelector(HeimdallGuardModule.TargetNotAllowed.selector, address(sink)));
        // listed tokens count as allowed targets
        _agentExec(address(usdg), 0, abi.encodeCall(usdg.transfer, (bob, 1e6)));
    }

    function test_limitedTokenOnlyTakesCountableCalls() public {
        _agentExecExpect(address(usdg), 0, abi.encodeWithSignature("transferAndCall(address,uint256,bytes)", bob, 5_000e6, ""),
            abi.encodeWithSelector(HeimdallGuardModule.TokenNotAllowed.selector, address(usdg)));
        _agentExecExpect(address(usdg), 0, abi.encodeWithSignature("burn(uint256)", 5_000e6),
            abi.encodeWithSelector(HeimdallGuardModule.TokenNotAllowed.selector, address(usdg)));
        _agentExecExpect(address(usdg), 0, hex"", abi.encodeWithSelector(HeimdallGuardModule.TokenNotAllowed.selector, address(usdg)));
        // short calldata for a known selector cannot dodge the count either
        _agentExecExpect(address(usdg), 0, abi.encodePacked(bytes4(0xa9059cbb), bytes32(uint256(uint160(bob)))),
            abi.encodeWithSelector(HeimdallGuardModule.TokenNotAllowed.selector, address(usdg)));
        _agentExec(address(usdg), 0, abi.encodeCall(usdg.approve, (bob, 0)));
    }

    function test_signerOverride() public {
        _ownerExec(address(module), abi.encodeCall(module.setSignerOverride, (vm.addr(OTHER_PK))));
        bytes memory data = abi.encodeCall(usdg.transfer, (bob, 1e6));
        (ShieldGuarded.Receipt memory r, bytes memory sig) = _receipt(address(usdg), 0, data, 0, SHIELD_PK);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ShieldGuarded.InvalidReceiptSigner.selector, vm.addr(SHIELD_PK)));
        module.execute(address(safe), address(usdg), 0, data, r, sig);
        (r, sig) = _receipt(address(usdg), 0, data, 0, OTHER_PK);
        vm.prank(agent);
        module.execute(address(safe), address(usdg), 0, data, r, sig);
    }

    function test_moduleDisabled_callFails() public {
        _ownerExec(address(safe), abi.encodeWithSignature("disableModule(address,address)", address(0x1), address(module)));
        bytes memory data = abi.encodeCall(usdg.transfer, (bob, 1e6));
        (ShieldGuarded.Receipt memory r, bytes memory sig) = _receipt(address(usdg), 0, data, 0, SHIELD_PK);
        vm.prank(agent);
        vm.expectRevert(); // GS104: method only callable by an enabled module
        module.execute(address(safe), address(usdg), 0, data, r, sig);
    }

    function test_failedInnerCallReverts_noSpendRecorded() public {
        bytes memory data = abi.encodeCall(usdg.transfer, (bob, 999e6));
        usdg.mint(address(0xdead), 0);
        // drain the Safe first so the transfer fails inside
        _ownerExec(address(usdg), abi.encodeCall(usdg.transfer, (address(0xdead), 5_000e6)));
        (ShieldGuarded.Receipt memory r, bytes memory sig) = _receipt(address(usdg), 0, data, 0, SHIELD_PK);
        vm.prank(agent);
        vm.expectRevert();
        module.execute(address(safe), address(usdg), 0, data, r, sig);
        assertEq(module.remaining(address(safe), address(usdg)), 1_000e6);
    }

    function test_onlyOwnerManagesDefaultSigners() public {
        vm.expectRevert();
        module.setShieldSigner(address(this), true);
        vm.prank(heimdall);
        module.setShieldSigner(vm.addr(SHIELD_PK), false);
        _agentExecExpect(address(usdg), 0, abi.encodeCall(usdg.transfer, (bob, 1e6)),
            abi.encodeWithSelector(ShieldGuarded.InvalidReceiptSigner.selector, vm.addr(SHIELD_PK)));
    }

    /// Whatever the agent sends in one window, the Safe never loses more USDG than the daily limit.
    function testFuzz_windowNeverExceedsLimit(uint64[6] memory amounts, bool[6] memory approveInstead) public {
        uint256 before = usdg.balanceOf(address(safe));
        uint256 counted;
        for (uint256 i; i < 6; ++i) {
            uint256 amt = bound(amounts[i], 0, 600e6);
            bytes memory data = approveInstead[i] ? abi.encodeCall(usdg.approve, (bob, amt)) : abi.encodeCall(usdg.transfer, (bob, amt));
            (ShieldGuarded.Receipt memory r, bytes memory sig) = _receipt(address(usdg), 0, data, 0, SHIELD_PK);
            vm.prank(agent);
            try module.execute(address(safe), address(usdg), 0, data, r, sig) { counted += amt; } catch {}
        }
        assertLe(counted, 1_000e6);
        assertLe(before - usdg.balanceOf(address(safe)), 1_000e6);
    }
}
