// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GuardBase} from "../guard/GuardModule.t.sol";
import {HeimdallGuardModule} from "../../contracts/HeimdallGuardModule.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../../contracts/mocks/Mocks.sol";

/// A router-style contract that pulls tokens from its caller (like Uniswap's routers do) and sends them anywhere.
contract AllowancePuller {
    function pull(IERC20 token, address to, uint256 amount) external {
        token.transferFrom(msg.sender, to, amount);
    }
}

/// R5-01: a limited token leaves the Safe through an allowance the Safe gave earlier (owners swapping on a router,
/// for example). The module only counted direct token calls, so the daily limit did not see it.
contract GuardPoc is GuardBase {
    address thief = address(0x7E1F);
    AllowancePuller router;

    function setUp() public override {
        super.setUp();
        router = new AllowancePuller();
        // the owners once approved the router themselves (a normal swap), and allowlisted it for the agent
        _ownerExec(address(usdg), abi.encodeCall(usdg.approve, (address(router), type(uint256).max)));
        _ownerExec(address(module), abi.encodeCall(module.setTarget, (address(router), true)));
    }

    /// Fixed: the module now measures the Safe's balance of every limited token before and after the call.
    function test_R5_01_pullThroughAllowanceCountsAgainstTheLimit() public {
        // limit is 1,000 USDG per day; try to move 5,000 through the router
        _agentExecExpect(address(router), 0, abi.encodeCall(router.pull, (IERC20(address(usdg)), thief, 5_000e6)),
            abi.encodeWithSelector(HeimdallGuardModule.LimitExceeded.selector, address(usdg), 5_000e6, 1_000e6));
        assertEq(usdg.balanceOf(thief), 0);
        // within the limit it works, and it is counted
        _agentExec(address(router), 0, abi.encodeCall(router.pull, (IERC20(address(usdg)), thief, 700e6)));
        assertEq(module.remaining(address(safe), address(usdg)), 300e6);
    }

    /// Approvals to an allowlisted target (a router that only pulls from its caller) are not counted twice:
    /// the swap that uses the allowance is what counts.
    function test_R5_01_approveThenPull_countsOnce() public {
        _ownerExec(address(usdg), abi.encodeCall(usdg.approve, (address(router), 0)));
        _agentExec(address(usdg), 0, abi.encodeCall(usdg.approve, (address(router), 600e6)));
        assertEq(module.remaining(address(safe), address(usdg)), 1_000e6);
        _agentExec(address(router), 0, abi.encodeCall(router.pull, (IERC20(address(usdg)), thief, 600e6)));
        assertEq(module.remaining(address(safe), address(usdg)), 400e6);
    }

    /// An approval to anything that is not an allowlisted target still counts in full when it is given.
    function test_R5_01_approvalToUnlistedSpenderStillCounts() public {
        _agentExec(address(usdg), 0, abi.encodeCall(usdg.approve, (thief, 900e6)));
        assertEq(module.remaining(address(safe), address(usdg)), 100e6);
    }

    /// The list of limited tokens is bounded, and removing a limit takes the token off the list.
    function test_R5_01_limitedTokenListIsBoundedAndClean() public {
        for (uint256 i = 1; i < 16; ++i) {
            MockERC20 t = new MockERC20("T", "T", 18);
            _ownerExec(address(module), abi.encodeCall(module.setTokenLimit, (address(t), 1, true)));
        }
        assertEq(module.limitedTokens(address(safe)).length, 16);
        MockERC20 extra = new MockERC20("X", "X", 18);
        vm.expectRevert(); // TooManyLimitedTokens, bubbled up as a failed Safe transaction
        this.ownerExecExternal(address(module), abi.encodeCall(module.setTokenLimit, (address(extra), 1, true)));
        // updating an existing limit does not add a second entry; removing frees a slot
        _ownerExec(address(module), abi.encodeCall(module.setTokenLimit, (address(usdg), 2_000e6, true)));
        assertEq(module.limitedTokens(address(safe)).length, 16);
        _ownerExec(address(module), abi.encodeCall(module.setTokenLimit, (address(usdg), 0, false)));
        assertEq(module.limitedTokens(address(safe)).length, 15);
        _ownerExec(address(module), abi.encodeCall(module.setTokenLimit, (address(extra), 1, true)));
        assertEq(module.limitedTokens(address(safe)).length, 16);
    }

    function ownerExecExternal(address to, bytes memory data) external { _ownerExec(to, data); }
}
