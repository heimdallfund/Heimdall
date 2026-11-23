// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title HeimdallSignals
/// @notice Registry and pay-per-call settlement for agent signals, priced in USDG.
///         Two ways to pay:
///         1. `pay`: direct, one transaction per purchase (simple, onchain proof for the provider).
///         2. Vouchers: the agent pre-funds a balance, then signs a cumulative EIP-712 voucher per call offchain
///            (no gas). The provider redeems the latest voucher whenever it wants. Withdrawals of pre-funded
///            balances wait `withdrawDelay`, so providers can always redeem vouchers they accepted.
contract HeimdallSignals is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    struct Signal {
        address provider;
        address payout;
        uint128 pricePerCall; // in USDG base units
        bool active;
        string uri; // metadata: name, category, endpoint, schema
    }

    struct Voucher {
        address payer;
        uint256 signalId;
        uint256 cumulativeAmount; // total ever owed by `payer` to this signal
        uint256 deadline;
    }

    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address payer,uint256 signalId,uint256 cumulativeAmount,uint256 deadline)");
    uint16 public constant MAX_FEE_BPS = 2_000;
    uint256 public constant BPS = 10_000;

    IERC20 public immutable usdg;
    address public treasury;
    uint16 public feeBps = 1_000; // 10%
    uint16 public holderFeeBps = 500; // 5% when the payout wallet holds $HEIM
    uint64 public withdrawDelay = 1 days;
    uint64 public constant WITHDRAW_WINDOW = 3 days; // a request must be executed within this window, then expires
    address public heimToken;
    uint256 public holderMin = 100_000e18;

    Signal[] private _signals;
    mapping(address => uint256) public balanceOf; // pre-funded voucher balances
    mapping(address => uint256) public pendingWithdrawal;
    mapping(address => uint64) public withdrawableAt;
    mapping(address => mapping(uint256 => uint256)) public claimed; // payer => signalId => cumulative claimed

    event SignalRegistered(uint256 indexed id, address indexed provider, address payout, uint128 pricePerCall, string uri);
    event SignalUpdated(uint256 indexed id, address payout, uint128 pricePerCall, bool active, string uri);
    event Paid(uint256 indexed id, address indexed payer, uint256 calls, uint256 amount, uint256 fee, bytes32 requestId);
    event VoucherRedeemed(uint256 indexed id, address indexed payer, uint256 amount, uint256 fee, uint256 cumulative);
    event Funded(address indexed payer, uint256 amount);
    event WithdrawRequested(address indexed payer, uint256 amount, uint64 availableAt);
    event Withdrawn(address indexed payer, uint256 amount);
    event TreasurySet(address treasury);
    event FeeSet(uint16 feeBps);
    event WithdrawDelaySet(uint64 delay);
    event HolderTermsSet(address token, uint256 minBalance, uint16 feeBps);

    error NotProvider();
    error SignalInactive();
    error UnknownSignal();
    error ZeroAmount();
    error InvalidVoucher();
    error VoucherExpired();
    error NothingToClaim();
    error InsufficientBalance();
    error WithdrawLocked(uint64 availableAt);
    error InvalidConfig();
    error PriceAboveMax(uint256 price, uint256 maxPrice);
    error WithdrawExpired();

    constructor(IERC20 usdg_, address owner_, address treasury_) Ownable(owner_) EIP712("Heimdall Signals", "1") {
        if (address(usdg_) == address(0) || treasury_ == address(0)) revert InvalidConfig();
        usdg = usdg_;
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    // ───────────────────────────── Registry ─────────────────────────────

    function register(string calldata uri, uint128 pricePerCall, address payout) external returns (uint256 id) {
        if (pricePerCall == 0) revert ZeroAmount();
        if (payout == address(0)) payout = msg.sender;
        id = _signals.length;
        _signals.push(Signal(msg.sender, payout, pricePerCall, true, uri));
        emit SignalRegistered(id, msg.sender, payout, pricePerCall, uri);
    }

    function update(uint256 id, string calldata uri, uint128 pricePerCall, address payout, bool active) external {
        Signal storage s = _get(id);
        if (msg.sender != s.provider) revert NotProvider();
        if (pricePerCall == 0 || payout == address(0)) revert InvalidConfig();
        s.uri = uri;
        s.pricePerCall = pricePerCall;
        s.payout = payout;
        s.active = active;
        emit SignalUpdated(id, payout, pricePerCall, active, uri);
    }

    function getSignal(uint256 id) external view returns (Signal memory) {
        return _get(id);
    }

    function signalCount() external view returns (uint256) {
        return _signals.length;
    }

    // ───────────────────────────── Direct payment ─────────────────────────────

    /// @notice Pay for `calls` calls of signal `id`. `requestId` lets the provider match the payment to a request.
    ///         `maxPricePerCall` protects against the provider raising the price before this transaction lands.
    function pay(uint256 id, uint256 calls, bytes32 requestId, uint256 maxPricePerCall)
        external
        nonReentrant
        returns (uint256 amount)
    {
        Signal storage s = _get(id);
        if (!s.active) revert SignalInactive();
        if (calls == 0) revert ZeroAmount();
        if (s.pricePerCall > maxPricePerCall) revert PriceAboveMax(s.pricePerCall, maxPricePerCall);
        amount = uint256(s.pricePerCall) * calls;
        uint256 fee = amount * feeFor(s.payout) / BPS;
        usdg.safeTransferFrom(msg.sender, s.payout, amount - fee);
        if (fee > 0) usdg.safeTransferFrom(msg.sender, treasury, fee);
        emit Paid(id, msg.sender, calls, amount, fee, requestId);
    }

    // ───────────────────────────── Vouchers ─────────────────────────────

    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        usdg.safeTransferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        emit Funded(msg.sender, amount);
    }

    /// @notice Balance that new vouchers can safely rely on: pre-funded balance minus any pending withdrawal.
    function available(address payer) public view returns (uint256) {
        uint256 b = balanceOf[payer];
        uint256 p = pendingWithdrawal[payer];
        return p >= b ? 0 : b - p;
    }

    /// @notice Fee in bps for a payout wallet: reduced when it holds at least `holderMin` $HEIM.
    function feeFor(address payout) public view returns (uint256) {
        if (heimToken == address(0)) return feeBps;
        (bool ok, bytes memory ret) = heimToken.staticcall(abi.encodeCall(IERC20.balanceOf, (payout)));
        bool holder = ok && ret.length >= 32 && abi.decode(ret, (uint256)) >= holderMin;
        return holder && holderFeeBps < feeBps ? holderFeeBps : feeBps;
    }

    /// @notice Start a withdrawal. The amount stops counting towards `available` immediately, stays redeemable
    ///         by providers until `withdrawDelay` passes, and must be withdrawn within WITHDRAW_WINDOW after that.
    function requestWithdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (amount > balanceOf[msg.sender]) revert InsufficientBalance();
        pendingWithdrawal[msg.sender] = amount;
        uint64 at = uint64(block.timestamp) + withdrawDelay;
        withdrawableAt[msg.sender] = at;
        emit WithdrawRequested(msg.sender, amount, at);
    }

    function withdraw() external nonReentrant {
        uint64 at = withdrawableAt[msg.sender];
        if (at == 0 || block.timestamp < at) revert WithdrawLocked(at);
        if (block.timestamp > at + WITHDRAW_WINDOW) revert WithdrawExpired();
        uint256 amount = pendingWithdrawal[msg.sender];
        if (amount > balanceOf[msg.sender]) amount = balanceOf[msg.sender]; // vouchers may have been redeemed meanwhile
        pendingWithdrawal[msg.sender] = 0;
        withdrawableAt[msg.sender] = 0;
        if (amount == 0) revert ZeroAmount();
        balanceOf[msg.sender] -= amount;
        usdg.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function voucherDigest(Voucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, v.payer, v.signalId, v.cumulativeAmount, v.deadline)));
    }

    /// @notice Provider (or anyone) redeems the latest cumulative voucher; pays out the unclaimed difference.
    function redeem(Voucher calldata v, bytes calldata signature) external nonReentrant returns (uint256 amount) {
        Signal storage s = _get(v.signalId);
        if (v.deadline < block.timestamp) revert VoucherExpired();
        if (!SignatureChecker.isValidSignatureNow(v.payer, voucherDigest(v), signature)) revert InvalidVoucher();
        uint256 already = claimed[v.payer][v.signalId];
        if (v.cumulativeAmount <= already) revert NothingToClaim();
        amount = v.cumulativeAmount - already;
        if (amount > balanceOf[v.payer]) revert InsufficientBalance();
        claimed[v.payer][v.signalId] = v.cumulativeAmount;
        balanceOf[v.payer] -= amount;
        uint256 fee = amount * feeFor(s.payout) / BPS;
        usdg.safeTransfer(s.payout, amount - fee);
        if (fee > 0) usdg.safeTransfer(treasury, fee);
        emit VoucherRedeemed(v.signalId, v.payer, amount, fee, v.cumulativeAmount);
    }

    // ───────────────────────────── Admin ─────────────────────────────

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert InvalidConfig();
        treasury = t;
        emit TreasurySet(t);
    }

    function setFee(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert InvalidConfig();
        feeBps = bps;
        emit FeeSet(bps);
    }

    function setHolderTerms(address token, uint256 minBalance, uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert InvalidConfig();
        heimToken = token;
        holderMin = minBalance;
        holderFeeBps = bps;
        emit HolderTermsSet(token, minBalance, bps);
    }

    function setWithdrawDelay(uint64 delay) external onlyOwner {
        if (delay > 7 days) revert InvalidConfig();
        withdrawDelay = delay;
        emit WithdrawDelaySet(delay);
    }

    function _get(uint256 id) internal view returns (Signal storage) {
        if (id >= _signals.length) revert UnknownSignal();
        return _signals[id];
    }
}
