// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mimics Paxos-style tokens (USDG on Robinhood Chain mainnet answers `increaseApproval(address,uint256)`,
///         selector 0xd73dd623, verified with eth_call against 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168).
contract PaxosLikeToken is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function increaseApproval(address spender, uint256 added) external returns (bool) {
        _approve(msg.sender, spender, allowance(msg.sender, spender) + added);
        return true;
    }
}

/// @notice A tracked asset whose transfers can be halted (e.g. tokenized stock during a corporate action / halt).
contract PausableToken is ERC20 {
    bool public halted;

    constructor() ERC20("Halted Stock", "HALT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setHalted(bool h) external {
        halted = h;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!halted, "halted");
        super._update(from, to, value);
    }
}

/// @notice A "feed" that answers every call with success and empty returndata
///         (e.g. a proxy whose implementation slot points to an address without code).
contract EmptyReturnFeed {
    fallback() external {}
}

/// @notice Contract the attacker uses as spender (contract spenders with a limited amount get an ALLOW from the Shield API).
contract Puller {
    function pull(IERC20 token, address from, address to) external {
        token.transferFrom(from, to, token.balanceOf(from));
    }
}
