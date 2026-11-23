// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Safe 1.4.1, compiled as project contracts so node tests and the local demo can deploy a real Safe.
// Not deployed by Heimdall: on Robinhood Chain the official Safe deployments are used.
import {Safe} from "@safe-global/safe-contracts/contracts/Safe.sol";
import {SafeProxyFactory} from "@safe-global/safe-contracts/contracts/proxies/SafeProxyFactory.sol";

contract TestSafe is Safe {}

contract TestSafeProxyFactory is SafeProxyFactory {}
