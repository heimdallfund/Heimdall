// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice USDG stand-in for x402 tests: ERC-20 with EIP-3009 transferWithAuthorization (v, r, s), same EIP-712
///         domain name and version as USDG on Robinhood Chain ("Global Dollar", "1").
contract MockEIP3009 is ERC20, EIP712 {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    constructor() ERC20("Global Dollar", "USDG") EIP712("Global Dollar", "1") {}

    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function DOMAIN_SEPARATOR() external view returns (bytes32) { return _domainSeparatorV4(); }

    function transferWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        require(block.timestamp > validAfter, "authorization is not yet valid");
        require(block.timestamp < validBefore, "authorization is expired");
        require(!authorizationState[from][nonce], "authorization is used");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)));
        require(ECDSA.recover(digest, v, r, s) == from, "invalid signature");
        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }
}
