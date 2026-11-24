// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IPriceFeed} from "./interfaces/IPriceFeed.sol";

/// @title HeimdallStockFeed
/// @notice Wraps a Chainlink Robinhood Stock Token feed (USD) for Heimdall vaults:
///         - prices the stock in USDG by dividing by the Chainlink USDG/USD feed (optional),
///         - reports the price as stale while Robinhood has paused the token's oracle for a corporate action
///           (`oraclePaused()` on the token, which Chainlink does not enforce onchain),
///         - reports stale when the USDG/USD quote is stale or out of its sanity band,
///         - reports stale when the token's corporate-action multiplier took effect after the last price
///           (`effectiveAt()` on the token): that price was computed with the old multiplier.
///         The Chainlink answer already includes the multiplier (price of one token), so it is never applied again here.
///         A stale answer (updatedAt = 0) makes the vault refuse deposits and NAV-based withdrawals;
///         in-kind exits keep working.
/// @dev Immutable and ownerless. Replace by deploying a new adapter and calling `setFeed` on the vault.
contract HeimdallStockFeed is IPriceFeed {
    IPriceFeed public immutable feed;
    address public immutable token;
    IPriceFeed public immutable quote;
    uint32 public immutable quoteMaxAge;
    uint8 private immutable _decimals;
    uint8 private immutable _quoteDecimals;

    /// @dev Quote (USDG/USD) accepted between 0.90 and 1.10; outside that band the price is reported stale.
    uint256 public constant QUOTE_MIN_BPS = 9_000;
    uint256 public constant QUOTE_MAX_BPS = 11_000;

    string public description;

    error InvalidConfig();

    constructor(address feed_, address token_, address quote_, uint32 quoteMaxAge_, string memory description_) {
        if (feed_ == address(0) || token_ == address(0)) revert InvalidConfig();
        if (quote_ != address(0) && quoteMaxAge_ == 0) revert InvalidConfig();
        feed = IPriceFeed(feed_);
        token = token_;
        quote = IPriceFeed(quote_);
        quoteMaxAge = quoteMaxAge_;
        _decimals = IPriceFeed(feed_).decimals();
        _quoteDecimals = quote_ == address(0) ? 0 : IPriceFeed(quote_).decimals();
        // must be a Robinhood stock token: one that exposes the oracle pause flag
        (bool ok, bytes memory ret) = token_.staticcall(abi.encodeWithSignature("oraclePaused()"));
        if (!ok || ret.length < 32) revert InvalidConfig();
        description = description_;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    /// @notice True while Robinhood has paused the stock token's oracle. Fails closed: an unreadable flag counts as paused.
    function paused() public view returns (bool) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("oraclePaused()"));
        return !ok || ret.length < 32 || abi.decode(ret, (bool));
    }

    /// @notice True when the token's multiplier changed after `updatedAt`, so a price from `updatedAt` predates it.
    ///         Tokens without `effectiveAt()` never trip this.
    function multiplierChangedSince(uint256 updatedAt) public view returns (bool) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("effectiveAt()"));
        if (!ok || ret.length < 32) return false;
        uint256 eff = abi.decode(ret, (uint256));
        return eff != 0 && eff <= block.timestamp && eff > updatedAt;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (roundId, answer, startedAt, updatedAt, answeredInRound) = feed.latestRoundData();
        if (answer <= 0 || paused() || multiplierChangedSince(updatedAt)) return (roundId, answer, startedAt, 0, answeredInRound);
        if (address(quote) == address(0)) return (roundId, answer, startedAt, updatedAt, answeredInRound);

        (bool ok, bytes memory ret) = address(quote).staticcall(abi.encodeCall(IPriceFeed.latestRoundData, ()));
        if (!ok || ret.length < 160) return (roundId, answer, startedAt, 0, answeredInRound);
        (, int256 q,, uint256 qUpdated,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        uint256 one = 10 ** _quoteDecimals;
        if (
            q <= 0 || qUpdated > block.timestamp || block.timestamp - qUpdated > quoteMaxAge
                || uint256(q) * 10_000 < one * QUOTE_MIN_BPS || uint256(q) * 10_000 > one * QUOTE_MAX_BPS
        ) return (roundId, answer, startedAt, 0, answeredInRound);

        answer = int256(uint256(answer) * one / uint256(q));
    }
}
