// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IUniswapV2Router02 {
    function factory() external pure returns (address);

    function WETH() external pure returns (address);

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

interface IUniswapV2Factory {
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

error TokenErr(uint8 code);

contract SquidToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public constant INITIAL_SUPPLY = 1_000_000 ether;
    uint256 public totalSupply;

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant DIVIDEND_MAGNITUDE = 2 ** 128;
    uint256 private constant SWAP_GAS_LIMIT = 650_000;
    uint256 private constant SWAP_GAS_RESERVE = 70_000;
    address private constant PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;

    address public immutable owner;
    address public immutable dividendPoolWallet;
    address public immutable ecosystemWallet;
    address public immutable pancakePair;
    IUniswapV2Router02 public immutable router;
    bool public tradingEnabled;
    bool private inSwap;

    uint256 public pendingDividendTokens;
    uint256 public magnifiedDividendPerShare;
    uint256 public totalDividendsDeposited;
    uint256 public totalDividendTokensCollected;
    uint256 public dividendReserve;
    uint256 public totalDividendShares;
    uint256 public nonWhitelistBuyReceiveBps = 500;
    uint256 public nonWhitelistBuyDividendBps = 500;
    uint256 public nonWhitelistBuyEcosystemBps = 9_000;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => bool) public isFeeExempt;
    mapping(address => bool) public isTradingWhitelisted;
    mapping(address => bool) public isLiquidityManager;
    mapping(address => bool) public isBlacklisted;
    mapping(address => bool) public automatedMarketMakerPairs;
    mapping(address => uint256) private _dividendShares;
    mapping(address => uint256) private _withdrawnDividends;
    mapping(address => int256) private _magnifiedDividendCorrections;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event NonWhitelistBuyTax(
        address indexed buyer,
        uint256 dividendTokenAmount,
        uint256 ecosystemTokenAmount,
        uint256 receivedTokenAmount
    );
    event DividendTokensSwapped(uint256 tokenAmount, uint256 bnbAmount);
    event DividendsClaimed(address indexed account, uint256 amount);
    event FeeExemptUpdated(address indexed account, bool exempt);
    event TradingStatusUpdated(bool enabled);
    event TradingWhitelistUpdated(address indexed account, bool allowed);
    event LiquidityManagerUpdated(address indexed account, bool allowed);
    event BlacklistUpdated(address indexed account, bool blocked);
    event AutomatedMarketMakerPairUpdated(address indexed pair, bool allowed);
    event NonWhitelistBuyTaxBpsUpdated(uint256 receiveBps, uint256 dividendBps, uint256 ecosystemBps);
    event TokenRescued(address indexed token, uint256 amount, address indexed receiver);
    event DividendSwapFailed(uint256 tokenAmount, bytes errorData);

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        address initialOwner,
        address initialDividendPoolWallet,
        address initialEcosystemWallet
    ) {
        if (
            initialOwner == address(0) ||
            initialDividendPoolWallet == address(0) ||
            initialEcosystemWallet == address(0)
        ) revert TokenErr(1);

        name = tokenName;
        symbol = tokenSymbol;
        owner = initialOwner;
        dividendPoolWallet = initialDividendPoolWallet;
        ecosystemWallet = initialEcosystemWallet;
        router = IUniswapV2Router02(PANCAKE_ROUTER);
        pancakePair = IUniswapV2Factory(IUniswapV2Router02(PANCAKE_ROUTER).factory()).createPair(
            address(this),
            IUniswapV2Router02(PANCAKE_ROUTER).WETH()
        );

        totalSupply = INITIAL_SUPPLY;
        _balances[initialOwner] = INITIAL_SUPPLY;
        isFeeExempt[initialOwner] = true;
        isFeeExempt[address(this)] = true;
        isFeeExempt[initialDividendPoolWallet] = true;
        isFeeExempt[initialEcosystemWallet] = true;
        isTradingWhitelisted[initialOwner] = true;
        isTradingWhitelisted[address(this)] = true;
        isLiquidityManager[initialOwner] = true;
        automatedMarketMakerPairs[pancakePair] = true;

        emit Transfer(address(0), initialOwner, INITIAL_SUPPLY);
        emit FeeExemptUpdated(initialOwner, true);
        emit FeeExemptUpdated(address(this), true);
        emit FeeExemptUpdated(initialDividendPoolWallet, true);
        emit FeeExemptUpdated(initialEcosystemWallet, true);
        emit TradingWhitelistUpdated(initialOwner, true);
        emit TradingWhitelistUpdated(address(this), true);
        emit LiquidityManagerUpdated(initialOwner, true);
        emit AutomatedMarketMakerPairUpdated(pancakePair, true);
    }

    receive() external payable {}

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address tokenOwner, address spender) external view returns (uint256) {
        return _allowances[tokenOwner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _approveInternal(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = _allowances[from][msg.sender];
        if (allowed < amount) revert TokenErr(2);
        if (allowed != type(uint256).max) {
            _approveInternal(from, msg.sender, allowed - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function claimDividends() external returns (uint256) {
        return _claimDividends(payable(msg.sender));
    }

    function withdrawableDividendOf(address account) external view returns (uint256) {
        uint256 accumulative = _accumulativeDividendOf(account);
        uint256 withdrawn = _withdrawnDividends[account];
        return accumulative > withdrawn ? accumulative - withdrawn : 0;
    }

    function dividendBalanceOf(address account) external view returns (uint256) {
        return _dividendShares[account];
    }

    function processDividendTokens() external {
        _tryProcessDividendTokens();
    }

    function setNonWhitelistBuyTaxBps(
        uint256 receiveBps,
        uint256 dividendBps,
        uint256 ecosystemBps
    ) external onlyOwner {
        if (receiveBps + dividendBps + ecosystemBps != BPS_DENOMINATOR) revert TokenErr(14);
        nonWhitelistBuyReceiveBps = receiveBps;
        nonWhitelistBuyDividendBps = dividendBps;
        nonWhitelistBuyEcosystemBps = ecosystemBps;
        emit NonWhitelistBuyTaxBpsUpdated(receiveBps, dividendBps, ecosystemBps);
    }

    function setFeeExempt(address account, bool exempt) external onlyOwner {
        isFeeExempt[account] = exempt;
        emit FeeExemptUpdated(account, exempt);
    }

    function setTradingEnabled(bool enabled) external onlyOwner {
        tradingEnabled = enabled;
        emit TradingStatusUpdated(enabled);
    }

    function setAutomatedMarketMakerPair(address pair, bool allowed) external onlyOwner {
        automatedMarketMakerPairs[pair] = allowed;
        emit AutomatedMarketMakerPairUpdated(pair, allowed);
    }

    function setTradingWhitelist(address account, bool allowed) external onlyOwner {
        isTradingWhitelisted[account] = allowed;
        emit TradingWhitelistUpdated(account, allowed);
    }

    function batchSetTradingWhitelist(address[] calldata accounts, bool allowed) external onlyOwner {
        uint256 length = accounts.length;
        for (uint256 i = 0; i < length; ++i) {
            address account = accounts[i];
            isTradingWhitelisted[account] = allowed;
            emit TradingWhitelistUpdated(account, allowed);
        }
    }

    function setLiquidityManager(address account, bool allowed) external onlyOwner {
        isLiquidityManager[account] = allowed;
        emit LiquidityManagerUpdated(account, allowed);
    }

    function setBlacklist(address account, bool blocked) external onlyOwner {
        isBlacklisted[account] = blocked;
        emit BlacklistUpdated(account, blocked);
    }

    function rescueToken(address token, uint256 amount, address receiver) external onlyOwner {
        if (receiver == address(0)) revert TokenErr(4);

        if (token == address(0)) {
            uint256 rescueAmount = address(this).balance > dividendReserve
                ? _min(amount, address(this).balance - dividendReserve)
                : 0;
            (bool ok, ) = payable(receiver).call{value: rescueAmount}("");
            if (!ok) revert TokenErr(7);
            emit TokenRescued(token, rescueAmount, receiver);
            return;
        }

        if (token == address(this)) {
            pendingDividendTokens = amount >= pendingDividendTokens ? 0 : pendingDividendTokens - amount;
        }
        if (!IERC20Minimal(token).transfer(receiver, amount)) revert TokenErr(8);
        emit TokenRescued(token, amount, receiver);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert TokenErr(4);
        if (isBlacklisted[from] || isBlacklisted[to]) revert TokenErr(11);
        uint256 balance = _balances[from];
        if (balance < amount) revert TokenErr(5);

        bool isLiquidityManagementTransfer = _isLiquidityManagementTransfer(from, to);
        if (!tradingEnabled && !isTradingWhitelisted[from] && !isLiquidityManagementTransfer) revert TokenErr(6);

        if (to == pancakePair && from != address(this) && !inSwap) {
            _tryProcessDividendTokens();
        }

        unchecked {
            _balances[from] = balance - amount;
        }

        if (isLiquidityManagementTransfer || isFeeExempt[from] || isFeeExempt[to]) {
            _balances[to] += amount;
            emit Transfer(from, to, amount);
            return;
        }

        bool isBuy = automatedMarketMakerPairs[from];
        uint256 dividendTokenAmount = 0;
        uint256 ecosystemTokenAmount = 0;
        uint256 receiveAmount = amount;

        if (isBuy && !isTradingWhitelisted[to]) {
            dividendTokenAmount = (amount * nonWhitelistBuyDividendBps) / BPS_DENOMINATOR;
            ecosystemTokenAmount = (amount * nonWhitelistBuyEcosystemBps) / BPS_DENOMINATOR;
            receiveAmount = amount - dividendTokenAmount - ecosystemTokenAmount;
        }

        if (dividendTokenAmount > 0) {
            _balances[address(this)] += dividendTokenAmount;
            pendingDividendTokens += dividendTokenAmount;
            totalDividendTokensCollected += dividendTokenAmount;
            _addDividendShares(to, dividendTokenAmount);
            emit Transfer(from, address(this), dividendTokenAmount);
        }

        if (ecosystemTokenAmount > 0) {
            _balances[ecosystemWallet] += ecosystemTokenAmount;
            emit Transfer(from, ecosystemWallet, ecosystemTokenAmount);
        }

        if (dividendTokenAmount > 0 || ecosystemTokenAmount > 0) {
            emit NonWhitelistBuyTax(to, dividendTokenAmount, ecosystemTokenAmount, receiveAmount);
        }

        _balances[to] += receiveAmount;
        emit Transfer(from, to, receiveAmount);
        if (!isBuy && dividendTokenAmount == 0) {
            _tryProcessDividendTokens();
        }
    }

    function _tryProcessDividendTokens() private {
        if (inSwap) return;
        uint256 tokenAmount = pendingDividendTokens;
        if (tokenAmount == 0 || _balances[address(this)] < tokenAmount) return;

        uint256 gasAvailable = gasleft();
        if (gasAvailable <= SWAP_GAS_RESERVE) return;
        uint256 processGas = gasAvailable - SWAP_GAS_RESERVE;
        if (processGas > SWAP_GAS_LIMIT) {
            processGas = SWAP_GAS_LIMIT;
        }

        try this.swapPendingDividendTokens{gas: processGas}() {} catch (bytes memory errorData) {
            emit DividendSwapFailed(tokenAmount, errorData);
        }
    }

    function swapPendingDividendTokens() external {
        if (msg.sender != address(this)) revert TokenErr(12);
        if (inSwap) return;
        uint256 tokenAmount = pendingDividendTokens;
        if (tokenAmount == 0 || _balances[address(this)] < tokenAmount) return;

        inSwap = true;
        pendingDividendTokens = 0;
        uint256 bnbBefore = address(this).balance;

        _approveInternal(address(this), address(router), tokenAmount);
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = router.WETH();

        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0,
            path,
            address(this),
            block.timestamp
        );

        uint256 bnbReceived = address(this).balance - bnbBefore;
        if (bnbReceived > 0) {
            _depositDividends(bnbReceived);
        }
        emit DividendTokensSwapped(tokenAmount, bnbReceived);
        inSwap = false;
    }

    function _depositDividends(uint256 amount) private {
        if (amount == 0) return;
        uint256 trackedSupply = totalDividendShares;
        if (trackedSupply == 0) {
            dividendReserve += amount;
            return;
        }

        uint256 perShareIncrease = (amount * DIVIDEND_MAGNITUDE) / trackedSupply;
        if (perShareIncrease == 0) {
            dividendReserve += amount;
            return;
        }

        uint256 distributedAmount = (perShareIncrease * trackedSupply) / DIVIDEND_MAGNITUDE;
        magnifiedDividendPerShare += perShareIncrease;
        totalDividendsDeposited += distributedAmount;
        dividendReserve += amount;
    }

    function _claimDividends(address payable account) private returns (uint256) {
        uint256 accumulative = _accumulativeDividendOf(account);
        uint256 withdrawn = _withdrawnDividends[account];
        if (accumulative <= withdrawn) return 0;

        uint256 amount = accumulative - withdrawn;
        _withdrawnDividends[account] = accumulative;
        dividendReserve -= amount;

        (bool ok, ) = account.call{value: amount}("");
        if (!ok) {
            dividendReserve += amount;
            _withdrawnDividends[account] = withdrawn;
            return 0;
        }

        emit DividendsClaimed(account, amount);
        return amount;
    }

    function _addDividendShares(address account, uint256 amount) private {
        if (account == address(0) || amount == 0) return;
        _dividendShares[account] += amount;
        totalDividendShares += amount;
        _magnifiedDividendCorrections[account] -= _toInt256(magnifiedDividendPerShare * amount);
    }

    function _accumulativeDividendOf(address account) private view returns (uint256) {
        uint256 shares = _dividendShares[account];
        if (shares == 0) return 0;
        int256 corrected = _toInt256(magnifiedDividendPerShare * shares) + _magnifiedDividendCorrections[account];
        if (corrected <= 0) return 0;
        return uint256(corrected) / DIVIDEND_MAGNITUDE;
    }

    function _approveInternal(address tokenOwner, address spender, uint256 amount) private {
        _allowances[tokenOwner][spender] = amount;
        emit Approval(tokenOwner, spender, amount);
    }

    function _isLiquidityManagementTransfer(address from, address to) private view returns (bool) {
        address routerAddress = address(router);
        return (
            (isLiquidityManager[from] && to == pancakePair) ||
            (from == pancakePair && isLiquidityManager[to]) ||
            (from == pancakePair && to == routerAddress) ||
            (from == routerAddress && isLiquidityManager[to])
        );
    }

    function _toInt256(uint256 value) private pure returns (int256) {
        if (value > uint256(type(int256).max)) revert TokenErr(13);
        return int256(value);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert TokenErr(3);
        _;
    }
}
