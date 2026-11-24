// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPriceFeed} from "./interfaces/IPriceFeed.sol";

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title HeimdallAutoInvest
/// @notice Recurring buys of stock tokens with USDG, straight from the user's own wallet.
///         The user approves a USDG budget and sets: which stock, how much per buy, how often, how many buys, and the
///         worst price they accept versus the Chainlink oracle. A keeper (anyone) executes due buys. The keeper can
///         never change the amount, the recipient (always the user) or accept a price worse than the user's bound,
///         and nothing executes while the oracle is stale or paused. USDG stays in the user's wallet until each buy.
contract HeimdallAutoInvest is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Asset {
        IPriceFeed feed;     // price of 1 token in USDG (HeimdallStockFeed adapter), 8 decimals typical
        uint24 poolFee;      // Uniswap v3 fee tier of the USDG/token pool
        uint32 maxAge;       // oracle staleness bound (seconds)
        bool enabled;
    }

    struct Plan {
        address owner;
        address token;       // stock token bought
        uint96 amountPerBuy; // USDG raw units per buy (before fee)
        uint32 interval;     // seconds between buys
        uint16 maxSlippageBps; // worst accepted price vs oracle
        uint16 buysLeft;
        uint64 nextBuyAt;
        bool active;
        uint16 feeBps;       // protocol fee locked in when the plan is created
    }

    uint32 public constant MIN_INTERVAL = 1 hours;
    uint16 public constant MAX_SLIPPAGE_BPS = 500; // 5%
    uint16 public constant MAX_FEE_BPS = 100;      // 1%

    IERC20 public immutable usdg;
    uint8 private immutable _usdgDecimals;
    ISwapRouter02 public immutable router;
    address public feeRecipient;
    uint16 public feeBps = 25; // 0.25%, for new plans
    uint256 public accruedFees; // USDG fees held until sweepFees(), so a frozen fee recipient can never block a buy

    mapping(address => Asset) public assets;
    Plan[] internal _plans;
    mapping(address => uint256[]) internal _byOwner;

    event AssetSet(address indexed token, address feed, uint24 poolFee, uint32 maxAge, bool enabled);
    event PlanCreated(uint256 indexed id, address indexed owner, address indexed token, uint256 amountPerBuy, uint32 interval, uint16 buys, uint16 maxSlippageBps);
    event PlanCancelled(uint256 indexed id);
    event Bought(uint256 indexed id, address indexed owner, address indexed token, uint256 usdgIn, uint256 tokenOut, uint256 fee, uint256 oraclePrice);
    event FeeSet(uint16 feeBps, address feeRecipient);
    event FeesSwept(address indexed to, uint256 amount);

    error InvalidConfig();
    error NotOwner();
    error NotDue();
    error Inactive();
    error OracleUnavailable();

    constructor(IERC20 usdg_, ISwapRouter02 router_, address owner_, address feeRecipient_) Ownable(owner_) {
        if (address(usdg_) == address(0) || address(router_) == address(0) || feeRecipient_ == address(0)) revert InvalidConfig();
        usdg = usdg_;
        router = router_;
        feeRecipient = feeRecipient_;
        _usdgDecimals = IERC20Metadata(address(usdg_)).decimals();
    }

    // ── views ────────────────────────────────────────────
    function planCount() external view returns (uint256) { return _plans.length; }
    function getPlan(uint256 id) external view returns (Plan memory) { return _plans[id]; }
    function plansOf(address a) external view returns (uint256[] memory) { return _byOwner[a]; }

    function isDue(uint256 id) public view returns (bool) {
        Plan storage p = _plans[id];
        return p.active && p.buysLeft > 0 && block.timestamp >= p.nextBuyAt;
    }

    /// @notice Oracle price of one whole `token` in USDG raw units, or 0 when stale/paused/missing.
    function oraclePrice(address token) public view returns (uint256) {
        Asset storage a = assets[token];
        if (!a.enabled) return 0;
        (bool ok, bytes memory ret) = address(a.feed).staticcall(abi.encodeCall(IPriceFeed.latestRoundData, ()));
        if (!ok || ret.length < 160) return 0;
        (, int256 answer,, uint256 updatedAt,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > a.maxAge) return 0;
        uint8 fd = a.feed.decimals();
        return uint256(answer) * 10 ** _usdgDecimals / 10 ** fd;
    }

    // ── user ─────────────────────────────────────────────
    /// @notice Start a plan at today's fee, which stays fixed for the plan's life. The first buy is due immediately. Approve `amountPerBuy * buys` USDG to this contract.
    function createPlan(address token, uint96 amountPerBuy, uint32 interval, uint16 buys, uint16 maxSlippageBps) external returns (uint256 id) {
        if (!assets[token].enabled || amountPerBuy == 0 || interval < MIN_INTERVAL || buys == 0 || maxSlippageBps > MAX_SLIPPAGE_BPS) revert InvalidConfig();
        id = _plans.length;
        _plans.push(Plan(msg.sender, token, amountPerBuy, interval, maxSlippageBps, buys, uint64(block.timestamp), true, feeBps));
        _byOwner[msg.sender].push(id);
        emit PlanCreated(id, msg.sender, token, amountPerBuy, interval, buys, maxSlippageBps);
    }

    function cancelPlan(uint256 id) external {
        Plan storage p = _plans[id];
        if (msg.sender != p.owner) revert NotOwner();
        p.active = false;
        emit PlanCancelled(id);
    }

    // ── keeper (anyone) ──────────────────────────────────
    /// @notice Execute a due buy. Pulls exactly `amountPerBuy` USDG from the owner, swaps on Uniswap v3 and sends the
    ///         tokens to the owner. Reverts unless the fill is within the owner's slippage bound of the oracle price.
    function execute(uint256 id) external nonReentrant returns (uint256 out) {
        Plan storage p = _plans[id];
        if (!p.active || p.buysLeft == 0) revert Inactive();
        if (block.timestamp < p.nextBuyAt) revert NotDue();
        uint256 price = oraclePrice(p.token);
        if (price == 0) revert OracleUnavailable();

        // effects before interactions (the whole call reverts together if the swap fails its bound)
        p.buysLeft -= 1;
        p.nextBuyAt = uint64(block.timestamp) + p.interval; // no catch-up bursts after downtime
        if (p.buysLeft == 0) p.active = false;

        uint256 amount = p.amountPerBuy;
        uint256 fee = amount * p.feeBps / 10_000;
        uint256 swapIn = amount - fee;
        usdg.safeTransferFrom(p.owner, address(this), amount);
        accruedFees += fee;

        uint8 td = IERC20Metadata(p.token).decimals();
        uint256 fair = swapIn * 10 ** td / price;                           // tokens at the oracle price
        uint256 minOut = fair * (10_000 - p.maxSlippageBps) / 10_000;
        usdg.forceApprove(address(router), swapIn);
        out = router.exactInputSingle(ISwapRouter02.ExactInputSingleParams({
            tokenIn: address(usdg), tokenOut: p.token, fee: assets[p.token].poolFee, recipient: p.owner,
            amountIn: swapIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0
        }));
        usdg.forceApprove(address(router), 0);
        emit Bought(id, p.owner, p.token, swapIn, out, fee, price);
    }

    /// @notice Send accrued fees to the fee recipient. Anyone can call it.
    function sweepFees() external nonReentrant returns (uint256 amount) {
        amount = accruedFees;
        if (amount == 0) return 0;
        accruedFees = 0;
        usdg.safeTransfer(feeRecipient, amount);
        emit FeesSwept(feeRecipient, amount);
    }

    // ── admin (Safe) ─────────────────────────────────────
    function setAsset(address token, address feed, uint24 poolFee, uint32 maxAge, bool enabled) external onlyOwner {
        if (token == address(0) || (enabled && (feed == address(0) || maxAge == 0))) revert InvalidConfig();
        assets[token] = Asset(IPriceFeed(feed), poolFee, maxAge, enabled);
        emit AssetSet(token, feed, poolFee, maxAge, enabled);
    }

    function setFee(uint16 bps, address recipient) external onlyOwner {
        if (bps > MAX_FEE_BPS || recipient == address(0)) revert InvalidConfig();
        feeBps = bps;
        feeRecipient = recipient;
        emit FeeSet(bps, recipient);
    }
}
