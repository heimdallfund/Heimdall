// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ShieldGuarded} from "./ShieldGuarded.sol";

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

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
///         - ETH per 24 h, and per-token limits per 24 h. For a limited token the module measures the Safe's balance
///           before and after every call, so tokens count however they leave (a direct transfer, or a router pulling
///           them with an allowance the Safe gave earlier). Approvals count in full when given, except approvals to
///           an allowlisted target, whose pulls are measured when they happen,
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
    /// @notice Most tokens one Safe can put a limit on (each is read before and after every agent call).
    uint256 public constant MAX_LIMITED_TOKENS = 16;
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
    /// @dev The limited tokens of each Safe, for the before/after balance check.
    mapping(address safe => address[]) internal _limitedTokens;

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
    error TooManyLimitedTokens();

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
        bool was = tokenListed[msg.sender][token];
        if (listed && !was) {
            if (_limitedTokens[msg.sender].length >= MAX_LIMITED_TOKENS) revert TooManyLimitedTokens();
            _limitedTokens[msg.sender].push(token);
        } else if (!listed && was) {
            address[] storage list = _limitedTokens[msg.sender];
            for (uint256 i; i < list.length; ++i) {
                if (list[i] == token) {
                    list[i] = list[list.length - 1];
                    list.pop();
                    break;
                }
            }
        }
        tokenPerDay[msg.sender][token] = listed ? perDay : 0;
        tokenListed[msg.sender][token] = listed;
        emit TokenLimitSet(msg.sender, token, perDay, listed);
    }

    /// @notice Tokens `safe` has a daily limit on.
    function limitedTokens(address safe) external view returns (address[] memory) {
        return _limitedTokens[safe];
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
        _authorize(safe, to, value, data, receipt, signature);
        (address[] memory tokens, uint256[] memory before) = _snapshot(safe);
        bool ok;
        (ok, result) = ISafeModuleTarget(safe).execTransactionFromModuleReturnData(to, value, data, OP_CALL);
        if (!ok) revert CallFailed(result);
        _settle(safe, tokens, before);
        emit Executed(safe, msg.sender, to, value, data.length >= 4 ? bytes4(data[:4]) : bytes4(0), receipt.checkId);
    }

    // ── internal ─────────────────────────────────────────

    /// @dev Everything checked before the call: pause, agent, targets, receipt, ETH and direct token calls.
    function _authorize(address safe, address to, uint256 value, bytes calldata data, Receipt calldata receipt, bytes calldata signature) internal {
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
        _checkTokenCall(safe, to, data, listed, p.strictTokens);
    }

    function _snapshot(address safe) internal view returns (address[] memory tokens, uint256[] memory before) {
        tokens = _limitedTokens[safe];
        before = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) before[i] = IERC20Balance(tokens[i]).balanceOf(safe);
    }

    /// @dev Whatever left the Safe counts, by whichever path it left.
    function _settle(address safe, address[] memory tokens, uint256[] memory before) internal {
        for (uint256 i; i < tokens.length; ++i) {
            uint256 afterBal = IERC20Balance(tokens[i]).balanceOf(safe);
            if (afterBal < before[i]) _spend(safe, tokens[i], before[i] - afterBal, tokenPerDay[safe][tokens[i]]);
        }
    }

    /// @dev Direct token calls. Movements of limited tokens are counted by the balance check after the call; here
    ///      only approvals are counted (they let someone pull later, outside this module), and calls that could move
    ///      a token in a way nothing counts are refused.
    function _checkTokenCall(address safe, address token, bytes calldata data, bool listed, bool strict) internal {
        (bool moves, bool isApproval, address spender, uint256 amount) = _parseTokenCall(safe, token, data, listed, strict);
        if (!moves || amount == 0) return;
        if (!listed) {
            if (strict) revert TokenNotAllowed(token);
            return;
        }
        if (isApproval) _countApproval(safe, token, spender, amount);
    }

    /// @dev An allowance to an allowlisted target (a router that pulls from its caller) is counted when it is used.
    function _countApproval(address safe, address token, address spender, uint256 amount) internal {
        if (!targetAllowed[safe][spender]) _spend(safe, token, amount, tokenPerDay[safe][token]);
    }

    function _parseTokenCall(address safe, address token, bytes calldata data, bool listed, bool strict)
        internal
        pure
        returns (bool moves, bool isApproval, address spender, uint256 amount)
    {
        bytes4 selector = data.length >= 4 ? bytes4(data[:4]) : bytes4(0);
        if ((selector == APPROVE || selector == INCREASE_ALLOWANCE) && data.length >= 68) {
            (spender, amount) = abi.decode(data[4:68], (address, uint256));
            return (true, true, spender, amount);
        }
        if (selector == TRANSFER && data.length >= 68) {
            (, amount) = abi.decode(data[4:68], (address, uint256));
            return (true, false, address(0), amount);
        }
        if (selector == TRANSFER_FROM && data.length >= 100) {
            (address from,, uint256 amt) = abi.decode(data[4:100], (address, address, uint256));
            return (from == safe, false, address(0), amt);
        }
        if (selector == SET_APPROVAL_FOR_ALL && data.length >= 68) {
            (, bool approved) = abi.decode(data[4:68], (address, bool));
            if (approved && (strict || listed)) revert TokenNotAllowed(token);
            return (false, false, address(0), 0);
        }
        if (selector == DECREASE_ALLOWANCE) return (false, false, address(0), 0); // only ever lowers what can be taken
        // a limited token only takes the calls the limit can count: no transferAndCall, burn, permit-style or
        // unknown functions that could move it uncounted
        if (listed) revert TokenNotAllowed(token);
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
