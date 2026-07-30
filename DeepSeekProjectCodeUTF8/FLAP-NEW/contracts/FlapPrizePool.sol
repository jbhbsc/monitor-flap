// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}

interface IERC20Metadata is IERC20 {
    function decimals() external view returns (uint8);
}

interface IWrappedNative {
    function withdraw(uint256 amount) external;
}

library TransferHelper {
    function safeTransfer(address token, address to, uint256 value) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
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

contract FlapPrizePool is Ownable, ReentrancyGuard {
    IERC20Metadata public immutable prizeToken;
    address public immutable saleOutputToken;
    address public immutable wrappedNative;
    bool public immutable paysNative;
    bool public immutable paysPrizeToken;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address public lottery;
    uint256 public chunkSize;
    uint256 public burnSize;
    bool public prizeTokenRescueEnabled;
    uint256 public prizeTokenRewardReserve;

    event LotteryUpdated(address indexed lottery);
    event ChunkConfigUpdated(uint256 chunkSize, uint256 burnSize);
    event PrizeTokenRescueEnabledUpdated(bool enabled);
    event TokensProcessed(uint256 chunks, uint256 tokensBurned);
    event PrizeTokenRewardReserved(uint256 amount);
    event RewardPaid(address indexed winner, address indexed asset, uint256 amount);
    event NativeReceived(address indexed from, uint256 amount);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);
    event NativeRescued(address indexed to, uint256 amount);

    modifier onlyLottery() {
        require(msg.sender == lottery, "NOT_LOTTERY");
        _;
    }

    constructor(
        address prizeToken_,
        address saleOutputToken_,
        address wrappedNative_,
        uint8 prizeTokenDecimals_
    ) {
        require(prizeToken_ != address(0), "ZERO_TOKEN");
        require(saleOutputToken_ != address(0), "ZERO_OUTPUT");

        prizeToken = IERC20Metadata(prizeToken_);
        saleOutputToken = saleOutputToken_;
        wrappedNative = wrappedNative_;
        paysNative = wrappedNative_ != address(0) && saleOutputToken_ == wrappedNative_;
        paysPrizeToken = saleOutputToken_ == prizeToken_;

        uint256 unit = 10 ** uint256(prizeTokenDecimals_);
        chunkSize = 500_000 * unit;
        burnSize = 500_000 * unit;
    }

    receive() external payable {
        emit NativeReceived(msg.sender, msg.value);
    }

    function setLottery(address lottery_) external onlyOwner {
        lottery = lottery_;
        emit LotteryUpdated(lottery_);
    }

    function setChunkConfig(uint256 chunkSize_, uint256 burnSize_) external onlyOwner {
        require(chunkSize_ > 0, "BAD_CHUNK");
        require(burnSize_ == chunkSize_, "BAD_BURN");
        chunkSize = chunkSize_;
        burnSize = burnSize_;
        emit ChunkConfigUpdated(chunkSize_, burnSize_);
    }

    function setPrizeTokenRescueEnabled(bool enabled) external onlyOwner {
        prizeTokenRescueEnabled = enabled;
        emit PrizeTokenRescueEnabledUpdated(enabled);
    }

    function rewardBalance() public view returns (uint256) {
        if (paysPrizeToken) {
            return prizeTokenRewardReserve;
        }
        if (paysNative) {
            return address(this).balance;
        }
        return IERC20(saleOutputToken).balanceOf(address(this));
    }

    function pendingPrizeTokenBalance() public view returns (uint256) {
        uint256 balance = prizeToken.balanceOf(address(this));
        if (balance <= prizeTokenRewardReserve) {
            return 0;
        }
        return balance - prizeTokenRewardReserve;
    }

    function pendingChunks() public view returns (uint256) {
        return pendingPrizeTokenBalance() / chunkSize;
    }

    function processTokenBalance(uint256 minRewardOut) external nonReentrant returns (uint256 rewardReceived) {
        minRewardOut;
        uint256 chunks = pendingChunks();
        require(chunks > 0, "NO_CHUNK");
        uint256 tokensToBurn = chunks * burnSize;

        if (tokensToBurn > 0) {
            TransferHelper.safeTransfer(address(prizeToken), DEAD, tokensToBurn);
        }

        rewardReceived = 0;
        emit TokensProcessed(chunks, tokensToBurn);
    }

    function payReward(address winner, uint256 amount) external onlyLottery nonReentrant {
        require(winner != address(0), "ZERO_WINNER");
        uint256 available = rewardBalance();
        if (amount == type(uint256).max) {
            amount = available;
        }
        require(amount <= available, "INSUFFICIENT_REWARD");

        if (paysNative) {
            (bool ok, ) = payable(winner).call{value: amount}("");
            require(ok, "NATIVE_PAY_FAILED");
            emit RewardPaid(winner, address(0), amount);
        } else if (paysPrizeToken) {
            prizeTokenRewardReserve -= amount;
            TransferHelper.safeTransfer(address(prizeToken), winner, amount);
            emit RewardPaid(winner, address(prizeToken), amount);
        } else {
            TransferHelper.safeTransfer(saleOutputToken, winner, amount);
            emit RewardPaid(winner, saleOutputToken, amount);
        }
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "ZERO_TO");
        require(token != address(prizeToken), "PRIZE_TOKEN_LOCKED");
        TransferHelper.safeTransfer(token, to, amount);
        emit TokenRescued(token, to, amount);
    }

    function rescuePrizeToken(address to, uint256 amount) external onlyOwner nonReentrant {
        require(prizeTokenRescueEnabled, "RESCUE_DISABLED");
        require(to != address(0), "ZERO_TO");
        if (paysPrizeToken) {
            uint256 unprocessed = pendingPrizeTokenBalance();
            if (amount > unprocessed) {
                uint256 reserveReduction = amount - unprocessed;
                prizeTokenRewardReserve = reserveReduction >= prizeTokenRewardReserve
                    ? 0
                    : prizeTokenRewardReserve - reserveReduction;
            }
        }
        TransferHelper.safeTransfer(address(prizeToken), to, amount);
        emit TokenRescued(address(prizeToken), to, amount);
    }

    function rescueNative(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "ZERO_TO");
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "NATIVE_RESCUE_FAILED");
        emit NativeRescued(to, amount);
    }

}
