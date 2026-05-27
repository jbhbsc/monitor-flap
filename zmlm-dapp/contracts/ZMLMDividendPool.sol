// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IZMLMPoolToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title ZMLMDividendPool
 * @notice ZMLM staking pool that distributes deposited BNB by stake share.
 *
 * Marketing wallet funds this pool by sending BNB to the contract or calling
 * depositRewards(). Rewards are released into the pool accounting once per
 * hour, but users can claim at any later time and rewards continue to accrue.
 */
contract ZMLMDividendPool {
    uint256 public constant PRECISION = 1e24;
    uint256 public constant DISTRIBUTION_INTERVAL = 1 hours;

    IZMLMPoolToken public immutable zmlm;
    address public owner;
    address public marketingWallet;
    bool public stakingEnabled;

    uint256 public totalStaked;
    uint256 public accRewardPerShare;
    uint256 public undistributedRewards;
    uint256 public claimableRewards;
    uint256 public lastDistributionTime;

    struct StakeInfo {
        uint256 amount;
        uint256 rewardDebt;
        uint256 pending;
        uint256 since;
    }

    mapping(address => StakeInfo) public stakes;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MarketingWalletUpdated(address indexed previousWallet, address indexed newWallet);
    event StakingEnabledUpdated(bool enabled);
    event RewardsDeposited(address indexed from, uint256 amount);
    event RewardsDistributed(uint256 amount, uint256 accRewardPerShare);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 amount);
    event RescueBNB(address indexed to, uint256 amount);
    event RescueToken(address indexed token, address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "POOL: caller is not owner");
        _;
    }

    constructor(address zmlmToken, address initialMarketingWallet) {
        require(zmlmToken != address(0), "POOL: zero token");
        require(initialMarketingWallet != address(0), "POOL: zero marketing wallet");
        zmlm = IZMLMPoolToken(zmlmToken);
        owner = msg.sender;
        marketingWallet = initialMarketingWallet;
        lastDistributionTime = block.timestamp;
        emit OwnershipTransferred(address(0), msg.sender);
        emit MarketingWalletUpdated(address(0), initialMarketingWallet);
    }

    receive() external payable {
        _depositRewards(msg.sender, msg.value);
    }

    function depositRewards() external payable {
        _depositRewards(msg.sender, msg.value);
    }

    function setStakingEnabled(bool enabled) external onlyOwner {
        stakingEnabled = enabled;
        emit StakingEnabledUpdated(enabled);
    }

    function setMarketingWallet(address newMarketingWallet) external onlyOwner {
        require(newMarketingWallet != address(0), "POOL: zero marketing wallet");
        emit MarketingWalletUpdated(marketingWallet, newMarketingWallet);
        marketingWallet = newMarketingWallet;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "POOL: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    function stake(uint256 amount) external {
        require(stakingEnabled, "POOL: staking disabled");
        require(amount > 0, "POOL: zero amount");
        _updatePool();
        _harvestToPending(msg.sender);

        StakeInfo storage info = stakes[msg.sender];
        require(zmlm.transferFrom(msg.sender, address(this), amount), "POOL: transferFrom failed");
        info.amount += amount;
        if (info.since == 0) {
            info.since = block.timestamp;
        }
        totalStaked += amount;
        info.rewardDebt = (info.amount * accRewardPerShare) / PRECISION;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external {
        StakeInfo storage info = stakes[msg.sender];
        require(amount > 0 && amount <= info.amount, "POOL: invalid amount");
        _updatePool();
        _harvestToPending(msg.sender);

        info.amount -= amount;
        totalStaked -= amount;
        if (info.amount == 0) {
            info.since = 0;
        }
        info.rewardDebt = (info.amount * accRewardPerShare) / PRECISION;
        require(zmlm.transfer(msg.sender, amount), "POOL: transfer failed");
        emit Unstaked(msg.sender, amount);
    }

    function claim() external {
        _updatePool();
        _harvestToPending(msg.sender);

        StakeInfo storage info = stakes[msg.sender];
        uint256 amount = info.pending;
        require(amount > 0, "POOL: no rewards");
        info.pending = 0;
        claimableRewards -= amount;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "POOL: BNB transfer failed");
        emit Claimed(msg.sender, amount);
    }

    function distribute() external {
        _updatePool();
    }

    function pendingRewards(address user) external view returns (uint256) {
        StakeInfo memory info = stakes[user];
        uint256 nextAcc = accRewardPerShare;
        if (
            totalStaked > 0 &&
            undistributedRewards > 0 &&
            block.timestamp >= lastDistributionTime + DISTRIBUTION_INTERVAL
        ) {
            nextAcc += (undistributedRewards * PRECISION) / totalStaked;
        }
        uint256 accumulated = (info.amount * nextAcc) / PRECISION;
        uint256 newlyPending = accumulated > info.rewardDebt ? accumulated - info.rewardDebt : 0;
        return info.pending + newlyPending;
    }

    function userWeightBps(address user) external view returns (uint256) {
        if (totalStaked == 0) {
            return 0;
        }
        return (stakes[user].amount * 10_000) / totalStaked;
    }

    function nextDistributionTime() external view returns (uint256) {
        return lastDistributionTime + DISTRIBUTION_INTERVAL;
    }

    function rescueBNB(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "POOL: zero recipient");
        uint256 lockedRewards = undistributedRewards + claimableRewards;
        require(address(this).balance >= lockedRewards + amount, "POOL: amount exceeds unlocked BNB");
        (bool success, ) = to.call{value: amount}("");
        require(success, "POOL: BNB rescue failed");
        emit RescueBNB(to, amount);
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(zmlm), "POOL: cannot rescue staked token");
        require(to != address(0), "POOL: zero recipient");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "POOL: rescue failed");
        emit RescueToken(token, to, amount);
    }

    function _depositRewards(address from, uint256 amount) internal {
        require(amount > 0, "POOL: zero reward");
        undistributedRewards += amount;
        emit RewardsDeposited(from, amount);
    }

    function _updatePool() internal {
        if (block.timestamp < lastDistributionTime + DISTRIBUTION_INTERVAL) {
            return;
        }

        uint256 amount = undistributedRewards;
        lastDistributionTime = block.timestamp;
        if (amount == 0 || totalStaked == 0) {
            return;
        }

        undistributedRewards = 0;
        claimableRewards += amount;
        accRewardPerShare += (amount * PRECISION) / totalStaked;
        emit RewardsDistributed(amount, accRewardPerShare);
    }

    function _harvestToPending(address user) internal {
        StakeInfo storage info = stakes[user];
        if (info.amount == 0) {
            info.rewardDebt = 0;
            return;
        }

        uint256 accumulated = (info.amount * accRewardPerShare) / PRECISION;
        if (accumulated > info.rewardDebt) {
            info.pending += accumulated - info.rewardDebt;
        }
        info.rewardDebt = accumulated;
    }
}
