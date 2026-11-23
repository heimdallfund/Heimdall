// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IHeimdallRisk, LEVEL_BLOCKED} from "./interfaces/IHeimdallRisk.sol";

/// @title HeimdallRiskAware
/// @notice Drop-in base for any contract on Robinhood Chain: inherit it and add `notBlocked(addr)` to a function.
///
///     contract MyLaunchpad is HeimdallRiskAware {
///         constructor(IHeimdallRisk oracle) HeimdallRiskAware(oracle, false) {}
///         function buy(address to) external notBlocked(msg.sender) notBlocked(to) { ... }
///     }
///
/// @dev The oracle is read with a gas-capped staticcall, so a broken or missing oracle can never take your contract
///      down. `failClosed = false` (the default for most apps) treats an unreadable oracle as "not blocked";
///      `failClosed = true` blocks instead, for flows where an unchecked address is worse than a pause.
abstract contract HeimdallRiskAware {
    IHeimdallRisk public immutable heimdallRisk;
    bool public immutable heimdallFailClosed;
    uint256 private constant READ_GAS = 30_000;

    error HeimdallBlocked(address account);

    constructor(IHeimdallRisk oracle, bool failClosed) {
        heimdallRisk = oracle;
        heimdallFailClosed = failClosed;
    }

    modifier notBlocked(address account) {
        if (_heimdallBlocked(account)) revert HeimdallBlocked(account);
        _;
    }

    /// @dev Never reverts.
    function _heimdallBlocked(address account) internal view returns (bool) {
        if (address(heimdallRisk).code.length == 0) return heimdallFailClosed;
        (bool ok, bytes memory ret) =
            address(heimdallRisk).staticcall{gas: READ_GAS}(abi.encodeCall(IHeimdallRisk.levelOf, (account)));
        if (!ok || ret.length < 32) return heimdallFailClosed;
        return abi.decode(ret, (uint256)) >= LEVEL_BLOCKED;
    }
}
