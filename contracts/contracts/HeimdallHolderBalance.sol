// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakedOf {
    function stakedOf(address account) external view returns (uint256);
}

/// @title HeimdallHolderBalance
/// @notice $HEIM a wallet holds plus $HEIM it has staked, behind a plain `balanceOf`. Vaults, Signals, Shield and the
///         web app read holder status through this view, so staking never costs a holder their benefits.
/// @dev Immutable and ownerless. Holds nothing and moves nothing.
contract HeimdallHolderBalance {
    IERC20 public immutable heim;
    IStakedOf public immutable staking;

    string public constant name = "Heimdall holder balance ($HEIM held + staked)";

    error InvalidConfig();

    constructor(IERC20 heim_, IStakedOf staking_) {
        if (address(heim_) == address(0) || address(staking_) == address(0)) revert InvalidConfig();
        heim = heim_;
        staking = staking_;
    }

    function balanceOf(address account) external view returns (uint256) {
        return heim.balanceOf(account) + staking.stakedOf(account);
    }
}
