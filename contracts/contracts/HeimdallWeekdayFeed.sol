// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IPriceFeed} from "./interfaces/IPriceFeed.sol";

/// @title HeimdallWeekdayFeed
/// @notice Market hours for Robinhood Stock Tokens whose Chainlink feed runs 24/5. Those feeds stop on Friday at
///         20:00 New York time and resume on Sunday at 20:00, keeping their last price in between. This wrapper
///         treats the market as closed from Saturday 00:00 to Monday 01:00 UTC, which covers that gap in both
///         summer and winter time, and reports the price as stale (updatedAt = 0) while it is closed.
///         A vault holding the stock then refuses deposits, NAV-based withdrawals and trades over the weekend, so
///         nobody can deposit or withdraw at Friday's price after weekend news. In-kind exits keep working.
///         An empty balance of the stock never blocks a vault: vaults skip assets they do not hold.
/// @dev Wraps a HeimdallStockFeed (corporate-action pause, multiplier and USDG checks stay there). Immutable and
///      ownerless. Outside the closed window it passes the wrapped answer through unchanged; the vault's own
///      heartbeat then rejects a price that was not refreshed after the reopen.
contract HeimdallWeekdayFeed is IPriceFeed {
    /// @notice Seconds into the week (counted from Thursday 00:00 UTC, the Unix epoch's weekday) when the market closes:
    ///         Saturday 00:00 UTC.
    uint256 public constant CLOSE_AT = 2 days;
    /// @notice Seconds into the week when the market counts as open again: Monday 01:00 UTC.
    uint256 public constant OPEN_AT = 4 days + 1 hours;

    IPriceFeed public immutable inner;
    uint8 private immutable _decimals;
    string public description;

    error InvalidConfig();

    constructor(IPriceFeed inner_, string memory description_) {
        if (address(inner_) == address(0)) revert InvalidConfig();
        inner = inner_;
        _decimals = inner_.decimals();
        description = description_;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    /// @notice True between Saturday 00:00 and Monday 01:00 UTC.
    function marketClosed() public view returns (bool) {
        uint256 t = block.timestamp % 7 days;
        return t >= CLOSE_AT && t < OPEN_AT;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (roundId, answer, startedAt, updatedAt, answeredInRound) = inner.latestRoundData();
        if (marketClosed()) updatedAt = 0;
    }
}
