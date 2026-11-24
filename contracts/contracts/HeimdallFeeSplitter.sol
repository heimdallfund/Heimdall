// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IHeimdallStaking {
    function notifyReward(uint256 amount) external;
}

/// @title HeimdallFeeSplitter
/// @notice Fee recipient for Heimdall Signals and vaults. Anyone can call `distribute`: a fixed share of the USDG it
///         holds goes to $HEIM stakers (streamed by HeimdallStaking, at most once a day), the rest to the treasury. Any other token
///         (for example vault fee shares) is forwarded to the treasury, which can redeem it and send USDG back here.
contract HeimdallFeeSplitter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_STAKER_BPS = 8_000;
    /// @notice Stakers' USDG is passed on at most this often. Each payout restarts the 7-day stream, so an open
    ///         `distribute` without a limit let anyone stretch the stream with dust; daily is the keeper's own pace.
    uint256 public constant STAKER_INTERVAL = 1 days;
    IERC20 public immutable usdg;
    IHeimdallStaking public staking;
    address public treasury;
    uint16 public stakerBps;
    uint256 public lastStakerPayout;

    event Distributed(address indexed token, uint256 toStakers, uint256 toTreasury);
    event TreasuryTransferFailed(address indexed token, uint256 amount);
    event Config(address staking, address treasury, uint16 stakerBps);

    error InvalidConfig();

    constructor(IERC20 usdg_, address owner_, address staking_, address treasury_, uint16 stakerBps_) Ownable(owner_) {
        if (address(usdg_) == address(0)) revert InvalidConfig();
        usdg = usdg_;
        _config(staking_, treasury_, stakerBps_);
    }

    function setConfig(address staking_, address treasury_, uint16 stakerBps_) external onlyOwner {
        _config(staking_, treasury_, stakerBps_);
    }

    function _config(address staking_, address treasury_, uint16 stakerBps_) internal {
        if (treasury_ == address(0) || stakerBps_ > MAX_STAKER_BPS || (stakerBps_ > 0 && staking_ == address(0))) revert InvalidConfig();
        if (address(staking) != address(0)) usdg.forceApprove(address(staking), 0);
        staking = IHeimdallStaking(staking_);
        treasury = treasury_;
        stakerBps = stakerBps_;
        emit Config(staking_, treasury_, stakerBps_);
    }

    /// @notice Split the full balance of `token`. Stakers get their share of USDG; while nobody stakes it waits in the
    ///         staking contract for the first stakers. A treasury transfer that fails leaves that part here for later.
    function distribute(IERC20 token) external nonReentrant {
        uint256 bal = token.balanceOf(address(this));
        if (bal == 0) return;
        uint256 toStakers = 0;
        if (address(token) == address(usdg) && stakerBps > 0) {
            // too soon after the last payout: keep all of it (stakers' and treasury's share) for the next one
            if (block.timestamp < lastStakerPayout + STAKER_INTERVAL) return;
            lastStakerPayout = block.timestamp;
            toStakers = bal * stakerBps / 10_000;
            if (toStakers > 0) {
                usdg.forceApprove(address(staking), toStakers);
                staking.notifyReward(toStakers);
            }
        }
        uint256 rest = bal - toStakers;
        if (rest > 0) {
            (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IERC20.transfer, (treasury, rest)));
            if (!ok || (ret.length > 0 && !abi.decode(ret, (bool)))) { emit TreasuryTransferFailed(address(token), rest); rest = 0; }
        }
        emit Distributed(address(token), toStakers, rest);
    }
}
