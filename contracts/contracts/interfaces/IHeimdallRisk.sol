// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title IHeimdallRisk
/// @notice Read interface of the Heimdall Risk Oracle on Robinhood Chain. Copy this file into your project to
///         check an address before you send to it, list a token, or let it call you.
///
/// Levels: 0 = no data, 1 = low (seen in a risky pattern), 2 = warn (review before trusting), 3 = blocked
/// (drainer, phishing, exploiter or honeypot, confirmed by Heimdall).
interface IHeimdallRisk {
    /// @dev Flag bits. An entry can carry several.
    // 1 << 0  DRAINER            takes approved tokens from victims
    // 1 << 1  PHISHING           fake site / signature farm wallet or contract
    // 1 << 2  HONEYPOT           token that cannot be sold
    // 1 << 3  MALICIOUS_CONTRACT contract with a hidden drain or backdoor
    // 1 << 4  SCAM_TOKEN         impersonates another token
    // 1 << 5  EXPLOITER          address that exploited a protocol
    // 1 << 6  COMMUNITY          confirmed from a community report
    // 1 << 7  SHIELD_DENIED      repeatedly a target of transactions Shield denied

    function riskOf(address account) external view returns (uint8 level, uint32 flags, uint64 updatedAt);
    function levelOf(address account) external view returns (uint8);
    /// @notice True when `account` is at level 3 (blocked).
    function isBlocked(address account) external view returns (bool);
    /// @notice True when any of `accounts` is blocked.
    function anyBlocked(address[] calldata accounts) external view returns (bool);
}

uint8 constant LEVEL_NONE = 0;
uint8 constant LEVEL_LOW = 1;
uint8 constant LEVEL_WARN = 2;
uint8 constant LEVEL_BLOCKED = 3;

uint32 constant FLAG_DRAINER = 1 << 0;
uint32 constant FLAG_PHISHING = 1 << 1;
uint32 constant FLAG_HONEYPOT = 1 << 2;
uint32 constant FLAG_MALICIOUS_CONTRACT = 1 << 3;
uint32 constant FLAG_SCAM_TOKEN = 1 << 4;
uint32 constant FLAG_EXPLOITER = 1 << 5;
uint32 constant FLAG_COMMUNITY = 1 << 6;
uint32 constant FLAG_SHIELD_DENIED = 1 << 7;
