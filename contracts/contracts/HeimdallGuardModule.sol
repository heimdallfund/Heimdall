// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ShieldGuarded} from "./ShieldGuarded.sol";

interface ISafeModuleTarget {
    function execTransactionFromModuleReturnData(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        returns (bool success, bytes memory returnData);
}

/// @title HeimdallGuardModule
/// @notice A Safe module that lets an AI agent spend from a Safe, but only through Heimdall Shield and within limits
///         the Safe's owners set. The owners keep full control of the Safe; the agent never becomes an owner.
///
///         Every agent call needs a fresh Shield ALLOW receipt for exactly that call, and is checked against:
///         - ETH per 24 h, and per-token limits per 24 h (transfers and approvals count; unlimited approvals of a
///           limited token are impossible),
///         - optional allowlists of targets and tokens,
///         - an expiry per agent, and a pause.
///         The agent can never call the Safe itself or this module, so it cannot add owners, enable modules or raise
///         its own limits. Calls are always CALL, never DELEGATECALL.
///
/// @dev One module serves every Safe. Each Safe configures its own namespace (msg.sender = the Safe) through its own
///      transactions. The module owner (Heimdall's multisig) can only manage the default Shield signers; a Safe can
///      pin its own signer instead (for a self-hosted Shield).
contract HeimdallGuardModule is ShieldGuarded, Ownable2Step, ReentrancyGuard {
    struct AgentConfig {
        bool active;
        uint64 expiresAt; // 0 = no expiry
    }

    struct Policy {
        uint128 ethPerDay; // wei the agents may send per 24 h (0 = none)
        bool strictTokens; // token transfers/approvals only for tokens with a limit
        bool strictTargets; // calls only to allowlisted targets (limited tokens count as allowlisted)
    }

    struct Window {
        uint64 start;
        uint192 spent;
    }

    uint256 public constant WINDOW = 1 days;
    uint8 private constant OP_CALL = 0;

    bytes4 private constant TRANSFER = 0xa9059cbb; // transfer(address,uint256)
    bytes4 private constant APPROVE = 0x095ea7b3; // approve(address,uint256)
    bytes4 private constant TRANSFER_FROM = 0x23b872dd; // transferFrom(address,address,uint256)
    bytes4 private constant INCREASE_ALLOWANCE = 0x39509351; // increaseAllowance(address,uint256)
    bytes4 private constant SET_APPROVAL_FOR_ALL = 0xa22cb465; // setApprovalForAll(address,bool)
    bytes4 private constant DECREASE_ALLOWANCE = 0xa457c2d7; // decreaseAllowance(address,uint256)

    mapping(address safe => mapping(address agent => AgentConfig)) public agentOf;
    mapping(address safe => Policy) public policyOf;
    mapping(address safe => mapping(address token => uint256)) public tokenPerDay;
    mapping(address safe => mapping(address token => bool)) public tokenListed;
    mapping(address safe => mapping(address target => bool)) public targetAllowed;
    /// @dev asset address(0) = ETH
    mapping(address safe => mapping(address asset => Window)) public windowOf;
    mapping(address safe => bool) public paused;
    /// @notice A Safe may require receipts from one specific signer instead of the default Shield signers.
    mapping(address safe => address) public signerOverride;

    event AgentSet(address indexed safe, address indexed agent, bool active, uint64 expiresAt);
    event PolicySet(address indexed safe, uint128 ethPerDay, bool strictTokens, bool strictTargets);
    event TokenLimitSet(address indexed safe, address indexed token, uint256 perDay, bool listed);
    event TargetSet(address indexed safe, address indexed target, bool allowed);
    event PausedSet(address indexed safe, bool paused);
    event SignerOverrideSet(address indexed safe, address signer);
    event Executed(address indexed safe, address indexed agent, address indexed to, uint256 value, bytes4 selector, bytes32 checkId);

    error NotAgent(address agent);
    error AgentExpired(uint64 expiresAt);
    error SafePaused();
    error ForbiddenTarget(address to);
    error TargetNotAllowed(address to);
    error TokenNotAllowed(address token);
    error LimitExceeded(address asset, uint256 wanted, uint256 left);
    error CallFailed(bytes returnData);

    constructor(address owner_, address shieldSigner) Ownable(owner_) {
        if (shieldSigner != address(0)) _setShieldSigner(shieldSigner, true);
    }

    // ── Safe configuration (msg.sender = the Safe) ───────

    function setAgent(address agent, bool active, uint64 expiresAt) external {
        agentOf[msg.sender][agent] = AgentConfig(active, expiresAt);
        emit AgentSet(msg.sender, agent, active, expiresAt);
    }

    function setPolicy(uint128 ethPerDay, bool strictTokens, bool strictTargets) external {
        policyOf[msg.sender] = Policy(ethPerDay, strictTokens, strictTargets);
        emit PolicySet(msg.sender, ethPerDay, strictTokens, strictTargets);
    }

    /// @notice Limit a token (raw units per 24 h). `listed = false` removes the limit and the listing.
    function setTokenLimit(address token, uint256 perDay, bool listed) external {
        tokenPerDay[msg.sender][token] = listed ? perDay : 0;
        tokenListed[msg.sender][token] = listed;
        emit TokenLimitSet(msg.sender, token, perDay, listed);
    }

    function setTarget(address target, bool allowed) external {
        targetAllowed[msg.sender][target] = allowed;
        emit TargetSet(msg.sender, target, allowed);
    }

    function setPaused(bool p) external {
        paused[msg.sender] = p;
        emit PausedSet(msg.sender, p);
    }

    function setSignerOverride(address signer) external {
        signerOverride[msg.sender] = signer;
        emit SignerOverrideSet(msg.sender, signer);
    }

    // ── module owner (Heimdall multisig) ─────────────────

    function setShieldSigner(address signer, bool allowed) external onlyOwner {
        _setShieldSigner(signer, allowed);
    }

    // ── views ────────────────────────────────────────────

    /// @notice What is left to spend of `asset` (address(0) = ETH) in the current 24 h window.
    function remaining(address safe, address asset) public view returns (uint256) {
        uint256 limit = asset == address(0) ? policyOf[safe].ethPerDay : tokenPerDay[safe][asset];
        Window memory w = windowOf[safe][asset];
        if (block.timestamp >= uint256(w.start) + WINDOW) return limit;
        return w.spent >= limit ? 0 : limit - w.spent;
    }

    // ── agent ────────────────────────────────────────────

    /// @notice Execute `to.call{value}(data)` from `safe`, with a Shield receipt issued for the Safe as the sender.
    function execute(address safe, address to, uint256 value, bytes calldata data, Receipt calldata receipt, bytes calldata signature)
        external
        nonReentrant
        returns (bytes memory result)
    {
        if (paused[safe]) revert SafePaused();
        AgentConfig memory a = agentOf[safe][msg.sender];
        if (!a.active) revert NotAgent(msg.sender);
        if (a.expiresAt != 0 && block.timestamp > a.expiresAt) revert AgentExpired(a.expiresAt);
        if (to == safe || to == address(this)) revert ForbiddenTarget(to);

        Policy memory p = policyOf[safe];
        bool listed = tokenListed[safe][to];
        if (p.strictTargets && !listed && !targetAllowed[safe][to]) revert TargetNotAllowed(to);

        _consumeReceiptFor(safe, to, data, value, receipt, signature);

        if (value > 0) _spend(safe, address(0), value, p.ethPerDay);
        bytes4 selector = data.length >= 4 ? bytes4(data[:4]) : bytes4(0);
        _checkTokenCall(safe, to, data, selector, listed, p.strictTokens);

        bool ok;
        (ok, result) = ISafeModuleTarget(safe).execTransactionFromModuleReturnData(to, value, data, OP_CALL);
        if (!ok) revert CallFailed(result);
        emit Executed(safe, msg.sender, to, value, selector, receipt.checkId);
    }

    // ── internal ─────────────────────────────────────────

    function _checkTokenCall(address safe, address token, bytes calldata data, bytes4 selector, bool listed, bool strict) internal {
        uint256 amount;
        bool moves;
        if ((selector == TRANSFER || selector == APPROVE || selector == INCREASE_ALLOWANCE) && data.length >= 68) {
            (, amount) = abi.decode(data[4:68], (address, uint256));
            moves = true;
        } else if (selector == TRANSFER_FROM && data.length >= 100) {
            (address from,, uint256 amt) = abi.decode(data[4:100], (address, address, uint256));
            if (from == safe) (amount, moves) = (amt, true);
        } else if (selector == SET_APPROVAL_FOR_ALL && data.length >= 68) {
            (, bool approved) = abi.decode(data[4:68], (address, bool));
            if (approved && (strict || listed)) revert TokenNotAllowed(token);
            return;
        } else if (selector == DECREASE_ALLOWANCE) {
            return; // only ever lowers what can be taken
        } else if (listed) {
            // a limited token only takes the calls the limit can count: no transferAndCall, burn, permit-style or
            // unknown functions that could move it uncounted
            revert TokenNotAllowed(token);
        }
        if (!moves) return;
        if (listed) {
            if (amount > 0) _spend(safe, token, amount, tokenPerDay[safe][token]);
        } else if (strict && amount > 0) {
            revert TokenNotAllowed(token);
        }
    }

    function _spend(address safe, address asset, uint256 amount, uint256 limit) internal {
        Window storage w = windowOf[safe][asset];
        if (block.timestamp >= uint256(w.start) + WINDOW) {
            w.start = uint64(block.timestamp);
            w.spent = 0;
        }
        uint256 left = w.spent >= limit ? 0 : limit - w.spent;
        if (amount > left) revert LimitExceeded(asset, amount, left);
        w.spent += uint192(amount);
    }

    /// @dev Same checks as ShieldGuarded._consumeReceipt, for a receipt issued to `account` (the Safe) instead of
    ///      this contract; plus the Safe's own signer when it pinned one.
    function _consumeReceiptFor(address account, address target, bytes calldata data, uint256 value, Receipt calldata r, bytes calldata sig)
        internal
    {
        if (r.agent != account || r.target != target || r.value != value || r.dataHash != keccak256(data)) {
            revert ReceiptMismatch();
        }
        if (r.verdict != VERDICT_ALLOW) revert ReceiptNotAllow(r.verdict);
        if (r.expiresAt < block.timestamp) revert ReceiptExpired(r.expiresAt);
        if (usedCheckId[r.checkId]) revert ReceiptAlreadyUsed(r.checkId);
        address signer = ECDSA.recover(receiptDigest(r), sig);
        address pinned = signerOverride[account];
        if (pinned != address(0) ? signer != pinned : !isShieldSigner[signer]) revert InvalidReceiptSigner(signer);
        usedCheckId[r.checkId] = true;
        emit ReceiptConsumed(r.checkId, signer, target);
    }
}
