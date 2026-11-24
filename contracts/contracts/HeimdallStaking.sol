// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title HeimdallStaking
/// @notice Stake $HEIM, earn USDG from Heimdall protocol fees.
///         Fees are streamed to stakers over `DURATION` after they arrive, so staking right before a payout and
///         leaving right after earns almost nothing. Rewards accrue per second, pro rata to the stake.
/// @dev Synthetix StakingRewards accounting. No owner, no admin keys; only the immutable distributor adds rewards.
contract HeimdallStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable heim;
    IERC20 public immutable usdg;
    /// @notice The only address allowed to add rewards (HeimdallFeeSplitter). Stops anyone from restarting the
    ///         7-day stream with dust to stretch it out.
    address public immutable distributor;
    uint256 public constant DURATION = 7 days;

    uint256 public totalStaked;
    mapping(address => uint256) public stakedOf;

    uint256 public periodFinish;
    uint256 public rewardRate; // USDG (raw units) per second, scaled by 1e18
    uint256 public lastUpdate;
    uint256 public rewardPerTokenStored; // scaled by 1e18 * 1e18
    mapping(address => uint256) public paidPerToken;
    mapping(address => uint256) public rewards;
    /// @notice Rewards that arrived while nobody was staked; folded into the next payout.
    uint256 public unassigned;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 amount);
    event RewardAdded(uint256 amount, uint256 periodFinish);

    error ZeroAmount();
    error InvalidConfig();
    error NotDistributor();

    constructor(IERC20 heim_, IERC20 usdg_, address distributor_) {
        if (address(heim_) == address(0) || address(usdg_) == address(0) || address(heim_) == address(usdg_) || distributor_ == address(0)) revert InvalidConfig();
        heim = heim_;
        usdg = usdg_;
        distributor = distributor_;
    }

    // ── views ────────────────────────────────────────────
    function lastApplicable() public view returns (uint256) {
        return Math.min(block.timestamp, periodFinish);
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (lastApplicable() - lastUpdate) * rewardRate * 1e18 / totalStaked;
    }

    /// @notice USDG (raw units) `user` can claim now.
    function earned(address user) public view returns (uint256) {
        return rewards[user] + stakedOf[user] * (rewardPerToken() - paidPerToken[user]) / 1e36;
    }

    /// @notice USDG (raw units) streamed to all stakers per day at the current rate.
    function rewardPerDay() external view returns (uint256) {
        return block.timestamp >= periodFinish ? 0 : rewardRate * 1 days / 1e18;
    }

    // ── accounting ───────────────────────────────────────
    modifier update(address user) {
        uint256 rpt = rewardPerToken();
        if (totalStaked == 0 && periodFinish > lastUpdate) {
            // nobody staked during this stretch: keep those rewards for the next stakers instead of losing them
            unassigned += (lastApplicable() - lastUpdate) * rewardRate / 1e18;
        }
        rewardPerTokenStored = rpt;
        lastUpdate = lastApplicable();
        if (user != address(0)) {
            rewards[user] = earned(user);
            paidPerToken[user] = rpt;
        }
        _;
    }

    // ── staking ──────────────────────────────────────────
    function stake(uint256 amount) external nonReentrant update(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        uint256 before = heim.balanceOf(address(this));
        heim.safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = heim.balanceOf(address(this)) - before; // fee-on-transfer safe
        totalStaked += got;
        stakedOf[msg.sender] += got;
        emit Staked(msg.sender, got);
    }

    function withdraw(uint256 amount) public nonReentrant update(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        stakedOf[msg.sender] -= amount; // reverts on underflow
        totalStaked -= amount;
        heim.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claim() public nonReentrant update(msg.sender) {
        uint256 r = rewards[msg.sender];
        if (r > 0) {
            rewards[msg.sender] = 0;
            usdg.safeTransfer(msg.sender, r);
            emit RewardPaid(msg.sender, r);
        }
    }

    function exit() external {
        uint256 s = stakedOf[msg.sender];
        if (s > 0) withdraw(s);
        claim();
    }

    // ── rewards ──────────────────────────────────────────
    /// @notice Add `amount` USDG and stream it, plus whatever is still streaming, over the next DURATION.
    function notifyReward(uint256 amount) external nonReentrant update(address(0)) {
        if (msg.sender != distributor) revert NotDistributor();
        if (amount > 0) usdg.safeTransferFrom(msg.sender, address(this), amount);
        uint256 total = amount;
        if (totalStaked > 0) { total += unassigned; unassigned = 0; }
        if (total == 0) revert ZeroAmount();
        uint256 leftover = block.timestamp < periodFinish ? (periodFinish - block.timestamp) * rewardRate / 1e18 : 0;
        rewardRate = (total + leftover) * 1e18 / DURATION;
        lastUpdate = block.timestamp;
        periodFinish = block.timestamp + DURATION;
        emit RewardAdded(amount, periodFinish);
    }
}
