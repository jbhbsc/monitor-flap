// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IERC20Metadata is IERC20 {
    function decimals() external view returns (uint8);
}

interface IPrizePool {
    function rewardBalance() external view returns (uint256);
    function payReward(address winner, uint256 amount) external;
    function pendingChunks() external view returns (uint256);
    function processTokenBalance(uint256 minRewardOut) external returns (uint256);
}

library TransferHelper {
    function safeTransfer(address token, address to, uint256 value) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    function safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    }
}

abstract contract ReentrancyGuard {
    uint256 private _locked = 1;

    modifier nonReentrant() {
        require(_locked == 1, "REENTRANT");
        _locked = 2;
        _;
        _locked = 1;
    }
}

contract Ownable {
    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}

contract FlapScratchLottery is Ownable, ReentrancyGuard {
    struct Round {
        uint256 totalTickets;
        uint256 totalStaked;
        bool drawn;
        address winner;
        uint256 winningTicket;
        uint256 rewardAmount;
        uint256 drawnAt;
    }

    struct Entry {
        address user;
        uint256 tickets;
        uint256 amountPaid;
        uint256 cumulativeTickets;
    }

    IERC20Metadata public immutable stakeToken;
    IPrizePool public prizePool;

    uint256 public immutable firstRoundStart;
    uint256 public roundDuration = 2 minutes;
    uint256 public ticketPrice;
    uint256 public maxTicketsPerUser = 50;
    uint256 public rewardBps = 10_000;

    uint256 public stakeChunkSize;
    uint256 public stakePoolSize;
    uint256 public pendingStakeTokens;

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => Entry[]) private roundEntries;
    mapping(uint256 => mapping(address => uint256)) public userRoundTickets;
    mapping(uint256 => mapping(address => uint256)) public userRoundTicketStart;
    mapping(uint256 => mapping(address => uint256)) public userRoundTicketEnd;

    event TicketsStaked(
        uint256 indexed roundId,
        address indexed user,
        uint256 tickets,
        uint256 ticketStart,
        uint256 ticketEnd,
        uint256 amountPaid,
        uint256 receivedByContract
    );
    event RoundDrawn(uint256 indexed roundId, address indexed winner, uint256 winningTicket, uint256 rewardAmount);
    event StakeTokensProcessed(uint256 sentToPrizePool);
    event PrizePoolProcessFailed(uint256 sentToPrizePool, bytes reason);
    event PrizePoolUpdated(address indexed prizePool);
    event TicketConfigUpdated(uint256 ticketPrice, uint256 maxTicketsPerUser);
    event RoundDurationUpdated(uint256 roundDuration);
    event RewardBpsUpdated(uint256 rewardBps);

    constructor(address stakeToken_, address prizePool_, uint256 firstRoundStart_) {
        require(stakeToken_ != address(0), "ZERO_TOKEN");
        require(prizePool_ != address(0), "ZERO_POOL");
        stakeToken = IERC20Metadata(stakeToken_);
        prizePool = IPrizePool(prizePool_);
        firstRoundStart = firstRoundStart_ == 0 ? block.timestamp : firstRoundStart_;

        uint256 unit = 10 ** IERC20Metadata(stakeToken_).decimals();
        ticketPrice = 10_000 * unit;
        stakeChunkSize = 500_000 * unit;
        stakePoolSize = 500_000 * unit;
    }

    function currentRoundId() public view returns (uint256) {
        require(block.timestamp >= firstRoundStart, "NOT_STARTED");
        return ((block.timestamp - firstRoundStart) / roundDuration) + 1;
    }

    function roundWindow(uint256 roundId) public view returns (uint256 start, uint256 end) {
        require(roundId > 0, "BAD_ROUND");
        start = firstRoundStart + ((roundId - 1) * roundDuration);
        end = start + roundDuration;
    }

    function entriesLength(uint256 roundId) external view returns (uint256) {
        return roundEntries[roundId].length;
    }

    function getRoundEntry(uint256 roundId, uint256 index) external view returns (Entry memory) {
        return roundEntries[roundId][index];
    }

    function stakeTickets(uint256 tickets) external nonReentrant {
        require(tickets > 0, "ZERO_TICKETS");
        uint256 roundId = currentRoundId();
        uint256 userTickets = userRoundTickets[roundId][msg.sender];
        require(userTickets + tickets <= maxTicketsPerUser, "ROUND_LIMIT");

        uint256 amount = tickets * ticketPrice;
        uint256 beforeBalance = stakeToken.balanceOf(address(this));
        TransferHelper.safeTransferFrom(address(stakeToken), msg.sender, address(this), amount);
        uint256 received = stakeToken.balanceOf(address(this)) - beforeBalance;
        require(received > 0, "NO_TOKENS_RECEIVED");

        Round storage round = rounds[roundId];
        uint256 ticketStart = round.totalTickets + 1;
        round.totalTickets += tickets;
        uint256 ticketEnd = round.totalTickets;

        userRoundTickets[roundId][msg.sender] = userTickets + tickets;
        if (userTickets == 0) {
            userRoundTicketStart[roundId][msg.sender] = ticketStart;
        }
        userRoundTicketEnd[roundId][msg.sender] = ticketEnd;
        round.totalStaked += amount;
        roundEntries[roundId].push(
            Entry({
                user: msg.sender,
                tickets: tickets,
                amountPaid: amount,
                cumulativeTickets: round.totalTickets
            })
        );

        pendingStakeTokens += received;
        uint256 sentToPrizePool = _processStakeTokens();
        _tryProcessPrizePool(sentToPrizePool);

        emit TicketsStaked(roundId, msg.sender, tickets, ticketStart, ticketEnd, amount, received);
    }

    function drawRound(uint256 roundId) external nonReentrant {
        require(roundId > 0, "BAD_ROUND");
        (, uint256 end) = roundWindow(roundId);
        require(block.timestamp >= end, "ROUND_ACTIVE");

        Round storage round = rounds[roundId];
        require(!round.drawn, "DRAWN");
        require(round.totalTickets > 0, "NO_TICKETS");

        uint256 randomValue = uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,
                    blockhash(block.number - 1),
                    block.timestamp,
                    roundId,
                    round.totalTickets,
                    address(this)
                )
            )
        );
        uint256 winningTicket = (randomValue % round.totalTickets) + 1;
        address winner = _findWinner(roundId, winningTicket);

        _tryProcessPrizePool(0);
        uint256 rewardAmount = (prizePool.rewardBalance() * rewardBps) / 10_000;
        if (rewardAmount > 0) {
            prizePool.payReward(winner, rewardAmount);
        }

        round.drawn = true;
        round.winner = winner;
        round.winningTicket = winningTicket;
        round.rewardAmount = rewardAmount;
        round.drawnAt = block.timestamp;

        emit RoundDrawn(roundId, winner, winningTicket, rewardAmount);
    }

    function processStakeTokens() external nonReentrant {
        uint256 sentToPrizePool = _processStakeTokens();
        _tryProcessPrizePool(sentToPrizePool);
    }

    function setPrizePool(address prizePool_) external onlyOwner {
        require(prizePool_ != address(0), "ZERO_POOL");
        prizePool = IPrizePool(prizePool_);
        emit PrizePoolUpdated(prizePool_);
    }

    function setTicketConfig(uint256 ticketPrice_, uint256 maxTicketsPerUser_) external onlyOwner {
        require(ticketPrice_ > 0, "BAD_PRICE");
        require(maxTicketsPerUser_ > 0, "BAD_LIMIT");
        ticketPrice = ticketPrice_;
        maxTicketsPerUser = maxTicketsPerUser_;
        emit TicketConfigUpdated(ticketPrice_, maxTicketsPerUser_);
    }

    function setStakeChunkConfig(uint256 chunkSize, uint256 poolSize) external onlyOwner {
        require(chunkSize > 0, "BAD_CHUNK");
        require(poolSize == chunkSize, "BAD_SPLIT");
        stakeChunkSize = chunkSize;
        stakePoolSize = poolSize;
    }

    function setRoundDuration(uint256 roundDuration_) external onlyOwner {
        require(roundDuration_ >= 1 minutes, "TOO_SHORT");
        roundDuration = roundDuration_;
        emit RoundDurationUpdated(roundDuration_);
    }

    function setRewardBps(uint256 rewardBps_) external onlyOwner {
        require(rewardBps_ <= 10_000, "BPS_TOO_HIGH");
        rewardBps = rewardBps_;
        emit RewardBpsUpdated(rewardBps_);
    }

    function _processStakeTokens() private returns (uint256 sentToPrizePool) {
        uint256 balance = stakeToken.balanceOf(address(this));
        while (pendingStakeTokens >= stakeChunkSize && balance >= stakeChunkSize) {
            pendingStakeTokens -= stakeChunkSize;
            balance -= stakeChunkSize;

            if (stakePoolSize > 0) {
                TransferHelper.safeTransfer(address(stakeToken), address(prizePool), stakePoolSize);
                sentToPrizePool += stakePoolSize;
            }

            emit StakeTokensProcessed(stakePoolSize);
        }
    }

    function _tryProcessPrizePool(uint256 sentToPrizePool) private {
        try prizePool.pendingChunks() returns (uint256 chunks) {
            if (chunks == 0) return;
            try prizePool.processTokenBalance(0) returns (uint256) {} catch (bytes memory reason) {
                emit PrizePoolProcessFailed(sentToPrizePool, reason);
            }
        } catch {}
    }

    function _findWinner(uint256 roundId, uint256 winningTicket) private view returns (address) {
        Entry[] storage entries = roundEntries[roundId];
        uint256 low = 0;
        uint256 high = entries.length;

        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (entries[mid].cumulativeTickets >= winningTicket) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        return entries[low].user;
    }
}
