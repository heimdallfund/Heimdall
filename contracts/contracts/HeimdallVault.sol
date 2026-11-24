// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ShieldGuarded} from "./ShieldGuarded.sol";
import {IPriceFeed} from "./interfaces/IPriceFeed.sol";

/// @title HeimdallVault
/// @notice ERC-4626 vault (base asset USDG) whose manager agent can only trade through calls that
///         carry a valid Heimdall Shield receipt and stay inside onchain trade-size and loss limits.
///         The manager can never withdraw depositor funds.
contract HeimdallVault is ERC4626, Ownable2Step, Pausable, ReentrancyGuard, ShieldGuarded {
    using SafeERC20 for IERC20;
    using Math for uint256;

    struct AssetInit {
        address token;
        address feed;
        uint32 heartbeat;
    }

    struct CallPerm {
        address target;
        bytes4 selector;
    }

    struct InitConfig {
        IERC20 baseAsset;
        string name;
        string symbol;
        address owner;
        address manager;
        address feeRecipient;
        address shieldSigner;
        address guardian; // may only pause (the monitor's key); zero = none
        uint16 maxTradeBps;
        uint16 maxLossBps;
        uint16 maxDailyLossBps;
        uint256 depositCap; // max NAV in base-asset units; type(uint256).max = no cap
        address heimToken; // optional: manager holding >= holderMin pays half the platform fee
        uint256 holderMin;
        CallPerm[] calls;
        address[] spenders;
        AssetInit[] assets;
    }

    struct TrackedAsset {
        IPriceFeed feed;
        uint32 heartbeat;
        uint8 tokenDecimals;
        uint8 feedDecimals;
        bool enabled;
    }

    uint256 public constant BPS = 10_000;
    /// @notice Longest accepted feed heartbeat; also keeps the adapters' "stale" signal (updatedAt = 0) effective.
    uint32 public constant MAX_HEARTBEAT = 7 days;
    uint256 public constant MANAGER_FEE_BPS = 1_000; // 10% of profit to the manager
    uint256 public constant PLATFORM_FEE_BPS = 500; // 5% to the platform (2.5% if the manager holds $HEIM)
    uint256 public constant MAX_ASSETS = 16;
    uint256 public constant MAX_LOSS_CAP_BPS = 1_000; // a single trade can never be allowed to lose more than 10%
    uint256 public constant MAX_DAILY_LOSS_CAP_BPS = 1_500; // nor more than 15% in total per 24h window
    uint256 public constant LOSS_WINDOW = 1 days;

    bytes4 private constant APPROVE = 0x095ea7b3;
    bytes4 private constant PERMIT2_APPROVE = 0x87517c45;
    // Uniswap SwapRouter02 swaps whose output goes to a `recipient` the vault checks (see _checkRecipient)
    bytes4 private constant EXACT_INPUT_SINGLE = 0x04e45aaf;
    bytes4 private constant EXACT_OUTPUT_SINGLE = 0x5023b4df;
    bytes4 private constant V2_EXACT_IN = 0x472b43f3; // swapExactTokensForTokens(uint256,uint256,address[],address)
    bytes4 private constant V2_EXACT_OUT = 0x42712a67; // swapTokensForExactTokens(uint256,uint256,address[],address)
    bytes4 private constant EXACT_INPUT = 0xb858183f;
    bytes4 private constant EXACT_OUTPUT = 0x09b81346;

    address public manager;
    address public feeRecipient;
    /// @notice Can pause trading and deposits, nothing else (the monitor's key, for losses that look like theft).
    ///         Only the owner can unpause. Withdrawals and in-kind exits keep working while paused.
    address public guardian;
    uint16 public maxTradeBps;
    uint16 public maxLossBps;
    uint16 public maxDailyLossBps;
    uint64 public lossWindowStart;
    uint256 public lossWindowNav; // NAV at the first trade of the current window
    uint256 public lossWindowLoss; // NAV lost to trades in the current window
    uint256 public highWaterMark; // base-asset value of one whole share at the last fee crystallisation
    uint256 public depositCap; // deposits stop once NAV reaches this (guarded launch)

    address public immutable heimToken;
    uint256 public immutable holderMin;

    /// @notice Router-style targets: which selectors the manager may call. Tokens are never targets here:
    ///         on the base asset and tracked assets only `approve` (to an allowed spender, or 0 to anyone) works.
    mapping(address => mapping(bytes4 => bool)) public allowedCall;
    mapping(address => bool) public allowedSpender;
    mapping(address => TrackedAsset) public assetConfig;
    address[] private _assets;

    uint8 private immutable _baseDecimals;

    event ManagerSet(address indexed manager);
    event FeeRecipientSet(address indexed recipient);
    event GuardianSet(address indexed guardian);
    event LimitsSet(uint16 maxTradeBps, uint16 maxLossBps, uint16 maxDailyLossBps);
    event DepositCapSet(uint256 cap);
    event CallSet(address indexed target, bytes4 indexed selector, bool allowed);
    event SpenderSet(address indexed spender, bool allowed);
    event AssetAdded(address indexed token, address feed, uint32 heartbeat);
    event AssetRemoved(address indexed token);
    event FeedSet(address indexed token, address feed, uint32 heartbeat);
    event Executed(
        address indexed target, bytes4 indexed selector, bytes32 indexed checkId, uint256 navBefore, uint256 navAfter
    );
    event FeesHarvested(uint256 profit, uint256 managerShares, uint256 platformShares, uint256 newHighWaterMark);
    event RedeemedInKind(address indexed owner, address indexed receiver, uint256 shares);

    error NotManager();
    error CallNotAllowed(address target, bytes4 selector);
    error DailyLossTooLarge(uint256 lossInWindow, uint256 limit);
    error SpenderNotAllowed(address spender);
    error CallFailed(bytes reason);
    error TradeTooLarge(uint256 outflowValue, uint256 limit);
    error LossTooLarge(uint256 navBefore, uint256 navAfter);
    error StalePrice(address token);
    error InvalidConfig();
    error AssetHasBalance(address token);

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager();
        _;
    }

    constructor(InitConfig memory c)
        ERC4626(c.baseAsset)
        ERC20(c.name, c.symbol)
        Ownable(c.owner)
    {
        if (c.manager == address(0) || c.feeRecipient == address(0) || c.shieldSigner == address(0)) {
            revert InvalidConfig();
        }
        _baseDecimals = IERC20Metadata(address(c.baseAsset)).decimals();
        manager = c.manager;
        feeRecipient = c.feeRecipient;
        guardian = c.guardian;
        heimToken = c.heimToken;
        holderMin = c.holderMin;
        _setShieldSigner(c.shieldSigner, true);
        _setLimits(c.maxTradeBps, c.maxLossBps, c.maxDailyLossBps);
        for (uint256 i; i < c.calls.length; ++i) _setCall(c.calls[i].target, c.calls[i].selector, true);
        for (uint256 i; i < c.spenders.length; ++i) _setSpender(c.spenders[i], true);
        for (uint256 i; i < c.assets.length; ++i) _addAsset(c.assets[i].token, c.assets[i].feed, c.assets[i].heartbeat);
        highWaterMark = 10 ** _baseDecimals;
        depositCap = c.depositCap;
        emit DepositCapSet(c.depositCap);
        emit ManagerSet(c.manager);
        emit FeeRecipientSet(c.feeRecipient);
    }

    // ───────────────────────────── Agent execution ─────────────────────────────

    /// @notice Execute a call from the vault. Requires an ALLOW receipt from Heimdall Shield for exactly
    ///         (vault, target, data, value = 0), and the post-trade state must respect the vault's limits.
    function execute(address target, bytes calldata data, Receipt calldata receipt, bytes calldata signature)
        external
        onlyManager
        nonReentrant
        whenNotPaused
        returns (bytes memory result)
    {
        bytes4 selector = _checkCall(target, data);
        _consumeReceipt(target, data, 0, receipt, signature);

        uint256 navBefore = totalAssets();
        if (block.timestamp >= lossWindowStart + LOSS_WINDOW) {
            lossWindowStart = uint64(block.timestamp);
            lossWindowNav = navBefore;
            lossWindowLoss = 0;
        }
        uint256[] memory balancesBefore = _balances();

        bool ok;
        (ok, result) = target.call(data);
        if (!ok) revert CallFailed(result);

        uint256 navAfter = totalAssets();
        uint256 outflow = _outflowValue(balancesBefore, _balances());
        uint256 tradeLimit = navBefore.mulDiv(maxTradeBps, BPS);
        if (outflow > tradeLimit) revert TradeTooLarge(outflow, tradeLimit);
        if (navAfter * BPS < navBefore * (BPS - maxLossBps)) revert LossTooLarge(navBefore, navAfter);
        if (navAfter < navBefore) {
            uint256 loss = lossWindowLoss + (navBefore - navAfter);
            uint256 dailyLimit = lossWindowNav.mulDiv(maxDailyLossBps, BPS);
            if (loss > dailyLimit) revert DailyLossTooLarge(loss, dailyLimit);
            lossWindowLoss = loss;
        }

        emit Executed(target, selector, receipt.checkId, navBefore, navAfter);
    }

    /// @dev Allowlist: tokens only accept `approve`, routers only accept reviewed selectors.
    function _checkCall(address target, bytes calldata data) internal view returns (bytes4 selector) {
        if (data.length < 4) revert CallNotAllowed(target, bytes4(0));
        selector = bytes4(data[:4]);
        if (target == asset() || assetConfig[target].enabled) {
            if (selector != APPROVE) revert CallNotAllowed(target, selector);
            (address spender, uint256 amount) = abi.decode(data[4:], (address, uint256));
            if (amount != 0 && !allowedSpender[spender]) revert SpenderNotAllowed(spender);
            return selector;
        }
        if (target == address(this) || !allowedCall[target][selector]) revert CallNotAllowed(target, selector);
        if (!_recipientOk(selector, data)) revert CallNotAllowed(target, selector);
        if (selector == PERMIT2_APPROVE) {
            (, address spender, uint160 amount,) = abi.decode(data[4:], (address, address, uint160, uint48));
            if (amount != 0 && !allowedSpender[spender]) revert SpenderNotAllowed(spender);
        }
    }

    /// @dev Swap output may only go to the vault (or MSG_SENDER = address(1), which the router maps to the vault).
    ///      Single-hop and V2 swaps carry the recipient in the 4th head word; path swaps in the 2nd word of the tuple.
    function _recipientOk(bytes4 sel, bytes calldata data) internal view returns (bool) {
        uint256 at;
        if (sel == EXACT_INPUT_SINGLE || sel == EXACT_OUTPUT_SINGLE || sel == V2_EXACT_IN || sel == V2_EXACT_OUT) at = 100;
        else if (sel == EXACT_INPUT || sel == EXACT_OUTPUT) at = 36 + uint256(bytes32(data[4:36]));
        else return true;
        address r = address(uint160(uint256(bytes32(data[at:at + 32]))));
        return r == address(this) || r == address(1);
    }

    // ───────────────────────────── Valuation ─────────────────────────────

    /// @notice Base-asset balance plus the oracle value of every tracked asset. Reverts on a stale price.
    function totalAssets() public view override returns (uint256 total) {
        bool ok;
        (ok, total) = _tryTotalAssets();
        if (!ok) revert StalePrice(address(0));
    }

    function trackedAssets() external view returns (address[] memory) {
        return _assets;
    }

    function valueOf(address token, uint256 amount) public view returns (uint256) {
        (bool ok, uint256 v) = _tryValueOf(token, amount);
        if (!ok) revert StalePrice(token);
        return v;
    }

    function _tryTotalAssets() internal view returns (bool, uint256 total) {
        total = IERC20(asset()).balanceOf(address(this));
        for (uint256 i; i < _assets.length; ++i) {
            address token = _assets[i];
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal == 0) continue;
            (bool ok, uint256 v) = _tryValueOf(token, bal);
            if (!ok) return (false, 0);
            total += v;
        }
        return (true, total);
    }

    function _tryValueOf(address token, uint256 amount) internal view returns (bool, uint256) {
        if (token == asset()) return (true, amount);
        TrackedAsset memory a = assetConfig[token];
        if (!a.enabled) return (true, 0);
        // Low-level call: a feed that reverts or returns malformed data counts as stale, never reverts here.
        (bool ok, bytes memory ret) = address(a.feed).staticcall(abi.encodeCall(IPriceFeed.latestRoundData, ()));
        if (!ok || ret.length < 160) return (false, 0);
        (, int256 answer,, uint256 updatedAt,) = abi.decode(ret, (uint256, int256, uint256, uint256, uint256));
        if (answer <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > a.heartbeat) return (false, 0);
        return (true, amount.mulDiv(uint256(answer) * 10 ** _baseDecimals, 10 ** (uint256(a.tokenDecimals) + a.feedDecimals)));
    }

    function _balances() internal view returns (uint256[] memory b) {
        b = new uint256[](_assets.length + 1);
        b[0] = IERC20(asset()).balanceOf(address(this));
        for (uint256 i; i < _assets.length; ++i) b[i + 1] = IERC20(_assets[i]).balanceOf(address(this));
    }

    function _outflowValue(uint256[] memory beforeBal, uint256[] memory afterBal) internal view returns (uint256 v) {
        if (afterBal[0] < beforeBal[0]) v += beforeBal[0] - afterBal[0];
        for (uint256 i; i < _assets.length; ++i) {
            if (afterBal[i + 1] < beforeBal[i + 1]) v += valueOf(_assets[i], beforeBal[i + 1] - afterBal[i + 1]);
        }
    }

    // ───────────────────────────── Fees ─────────────────────────────

    /// @notice Crystallise the performance fee above the high-water mark. Anyone can call.
    function harvest() external nonReentrant {
        _harvest();
    }

    function _harvest() internal {
        uint256 supply = totalSupply();
        (bool ok, uint256 nav) = _tryTotalAssets();
        if (!ok) return;
        (uint256 feeShares, uint256 profit, uint256 totalBps) = _pendingFee(supply, nav);
        if (feeShares == 0) return;
        uint256 managerShares = feeShares.mulDiv(MANAGER_FEE_BPS, totalBps);
        uint256 platformShares = feeShares - managerShares;
        if (managerShares > 0) _mint(manager, managerShares);
        if (platformShares > 0) _mint(feeRecipient, platformShares);
        uint256 newHwm = _pps(nav, supply + feeShares);
        highWaterMark = newHwm;
        emit FeesHarvested(profit, managerShares, platformShares, newHwm);
    }

    /// @dev Base-asset value of one whole share for a given NAV and supply (same virtual offset as ERC-4626).
    function _pps(uint256 nav, uint256 supply) internal view returns (uint256) {
        return (10 ** decimals()).mulDiv(nav + 1, supply + 10 ** _decimalsOffset());
    }

    /// @dev Fee shares the next harvest would mint. Used by `_harvest` and by every ERC-4626 conversion, so
    ///      previews and max* limits always match what a deposit, withdraw or redeem will actually do.
    function _pendingFee(uint256 supply, uint256 nav) internal view returns (uint256 feeShares, uint256 profit, uint256 totalBps) {
        if (supply == 0) return (0, 0, 0);
        uint256 pps = _pps(nav, supply);
        uint256 hwm = highWaterMark;
        if (pps <= hwm) return (0, 0, 0);
        profit = (pps - hwm).mulDiv(supply, 10 ** decimals());
        totalBps = MANAGER_FEE_BPS + (_managerIsHolder() ? PLATFORM_FEE_BPS / 2 : PLATFORM_FEE_BPS);
        uint256 feeAssets = profit.mulDiv(totalBps, BPS);
        if (feeAssets == 0 || feeAssets >= nav) return (0, 0, 0);
        // shares worth exactly `feeAssets` after minting
        feeShares = feeAssets.mulDiv(supply + 10 ** _decimalsOffset(), nav + 1 - feeAssets);
    }

    /// @dev Supply including the fee shares a harvest would mint now.
    function _supplyAfterFee(uint256 nav) internal view returns (uint256 supply) {
        supply = totalSupply();
        (uint256 fs,,) = _pendingFee(supply, nav);
        supply += fs;
    }

    function _managerIsHolder() internal view returns (bool) {
        if (heimToken == address(0)) return false;
        (bool ok, bytes memory ret) = heimToken.staticcall(abi.encodeCall(IERC20.balanceOf, (manager)));
        return ok && ret.length >= 32 && abi.decode(ret, (uint256)) >= holderMin;
    }

    /// @dev Only callable by the vault itself, so in-kind exits can try to harvest without depending on it.
    function harvestSelf() external {
        if (msg.sender != address(this)) revert NotManager();
        _harvest();
    }

    /// @dev Start a fresh high-water mark when the vault was empty: nobody can earn a fee on a donation.
    function _resetHwmIfEmpty(uint256 supplyBefore) internal {
        if (supplyBefore == 0) highWaterMark = _pps(totalAssets(), totalSupply());
    }

    // ───────────────────────────── ERC-4626 overrides ─────────────────────────────

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
        uint256 nav = totalAssets();
        return assets.mulDiv(_supplyAfterFee(nav) + 10 ** _decimalsOffset(), nav + 1, rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view override returns (uint256) {
        uint256 nav = totalAssets();
        return shares.mulDiv(nav + 1, _supplyAfterFee(nav) + 10 ** _decimalsOffset(), rounding);
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        if (depositCap == type(uint256).max) return type(uint256).max;
        (bool ok, uint256 nav) = _tryTotalAssets();
        if (!ok || nav >= depositCap) return 0;
        return depositCap - nav;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assets = maxDeposit(receiver);
        return assets == type(uint256).max ? type(uint256).max : _convertToShares(assets, Math.Rounding.Floor);
    }

    /// @dev Withdrawals in the base asset are limited to idle base-asset liquidity; use redeemInKind otherwise.
    ///      Returns 0 (instead of reverting) while a price feed is stale.
    function maxWithdraw(address owner_) public view override returns (uint256) {
        (bool ok, uint256 nav) = _tryTotalAssets();
        if (!ok) return 0;
        uint256 owned = balanceOf(owner_).mulDiv(nav + 1, _supplyAfterFee(nav) + 10 ** _decimalsOffset());
        return Math.min(owned, IERC20(asset()).balanceOf(address(this)));
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        (bool ok, uint256 nav) = _tryTotalAssets();
        if (!ok) return 0;
        uint256 idleShares = IERC20(asset()).balanceOf(address(this)).mulDiv(_supplyAfterFee(nav) + 10 ** _decimalsOffset(), nav + 1);
        return Math.min(balanceOf(owner_), idleShares);
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant whenNotPaused returns (uint256) {
        _harvest();
        uint256 supplyBefore = totalSupply();
        uint256 shares = super.deposit(assets, receiver);
        _resetHwmIfEmpty(supplyBefore);
        return shares;
    }

    function mint(uint256 shares, address receiver) public override nonReentrant whenNotPaused returns (uint256) {
        _harvest();
        uint256 supplyBefore = totalSupply();
        uint256 assets = super.mint(shares, receiver);
        _resetHwmIfEmpty(supplyBefore);
        return assets;
    }

    function withdraw(uint256 assets, address receiver, address owner_) public override nonReentrant returns (uint256) {
        _harvest();
        return super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_) public override nonReentrant returns (uint256) {
        _harvest();
        return super.redeem(shares, receiver, owner_);
    }

    /// @notice Always-available exit: burn shares for a pro-rata slice of every asset the vault holds.
    ///         Needs no price feed, works while paused.
    function redeemInKind(uint256 shares, address receiver, address owner_) external nonReentrant {
        _redeemInKind(shares, receiver, owner_, new address[](0));
    }

    /// @notice Same as redeemInKind, but leaves the listed tokens behind (e.g. a halted token whose transfer
    ///         reverts). The skipped slice stays in the vault for the remaining holders.
    function redeemInKindExcept(uint256 shares, address receiver, address owner_, address[] calldata skip)
        external
        nonReentrant
    {
        _redeemInKind(shares, receiver, owner_, skip);
    }

    function _redeemInKind(uint256 shares, address receiver, address owner_, address[] memory skip) internal {
        try this.harvestSelf() {} catch {}
        if (msg.sender != owner_) _spendAllowance(owner_, msg.sender, shares);
        uint256 supply = totalSupply();
        _burn(owner_, shares);
        if (totalSupply() == 0) highWaterMark = 10 ** _baseDecimals;
        _payOut(IERC20(asset()), shares, supply, receiver, skip);
        for (uint256 i; i < _assets.length; ++i) _payOut(IERC20(_assets[i]), shares, supply, receiver, skip);
        emit RedeemedInKind(owner_, receiver, shares);
    }

    function _payOut(IERC20 t, uint256 shares, uint256 supply, address receiver, address[] memory skip) internal {
        for (uint256 j; j < skip.length; ++j) if (skip[j] == address(t)) return;
        uint256 out = t.balanceOf(address(this)).mulDiv(shares, supply);
        if (out > 0) t.safeTransfer(receiver, out);
    }

    // ───────────────────────────── Admin ─────────────────────────────

    function setManager(address m) external onlyOwner {
        if (m == address(0)) revert InvalidConfig();
        _harvest();
        manager = m;
        emit ManagerSet(m);
    }

    function setFeeRecipient(address r) external onlyOwner {
        if (r == address(0)) revert InvalidConfig();
        feeRecipient = r;
        emit FeeRecipientSet(r);
    }

    function setShieldSigner(address signer, bool allowed) external onlyOwner {
        _setShieldSigner(signer, allowed);
    }

    function setDepositCap(uint256 cap) external onlyOwner {
        depositCap = cap;
        emit DepositCapSet(cap);
    }

    function setLimits(uint16 tradeBps, uint16 lossBps, uint16 dailyLossBps) external onlyOwner {
        _setLimits(tradeBps, lossBps, dailyLossBps);
    }

    function setCall(address target, bytes4 selector, bool allowed) external onlyOwner {
        _setCall(target, selector, allowed);
    }

    /// @notice Owner can always revoke an allowance the vault gave, even to a de-listed spender.
    function revokeApproval(address token, address spender) external onlyOwner {
        IERC20(token).forceApprove(spender, 0);
    }

    /// @notice Replace the price feed of a tracked asset (e.g. a feed that was retired).
    function setFeed(address token, address feed, uint32 heartbeat) external onlyOwner {
        if (!assetConfig[token].enabled || feed == address(0) || heartbeat == 0 || heartbeat > MAX_HEARTBEAT) revert InvalidConfig();
        assetConfig[token].feed = IPriceFeed(feed);
        assetConfig[token].heartbeat = heartbeat;
        assetConfig[token].feedDecimals = IPriceFeed(feed).decimals();
        emit FeedSet(token, feed, heartbeat);
    }

    function setSpender(address spender, bool allowed) external onlyOwner {
        _setSpender(spender, allowed);
    }

    function addAsset(address token, address feed, uint32 heartbeat) external onlyOwner {
        _addAsset(token, feed, heartbeat);
    }

    function removeAsset(address token) external onlyOwner {
        if (IERC20(token).balanceOf(address(this)) > 0) revert AssetHasBalance(token);
        delete assetConfig[token];
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            if (_assets[i] == token) {
                _assets[i] = _assets[n - 1];
                _assets.pop();
                break;
            }
        }
        emit AssetRemoved(token);
    }

    function pause() external {
        if (msg.sender != owner() && msg.sender != guardian) revert OwnableUnauthorizedAccount(msg.sender);
        _pause();
    }

    function setGuardian(address g) external onlyOwner {
        guardian = g;
        emit GuardianSet(g);
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _setLimits(uint16 tradeBps, uint16 lossBps, uint16 dailyLossBps) internal {
        if (
            tradeBps == 0 || tradeBps > BPS || lossBps > MAX_LOSS_CAP_BPS || dailyLossBps > MAX_DAILY_LOSS_CAP_BPS
                || dailyLossBps < lossBps
        ) revert InvalidConfig();
        maxTradeBps = tradeBps;
        maxLossBps = lossBps;
        maxDailyLossBps = dailyLossBps;
        emit LimitsSet(tradeBps, lossBps, dailyLossBps);
    }

    function _setCall(address target, bytes4 selector, bool allowed) internal {
        if (target == address(0) || target == address(this) || target == asset()) revert InvalidConfig();
        // multicall wraps arbitrary calls, so no recipient or selector check could see inside it
        if (allowed && (selector == 0xac9650d8 || selector == 0x5ae401dc || selector == 0x1f0464d1)) revert InvalidConfig();
        allowedCall[target][selector] = allowed;
        emit CallSet(target, selector, allowed);
    }

    function _setSpender(address spender, bool allowed) internal {
        allowedSpender[spender] = allowed;
        emit SpenderSet(spender, allowed);
    }

    function _addAsset(address token, address feed, uint32 heartbeat) internal {
        if (token == address(0) || feed == address(0) || heartbeat == 0 || heartbeat > MAX_HEARTBEAT || token == asset()) revert InvalidConfig();
        if (token == address(this)) revert InvalidConfig();
        if (assetConfig[token].enabled) revert InvalidConfig();
        if (_assets.length >= MAX_ASSETS) revert InvalidConfig();
        assetConfig[token] =
            TrackedAsset(IPriceFeed(feed), heartbeat, IERC20Metadata(token).decimals(), IPriceFeed(feed).decimals(), true);
        _assets.push(token);
        emit AssetAdded(token, feed, heartbeat);
    }
}
