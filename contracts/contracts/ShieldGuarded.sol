// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title ShieldGuarded
/// @notice Verifies Heimdall Shield receipts (EIP-712) before a guarded call is executed.
/// @dev The Shield API signs with domain {name: "Heimdall Shield", version: "1", chainId}.
abstract contract ShieldGuarded {
    struct Receipt {
        address agent; // the account that will execute the call (the vault)
        address target;
        bytes32 dataHash;
        uint256 value;
        uint8 verdict; // 0 = ALLOW, 1 = WARN, 2 = DENY
        uint64 expiresAt;
        bytes32 checkId;
    }

    bytes32 public constant RECEIPT_TYPEHASH = keccak256(
        "Receipt(address agent,address target,bytes32 dataHash,uint256 value,uint8 verdict,uint64 expiresAt,bytes32 checkId)"
    );
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 private constant NAME_HASH = keccak256("Heimdall Shield");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint8 internal constant VERDICT_ALLOW = 0;

    /// @notice Addresses whose receipts are accepted.
    mapping(address => bool) public isShieldSigner;
    /// @notice Receipts already consumed (replay protection).
    mapping(bytes32 => bool) public usedCheckId;

    event ShieldSignerSet(address indexed signer, bool allowed);
    event ReceiptConsumed(bytes32 indexed checkId, address indexed signer, address indexed target);

    error InvalidReceiptSigner(address recovered);
    error ReceiptExpired(uint64 expiresAt);
    error ReceiptAlreadyUsed(bytes32 checkId);
    error ReceiptMismatch();
    error ReceiptNotAllow(uint8 verdict);

    function shieldDomainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid));
    }

    function receiptDigest(Receipt calldata r) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(RECEIPT_TYPEHASH, r.agent, r.target, r.dataHash, r.value, r.verdict, r.expiresAt, r.checkId)
        );
        return keccak256(abi.encodePacked("\x19\x01", shieldDomainSeparator(), structHash));
    }

    function _setShieldSigner(address signer, bool allowed) internal {
        isShieldSigner[signer] = allowed;
        emit ShieldSignerSet(signer, allowed);
    }

    /// @dev Reverts unless `r` is an unexpired, unused ALLOW receipt for exactly this call, signed by a Shield signer.
    function _consumeReceipt(address target, bytes calldata data, uint256 value, Receipt calldata r, bytes calldata sig)
        internal
    {
        if (r.agent != address(this) || r.target != target || r.value != value || r.dataHash != keccak256(data)) {
            revert ReceiptMismatch();
        }
        if (r.verdict != VERDICT_ALLOW) revert ReceiptNotAllow(r.verdict);
        if (r.expiresAt < block.timestamp) revert ReceiptExpired(r.expiresAt);
        if (usedCheckId[r.checkId]) revert ReceiptAlreadyUsed(r.checkId);
        address signer = ECDSA.recover(receiptDigest(r), sig);
        if (!isShieldSigner[signer]) revert InvalidReceiptSigner(signer);
        usedCheckId[r.checkId] = true;
        emit ReceiptConsumed(r.checkId, signer, target);
    }
}
