// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {HeimdallVault} from "./HeimdallVault.sol";

/// @notice Holds the vault creation code so the factory stays under the 24 KB contract size limit.
///         Only the factory that is set once at deployment can create vaults.
contract HeimdallVaultDeployer {
    address public factory;
    address public immutable creator = msg.sender;

    error NotFactory();
    error AlreadySet();
    error NotCreator();

    function setFactory(address f) external {
        if (msg.sender != creator) revert NotCreator();
        if (factory != address(0)) revert AlreadySet();
        factory = f;
    }

    function deploy(HeimdallVault.InitConfig calldata c) external returns (address) {
        if (msg.sender != factory) revert NotFactory();
        return address(new HeimdallVault(c));
    }
}
