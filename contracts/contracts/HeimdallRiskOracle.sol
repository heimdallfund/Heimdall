// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IHeimdallRisk, LEVEL_BLOCKED} from "./interfaces/IHeimdallRisk.sol";

/// @title HeimdallRiskOracle
/// @notice Onchain risk data for Robinhood Chain addresses: drainers, phishing contracts, honeypot tokens and
///         exploiters found by Heimdall Shield and confirmed community reports. Any contract can read it in one call:
///
///             if (heimdall.isBlocked(recipient)) revert();
///
/// @dev Reporters (Heimdall's sync keeper) write levels and flags in batches. The owner (a Safe) adds and removes
///      reporters and can pin an entry, which reporters can then no longer change: that is how a false positive is
///      cleared for good, or a known-bad address is fixed in place. Reads never revert.
contract HeimdallRiskOracle is IHeimdallRisk, Ownable2Step {
    struct Entry {
        uint8 level;
        uint32 flags;
        uint64 updatedAt;
        bool pinned;
    }

    uint8 public constant MAX_LEVEL = LEVEL_BLOCKED;
    uint256 public constant MAX_BATCH = 200;

    mapping(address => Entry) internal _entries;
    mapping(address => bool) public isReporter;
    /// @notice Number of addresses currently at LEVEL_BLOCKED.
    uint256 public blockedCount;

    event ReporterSet(address indexed reporter, bool allowed);
    event RiskSet(address indexed account, uint8 level, uint32 flags, address indexed by);
    event Pinned(address indexed account, bool pinned);

    error NotReporter();
    error InvalidLevel(uint8 level);
    error LengthMismatch();
    error BatchTooLarge();
    error IsPinned(address account);

    constructor(address owner_) Ownable(owner_) {}

    // ── reads ────────────────────────────────────────────

    /// @inheritdoc IHeimdallRisk
    function riskOf(address account) external view returns (uint8 level, uint32 flags, uint64 updatedAt) {
        Entry memory e = _entries[account];
        return (e.level, e.flags, e.updatedAt);
    }

    /// @inheritdoc IHeimdallRisk
    function levelOf(address account) external view returns (uint8) {
        return _entries[account].level;
    }

    /// @inheritdoc IHeimdallRisk
    function isBlocked(address account) external view returns (bool) {
        return _entries[account].level >= LEVEL_BLOCKED;
    }

    /// @inheritdoc IHeimdallRisk
    function anyBlocked(address[] calldata accounts) external view returns (bool) {
        for (uint256 i; i < accounts.length; ++i) if (_entries[accounts[i]].level >= LEVEL_BLOCKED) return true;
        return false;
    }

    /// @notice Levels of many addresses at once (for indexers and the sync job).
    function levelsOf(address[] calldata accounts) external view returns (uint8[] memory levels, uint32[] memory flags) {
        levels = new uint8[](accounts.length);
        flags = new uint32[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) {
            Entry memory e = _entries[accounts[i]];
            (levels[i], flags[i]) = (e.level, e.flags);
        }
    }

    function isPinned(address account) external view returns (bool) {
        return _entries[account].pinned;
    }

    // ── reporters ────────────────────────────────────────

    /// @notice Write levels and flags for up to MAX_BATCH addresses. Level 0 with flags 0 clears an entry.
    ///         Pinned entries are skipped (not reverted), so one pin never blocks a whole sync.
    function report(address[] calldata accounts, uint8[] calldata levels, uint32[] calldata flags) external {
        if (!isReporter[msg.sender]) revert NotReporter();
        if (accounts.length != levels.length || accounts.length != flags.length) revert LengthMismatch();
        if (accounts.length > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i; i < accounts.length; ++i) {
            if (_entries[accounts[i]].pinned) continue;
            _set(accounts[i], levels[i], flags[i]);
        }
    }

    // ── owner (Safe) ─────────────────────────────────────

    function setReporter(address reporter, bool allowed) external onlyOwner {
        isReporter[reporter] = allowed;
        emit ReporterSet(reporter, allowed);
    }

    /// @notice Set an entry and lock it against reporters (`pinned = true`), or unlock it (`pinned = false`).
    function pin(address account, uint8 level, uint32 flags, bool pinned) external onlyOwner {
        _set(account, level, flags);
        _entries[account].pinned = pinned;
        emit Pinned(account, pinned);
    }

    // ── internal ─────────────────────────────────────────

    function _set(address account, uint8 level, uint32 flags) internal {
        if (level > MAX_LEVEL) revert InvalidLevel(level);
        Entry storage e = _entries[account];
        bool wasBlocked = e.level >= LEVEL_BLOCKED;
        bool nowBlocked = level >= LEVEL_BLOCKED;
        if (wasBlocked && !nowBlocked) blockedCount -= 1;
        else if (!wasBlocked && nowBlocked) blockedCount += 1;
        e.level = level;
        e.flags = flags;
        e.updatedAt = uint64(block.timestamp);
        emit RiskSet(account, level, flags, msg.sender);
    }
}
