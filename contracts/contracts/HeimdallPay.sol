// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HeimdallPay
/// @notice USDG escrow for work between agents (or people). A client funds a job; the provider delivers and submits
///         a hash of the result; the money is released when the client approves, when the review window passes
///         without a dispute, or by the arbiter the client picked. Unfinished jobs refund after their deadline.
///
///         Open ──submit──▶ Submitted ──release / review window──▶ Released
///          │                  └──dispute──▶ Disputed ──arbiter resolve(split)──▶ Resolved
///          └──deadline passed──▶ refund ──▶ Refunded          (provider may also cancel ──▶ Refunded)
///
/// @dev Every job's escrow is paid out exactly once: provider + client + arbiter fee + protocol fee == amount.
contract HeimdallPay is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Submitted, Disputed, Released, Refunded, Resolved }

    struct Job {
        address client;
        address provider;
        address arbiter;        // may be zero: then the job cannot be disputed
        uint96 amount;          // USDG escrowed (raw units)
        uint64 deadline;        // provider must submit before this
        uint32 reviewWindow;    // seconds the client has to release or dispute after a submission
        uint64 submittedAt;
        uint16 arbiterFeeBps;   // paid to the arbiter only when it resolves a dispute
        uint16 feeBps;          // protocol fee, fixed when the job is created
        uint64 disputedAt;
        Status status;
        bytes32 specHash;       // hash of the task (off-chain spec)
        bytes32 resultHash;     // hash of what was delivered
    }

    uint16 public constant MAX_FEE_BPS = 300;          // protocol fee cap: 3%
    uint16 public constant MAX_ARBITER_FEE_BPS = 1_000; // 10%
    uint32 public constant MIN_REVIEW = 1 hours;
    uint32 public constant MAX_REVIEW = 30 days;
    /// @notice Smallest job (1 USDG): keeps fees non-zero, so the public record cannot be farmed for free.
    uint96 public constant MIN_AMOUNT = 1e6;
    /// @notice An arbiter that has not ruled after this long can be bypassed: the escrow is split 50/50.
    uint32 public constant DISPUTE_TIMEOUT = 14 days;

    IERC20 public immutable usdg;
    address public feeRecipient;
    uint16 public feeBps = 100; // 1%

    Job[] internal _jobs;
    mapping(address => uint256[]) internal _byClient;
    mapping(address => uint256[]) internal _byProvider;
    /// @notice Public track record of every provider, for reputation and badges.
    mapping(address => uint256) public completedOf;
    mapping(address => uint256) public disputedOf;
    mapping(address => uint256) public earnedOf;
    /// @notice Payouts that could not be pushed (e.g. a frozen address); the owner of the balance pulls it later.
    mapping(address => uint256) public owed;
    uint256 public totalOwed;

    event JobCreated(uint256 indexed id, address indexed client, address indexed provider, address arbiter, uint256 amount, uint64 deadline, uint32 reviewWindow, bytes32 specHash);
    event JobSubmitted(uint256 indexed id, bytes32 resultHash);
    event JobReleased(uint256 indexed id, uint256 toProvider, uint256 fee, bool automatic);
    event JobRefunded(uint256 indexed id, uint256 amount);
    event JobDisputed(uint256 indexed id, string reason);
    event JobResolved(uint256 indexed id, uint256 toProvider, uint256 toClient, uint256 arbiterFee, uint256 fee);
    event FeeSet(uint16 feeBps, address feeRecipient);
    event DisputeExpired(uint256 indexed id, uint256 toProvider, uint256 toClient, uint256 fee);
    event PayoutDeferred(address indexed to, uint256 amount);
    event OwedWithdrawn(address indexed to, uint256 amount);

    error InvalidConfig();
    error NotAllowed();
    error WrongStatus(Status status);
    error TooEarly();
    error TooLate();

    constructor(IERC20 usdg_, address owner_, address feeRecipient_) Ownable(owner_) {
        if (address(usdg_) == address(0) || feeRecipient_ == address(0)) revert InvalidConfig();
        usdg = usdg_;
        feeRecipient = feeRecipient_;
        emit FeeSet(feeBps, feeRecipient_);
    }

    // ── views ────────────────────────────────────────────
    function jobCount() external view returns (uint256) { return _jobs.length; }
    function getJob(uint256 id) external view returns (Job memory) { return _jobs[id]; }
    function jobsOfClient(address a) external view returns (uint256[] memory) { return _byClient[a]; }
    function jobsOfProvider(address a) external view returns (uint256[] memory) { return _byProvider[a]; }

    /// @notice True once a submitted job can be released by anyone because the client let the review window pass.
    function autoReleasable(uint256 id) public view returns (bool) {
        Job storage j = _jobs[id];
        return j.status == Status.Submitted && block.timestamp >= uint256(j.submittedAt) + j.reviewWindow;
    }

    // ── client ───────────────────────────────────────────
    function createJob(address provider, address arbiter, uint96 amount, uint64 deadline, uint32 reviewWindow, uint16 arbiterFeeBps, bytes32 specHash)
        external nonReentrant returns (uint256 id)
    {
        if (provider == address(0) || provider == msg.sender || arbiter == msg.sender || arbiter == provider) revert InvalidConfig();
        if (amount < MIN_AMOUNT || deadline <= block.timestamp || reviewWindow < MIN_REVIEW || reviewWindow > MAX_REVIEW) revert InvalidConfig();
        if (arbiterFeeBps > MAX_ARBITER_FEE_BPS || (arbiter == address(0) && arbiterFeeBps != 0)) revert InvalidConfig();
        usdg.safeTransferFrom(msg.sender, address(this), amount);
        id = _jobs.length;
        _jobs.push(Job(msg.sender, provider, arbiter, amount, deadline, reviewWindow, 0, arbiterFeeBps, feeBps, 0, Status.Open, specHash, bytes32(0)));
        _byClient[msg.sender].push(id);
        _byProvider[provider].push(id);
        emit JobCreated(id, msg.sender, provider, arbiter, amount, deadline, reviewWindow, specHash);
    }

    /// @notice Client approves the work (any time before a dispute). Pays the provider minus the protocol fee.
    function release(uint256 id) external nonReentrant {
        Job storage j = _jobs[id];
        if (msg.sender != j.client) revert NotAllowed();
        if (j.status != Status.Open && j.status != Status.Submitted) revert WrongStatus(j.status);
        _release(id, j, false);
    }

    /// @notice Client disputes a submission inside the review window. Needs an arbiter.
    function dispute(uint256 id, string calldata reason) external {
        Job storage j = _jobs[id];
        if (msg.sender != j.client || j.arbiter == address(0)) revert NotAllowed();
        if (j.status != Status.Submitted) revert WrongStatus(j.status);
        if (autoReleasable(id)) revert TooLate();
        j.status = Status.Disputed;
        j.disputedAt = uint64(block.timestamp);
        disputedOf[j.provider] += 1;
        emit JobDisputed(id, reason);
    }

    /// @notice Refund an open job whose deadline passed without a submission. Anyone may call; funds go to the client.
    function refund(uint256 id) external nonReentrant {
        Job storage j = _jobs[id];
        if (j.status != Status.Open) revert WrongStatus(j.status);
        if (block.timestamp <= j.deadline) revert TooEarly();
        _refund(id, j);
    }

    // ── provider ─────────────────────────────────────────
    /// @notice Deliver. Submitting means the provider accepts the job's terms, including the arbiter the client chose:
    ///         check `getJob(id).arbiter` before starting work.
    function submit(uint256 id, bytes32 resultHash) external {
        Job storage j = _jobs[id];
        if (msg.sender != j.provider) revert NotAllowed();
        if (j.status != Status.Open) revert WrongStatus(j.status);
        if (block.timestamp > j.deadline) revert TooLate();
        j.status = Status.Submitted;
        j.submittedAt = uint64(block.timestamp);
        j.resultHash = resultHash;
        emit JobSubmitted(id, resultHash);
    }

    /// @notice Provider declines or gives up: the client is refunded in full.
    function cancel(uint256 id) external nonReentrant {
        Job storage j = _jobs[id];
        if (msg.sender != j.provider) revert NotAllowed();
        if (j.status != Status.Open && j.status != Status.Submitted) revert WrongStatus(j.status);
        _refund(id, j);
    }

    /// @notice After the review window, anyone can release a submitted job the client did not dispute.
    function claim(uint256 id) external nonReentrant {
        Job storage j = _jobs[id];
        if (!autoReleasable(id)) revert TooEarly();
        _release(id, j, true);
    }

    // ── arbiter ──────────────────────────────────────────
    /// @notice Split a disputed job: `providerBps` of what remains after fees goes to the provider, the rest back to the client.
    function resolve(uint256 id, uint16 providerBps) external nonReentrant {
        Job storage j = _jobs[id];
        if (msg.sender != j.arbiter) revert NotAllowed();
        if (j.status != Status.Disputed) revert WrongStatus(j.status);
        if (providerBps > 10_000) revert InvalidConfig();
        j.status = Status.Resolved;
        uint256 amount = j.amount;
        uint256 arbFee = amount * j.arbiterFeeBps / 10_000;
        uint256 rest = amount - arbFee;
        uint256 grossProvider = rest * providerBps / 10_000;
        uint256 fee = grossProvider * j.feeBps / 10_000; // protocol fee only on what the provider earns
        uint256 toProvider = grossProvider - fee;
        uint256 toClient = rest - grossProvider;
        if (toProvider > 0) earnedOf[j.provider] += toProvider;
        _pay(j.arbiter, arbFee);
        _pay(feeRecipient, fee);
        _pay(j.provider, toProvider);
        _pay(j.client, toClient);
        emit JobResolved(id, toProvider, toClient, arbFee, fee);
    }

    /// @notice If the arbiter has not ruled DISPUTE_TIMEOUT after a dispute, anyone can split the escrow 50/50.
    ///         The arbiter earns nothing; the protocol fee applies to the provider's half only.
    function settleExpiredDispute(uint256 id) external nonReentrant {
        Job storage j = _jobs[id];
        if (j.status != Status.Disputed) revert WrongStatus(j.status);
        if (block.timestamp < uint256(j.disputedAt) + DISPUTE_TIMEOUT) revert TooEarly();
        j.status = Status.Resolved;
        uint256 gross = uint256(j.amount) / 2;
        uint256 fee = gross * j.feeBps / 10_000;
        uint256 toProvider = gross - fee;
        uint256 toClient = j.amount - gross;
        earnedOf[j.provider] += toProvider;
        _pay(feeRecipient, fee);
        _pay(j.provider, toProvider);
        _pay(j.client, toClient);
        emit DisputeExpired(id, toProvider, toClient, fee);
    }

    /// @notice Pull a payout that could not be pushed earlier.
    function withdrawOwed() external nonReentrant {
        uint256 amt = owed[msg.sender];
        if (amt == 0) revert NotAllowed();
        owed[msg.sender] = 0;
        totalOwed -= amt;
        usdg.safeTransfer(msg.sender, amt);
        emit OwedWithdrawn(msg.sender, amt);
    }

    // ── internal ─────────────────────────────────────────
    function _release(uint256 id, Job storage j, bool automatic) internal {
        j.status = Status.Released;
        uint256 fee = uint256(j.amount) * j.feeBps / 10_000;
        uint256 toProvider = j.amount - fee;
        completedOf[j.provider] += 1;
        earnedOf[j.provider] += toProvider;
        _pay(feeRecipient, fee);
        _pay(j.provider, toProvider);
        emit JobReleased(id, toProvider, fee, automatic);
    }

    function _refund(uint256 id, Job storage j) internal {
        j.status = Status.Refunded;
        _pay(j.client, j.amount);
        emit JobRefunded(id, j.amount);
    }

    /// @dev Push a payout; if the transfer fails (e.g. the address is frozen by the token issuer), record it as owed
    ///      instead of reverting, so one bad address can never block other parties or other jobs.
    function _pay(address to, uint256 amt) internal {
        if (amt == 0) return;
        (bool ok, bytes memory ret) = address(usdg).call(abi.encodeCall(IERC20.transfer, (to, amt)));
        if (ok && (ret.length == 0 || abi.decode(ret, (bool)))) return;
        owed[to] += amt;
        totalOwed += amt;
        emit PayoutDeferred(to, amt);
    }

    // ── admin (Safe) ─────────────────────────────────────
    function setFee(uint16 bps, address recipient) external onlyOwner {
        if (bps > MAX_FEE_BPS || recipient == address(0)) revert InvalidConfig();
        feeBps = bps;
        feeRecipient = recipient;
        emit FeeSet(bps, recipient);
    }
}
