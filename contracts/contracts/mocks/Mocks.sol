// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20 is ERC20 {
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
}

contract MockFeed {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public immutable decimals;

    constructor(uint8 d, int256 a) {
        decimals = d;
        answer = a;
        updatedAt = block.timestamp;
    }

    function set(int256 a, uint256 at) external {
        answer = a;
        updatedAt = at;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @notice Swaps tokenIn for tokenOut at a fixed rate (out per 1e18 in), sending to `recipient`.
contract MockRouter {
    mapping(address => mapping(address => uint256)) public rate; // tokenIn => tokenOut => out per 1e18 in

    function setRate(address tokenIn, address tokenOut, uint256 outPer1e18) external {
        rate[tokenIn][tokenOut] = outPer1e18;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, address recipient) external returns (uint256 out) {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        out = amountIn * rate[tokenIn][tokenOut] / 1e18;
        MockERC20(tokenOut).mint(recipient, out);
    }
}

/// @notice A target that tries to re-enter the vault.
contract ReentrantTarget {
    address public vault;

    constructor(address v) {
        vault = v;
    }

    function poke() external {
        (bool ok, bytes memory ret) = vault.call(abi.encodeWithSignature("harvest()"));
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}

/// @notice Stock token stand-in exposing Robinhood's `oraclePaused()` flag.
contract MockStockToken {
    bool public oraclePaused;
    uint256 public uiMultiplier = 1e18;
    uint256 public newUIMultiplier;
    uint256 public effectiveAt;

    function setPaused(bool p) external {
        oraclePaused = p;
    }

    /// Scheduled path of Robinhood's updateMultiplier(uint256,uint256): stages a multiplier that activates at `at`.
    function scheduleMultiplier(uint256 m, uint256 at) external {
        newUIMultiplier = m;
        effectiveAt = at;
    }
}

/// @notice Uniswap SwapRouter02.exactInputSingle stand-in with a fixed rate (out per 1e18 in), honouring amountOutMinimum.
contract MockSwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    mapping(address => mapping(address => uint256)) public rate;

    function setRate(address tokenIn, address tokenOut, uint256 outPer1e18) external {
        rate[tokenIn][tokenOut] = outPer1e18;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 out) {
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        out = p.amountIn * rate[p.tokenIn][p.tokenOut] / 1e18;
        require(out >= p.amountOutMinimum, "Too little received");
        MockERC20(p.tokenOut).mint(p.recipient, out);
    }
}
