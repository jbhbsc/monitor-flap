// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPancakeV2Factory {
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IPancakeV2Router {
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

/**
 * @title CR7PaidMintToken
 * @notice Standalone ERC20/BEP20-style token for the CR7 DApp.
 *
 * Mint:
 * - 0.01 BNB mints 100 CR7 to the buyer.
 * - Wallet public mint cap is 0.1 BNB.
 * - BNB paid for mint is forwarded to the DEV wallet.
 * - Public mint tokens are transferred from this contract's token balance.
 *   Fund the contract first by transferring tokens from the dev wallet to
 *   address(this).
 *
 * Trading:
 * - Trading starts closed and can be opened by the owner.
 * - Blacklisted addresses cannot transfer or mint.
 * - Whitelisted addresses bypass trading lock and tax.
 * - Buy and sell tax default to 3%.
 * - Tax tokens are held by this contract and swapped to BNB for the marketing wallet.
 * - If a swap fails, tokens remain in this contract and can be retried later.
 *
 * Sell dust airdrop:
 * - The contract does not secretly generate new wallets.
 * - If enabled, each sell can send a tiny, public, event-tracked share of the
 *   sell tax to the next configured zero-balance recipient.
 */
contract CR7PaidMintToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    address public constant PANCAKE_V2_FACTORY = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
    address public constant PANCAKE_V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address public constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address public constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address public constant FIST = 0xC9882dEF23bc42D53895b8361D0b1EDC7570Bc6A;
    uint256 public constant MINT_UNIT_WEI = 0.01 ether;
    uint256 public constant TOKENS_PER_MINT_UNIT = 100 * 10 ** uint256(decimals);
    uint256 public constant MAX_WALLET_MINT_WEI = 0.1 ether;
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10 ** uint256(decimals);
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant HARD_MAX_TAX_BPS = 5_000;

    uint256 public totalSupply;
    uint256 public totalMintedTokens;
    uint256 public totalMintedSteps;
    uint256 public collectedTaxTokens;

    address public owner;
    address public marketingWallet;
    address public pancakePair;
    address public pancakeWbnbPair;
    address public pancakeUsdtPair;
    address public pancakeFistPair;
    bool public tradingEnabled;
    bool public swapTaxToBnbEnabled;
    bool private _swappingTax;

    uint16 public buyTaxBps;
    uint16 public sellTaxBps;
    uint16 public transferTaxBps;
    uint16 public maxTaxBps;
    uint16 public dustAirdropTaxShareBps;

    uint256 public dustAirdropAmount;
    bool public dustAirdropEnabled;
    uint256 public dustRecipientCursor;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    mapping(address => uint256) public mintedWei;
    mapping(address => bool) public isWhitelisted;
    mapping(address => bool) public isBlacklisted;
    mapping(address => bool) public isAutomatedMarketMakerPair;

    address[] public dustRecipients;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed tokenOwner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MarketingWalletUpdated(address indexed previousWallet, address indexed newWallet);
    event TradingEnabledUpdated(bool enabled);
    event SwapTaxToBnbUpdated(bool enabled);
    event TaxesUpdated(uint16 buyTaxBps, uint16 sellTaxBps, uint16 transferTaxBps);
    event MaxTaxUpdated(uint16 maxTaxBps);
    event TaxSwappedToBNB(uint256 tokenAmount, address indexed marketingWallet);
    event TaxSwapFailed(uint256 tokenAmount, address indexed marketingWallet);
    event TaxTokensCollected(uint256 tokenAmount, uint256 totalCollectedTaxTokens);
    event WhitelistUpdated(address indexed account, bool whitelisted);
    event BlacklistUpdated(address indexed account, bool blacklisted);
    event AutomatedMarketMakerPairUpdated(address indexed pair, bool isPair);
    event PublicMint(address indexed buyer, uint256 bnbAmount, uint256 tokenAmount);
    event DustAirdropSettingsUpdated(bool enabled, uint256 amount, uint16 taxShareBps);
    event DustRecipientsAdded(uint256 count);
    event SellDustAirdrop(address indexed recipient, uint256 amount, address indexed sellSender);
    event RescueToken(address indexed token, address indexed to, uint256 amount);
    event RescueBNB(address indexed to, uint256 amount);
    event CollectedTaxTokensWithdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "CR7: caller is not owner");
        _;
    }

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        address initialDevWallet
    ) {
        require(initialDevWallet != address(0), "CR7: zero dev wallet");

        name = tokenName;
        symbol = tokenSymbol;
        owner = msg.sender;
        marketingWallet = initialDevWallet;

        buyTaxBps = 300;
        sellTaxBps = 300;
        maxTaxBps = 3_000;
        swapTaxToBnbEnabled = true;
        dustAirdropTaxShareBps = 10;
        dustAirdropAmount = 1 * 10 ** (uint256(decimals) - 6);

        isWhitelisted[msg.sender] = true;
        isWhitelisted[address(this)] = true;
        isWhitelisted[initialDevWallet] = true;

        _mint(initialDevWallet, INITIAL_SUPPLY);
        pancakeWbnbPair = IPancakeV2Factory(PANCAKE_V2_FACTORY).createPair(address(this), WBNB);
        pancakeUsdtPair = IPancakeV2Factory(PANCAKE_V2_FACTORY).createPair(address(this), USDT);
        pancakeFistPair = IPancakeV2Factory(PANCAKE_V2_FACTORY).createPair(address(this), FIST);
        pancakePair = pancakeWbnbPair;
        isAutomatedMarketMakerPair[pancakeWbnbPair] = true;
        isAutomatedMarketMakerPair[pancakeUsdtPair] = true;
        isAutomatedMarketMakerPair[pancakeFistPair] = true;

        emit OwnershipTransferred(address(0), msg.sender);
        emit MarketingWalletUpdated(address(0), initialDevWallet);
        emit SwapTaxToBnbUpdated(true);
        emit TaxesUpdated(buyTaxBps, sellTaxBps, transferTaxBps);
        emit MaxTaxUpdated(maxTaxBps);
        emit AutomatedMarketMakerPairUpdated(pancakeWbnbPair, true);
        emit AutomatedMarketMakerPairUpdated(pancakeUsdtPair, true);
        emit AutomatedMarketMakerPairUpdated(pancakeFistPair, true);
    }

    receive() external payable {
        _publicMint(msg.sender, msg.value);
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address tokenOwner, address spender) external view returns (uint256) {
        return _allowances[tokenOwner][spender];
    }

    function dustRecipientsLength() external view returns (uint256) {
        return dustRecipients.length;
    }

    function mint() external payable returns (bool) {
        _publicMint(msg.sender, msg.value);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        _approve(msg.sender, spender, _allowances[msg.sender][spender] + addedValue);
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        uint256 currentAllowance = _allowances[msg.sender][spender];
        require(currentAllowance >= subtractedValue, "CR7: decreased allowance below zero");
        unchecked {
            _approve(msg.sender, spender, currentAllowance - subtractedValue);
        }
        return true;
    }

    function setTradingEnabled(bool enabled) external onlyOwner {
        tradingEnabled = enabled;
        emit TradingEnabledUpdated(enabled);
    }

    function setSwapTaxToBnbEnabled(bool enabled) external onlyOwner {
        swapTaxToBnbEnabled = enabled;
        emit SwapTaxToBnbUpdated(enabled);
    }

    function setMarketingWallet(address newMarketingWallet) external onlyOwner {
        require(newMarketingWallet != address(0), "CR7: zero marketing wallet");
        emit MarketingWalletUpdated(marketingWallet, newMarketingWallet);
        marketingWallet = newMarketingWallet;
        isWhitelisted[newMarketingWallet] = true;
        emit WhitelistUpdated(newMarketingWallet, true);
    }

    function setTaxes(
        uint16 newBuyTaxBps,
        uint16 newSellTaxBps,
        uint16 newTransferTaxBps
    ) external onlyOwner {
        require(newBuyTaxBps <= maxTaxBps, "CR7: buy tax too high");
        require(newSellTaxBps <= maxTaxBps, "CR7: sell tax too high");
        require(newTransferTaxBps <= maxTaxBps, "CR7: transfer tax too high");

        buyTaxBps = newBuyTaxBps;
        sellTaxBps = newSellTaxBps;
        transferTaxBps = newTransferTaxBps;
        emit TaxesUpdated(newBuyTaxBps, newSellTaxBps, newTransferTaxBps);
    }

    function setMaxTaxBps(uint16 newMaxTaxBps) external onlyOwner {
        require(newMaxTaxBps <= HARD_MAX_TAX_BPS, "CR7: hard max tax exceeded");
        require(buyTaxBps <= newMaxTaxBps, "CR7: current buy tax too high");
        require(sellTaxBps <= newMaxTaxBps, "CR7: current sell tax too high");
        require(transferTaxBps <= newMaxTaxBps, "CR7: current transfer tax too high");

        maxTaxBps = newMaxTaxBps;
        emit MaxTaxUpdated(newMaxTaxBps);
    }

    function setWhitelisted(address account, bool whitelisted) external onlyOwner {
        isWhitelisted[account] = whitelisted;
        emit WhitelistUpdated(account, whitelisted);
    }

    function setWhitelistBatch(address[] calldata accounts, bool whitelisted) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            isWhitelisted[accounts[i]] = whitelisted;
            emit WhitelistUpdated(accounts[i], whitelisted);
        }
    }

    function setBlacklisted(address account, bool blacklisted) external onlyOwner {
        isBlacklisted[account] = blacklisted;
        emit BlacklistUpdated(account, blacklisted);
    }

    function setBlacklistBatch(address[] calldata accounts, bool blacklisted) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            isBlacklisted[accounts[i]] = blacklisted;
            emit BlacklistUpdated(accounts[i], blacklisted);
        }
    }

    function setAutomatedMarketMakerPair(address pair, bool isPair) external onlyOwner {
        require(pair != address(0), "CR7: zero pair");
        isAutomatedMarketMakerPair[pair] = isPair;
        emit AutomatedMarketMakerPairUpdated(pair, isPair);
    }

    function setDustAirdrop(bool enabled, uint256 amount) external onlyOwner {
        dustAirdropEnabled = enabled;
        dustAirdropAmount = amount;
        emit DustAirdropSettingsUpdated(enabled, amount, dustAirdropTaxShareBps);
    }

    function setDustAirdropTaxShare(uint16 taxShareBps) external onlyOwner {
        require(taxShareBps <= BPS_DENOMINATOR, "CR7: share too high");
        dustAirdropTaxShareBps = taxShareBps;
        emit DustAirdropSettingsUpdated(dustAirdropEnabled, dustAirdropAmount, taxShareBps);
    }

    function addDustRecipients(address[] calldata recipients) external onlyOwner {
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "CR7: zero recipient");
            dustRecipients.push(recipients[i]);
        }
        emit DustRecipientsAdded(recipients.length);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "CR7: zero new owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
        isWhitelisted[newOwner] = true;
        emit WhitelistUpdated(newOwner, true);
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "CR7: zero recipient");

        if (token == address(this)) {
            _rawTransfer(address(this), to, amount);
        } else {
            (bool success, bytes memory data) = token.call(
                abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), to, amount)
            );
            require(success && (data.length == 0 || abi.decode(data, (bool))), "CR7: rescue failed");
        }

        emit RescueToken(token, to, amount);
    }

    function rescueBNB(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "CR7: zero recipient");
        (bool success, ) = to.call{value: amount}("");
        require(success, "CR7: BNB rescue failed");
        emit RescueBNB(to, amount);
    }

    function swapCollectedTaxToBNB(uint256 tokenAmount) external onlyOwner {
        require(swapTaxToBnbEnabled, "CR7: tax swap disabled");
        uint256 amountToSwap = tokenAmount == 0 ? collectedTaxTokens : tokenAmount;
        require(amountToSwap > 0, "CR7: no tax to swap");
        require(amountToSwap <= collectedTaxTokens, "CR7: amount exceeds collected tax");
        require(amountToSwap <= _balances[address(this)], "CR7: amount exceeds contract balance");
        _swapTokensForBNB(amountToSwap);
    }

    function withdrawCollectedTaxTokens(address to, uint256 tokenAmount) external onlyOwner {
        require(to != address(0), "CR7: zero recipient");
        uint256 amountToWithdraw = tokenAmount == 0 ? collectedTaxTokens : tokenAmount;
        require(amountToWithdraw > 0, "CR7: no tax to withdraw");
        require(amountToWithdraw <= collectedTaxTokens, "CR7: amount exceeds collected tax");
        require(amountToWithdraw <= _balances[address(this)], "CR7: amount exceeds contract balance");

        collectedTaxTokens -= amountToWithdraw;
        _rawTransfer(address(this), to, amountToWithdraw);
        emit CollectedTaxTokensWithdrawn(to, amountToWithdraw);
    }

    function _publicMint(address buyer, uint256 bnbAmount) internal {
        require(buyer != address(0), "CR7: zero buyer");
        require(!isBlacklisted[buyer], "CR7: blacklisted buyer");
        require(bnbAmount >= MINT_UNIT_WEI, "CR7: minimum mint is 0.01 BNB");
        require(bnbAmount % MINT_UNIT_WEI == 0, "CR7: mint step is 0.01 BNB");
        require(mintedWei[buyer] + bnbAmount <= MAX_WALLET_MINT_WEI, "CR7: wallet mint cap reached");

        uint256 steps = bnbAmount / MINT_UNIT_WEI;
        uint256 tokenAmount = steps * TOKENS_PER_MINT_UNIT;
        require(_balances[address(this)] >= tokenAmount, "CR7: insufficient mint inventory");

        mintedWei[buyer] += bnbAmount;
        totalMintedSteps += steps;
        totalMintedTokens += tokenAmount;
        _rawTransfer(address(this), buyer, tokenAmount);

        (bool success, ) = payable(marketingWallet).call{value: bnbAmount}("");
        require(success, "CR7: BNB forward failed");

        emit PublicMint(buyer, bnbAmount, tokenAmount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "CR7: transfer from zero");
        require(to != address(0), "CR7: transfer to zero");
        require(!isBlacklisted[from] && !isBlacklisted[to], "CR7: blacklisted address");
        require(tradingEnabled || isWhitelisted[from] || isWhitelisted[to], "CR7: trading is not enabled");

        uint256 fee = _calculateFee(from, to, amount);
        uint256 sendAmount = amount - fee;

        if (fee > 0) {
            uint256 dustFee = 0;
            if (isAutomatedMarketMakerPair[to]) {
                dustFee = _tryDustAirdropFromFee(from, fee);
            }
            uint256 marketingFee = fee - dustFee;
            if (marketingFee > 0) {
                bool isAmmTrade = isAutomatedMarketMakerPair[from] || isAutomatedMarketMakerPair[to];
                _rawTransfer(from, address(this), marketingFee);
                collectedTaxTokens += marketingFee;
                emit TaxTokensCollected(marketingFee, collectedTaxTokens);
                if (isAmmTrade && isAutomatedMarketMakerPair[to] && swapTaxToBnbEnabled && !_swappingTax) {
                    _swapTokensForBNB(collectedTaxTokens);
                }
            }
        }
        _rawTransfer(from, to, sendAmount);
    }

    function _calculateFee(address from, address to, uint256 amount) internal view returns (uint256) {
        if (amount == 0 || isWhitelisted[from] || isWhitelisted[to]) {
            return 0;
        }

        uint16 taxBps = transferTaxBps;
        if (isAutomatedMarketMakerPair[from]) {
            taxBps = buyTaxBps;
        } else if (isAutomatedMarketMakerPair[to]) {
            taxBps = sellTaxBps;
        }

        return (amount * taxBps) / BPS_DENOMINATOR;
    }

    function _tryDustAirdropFromFee(address sellSender, uint256 fee) internal returns (uint256) {
        if (!dustAirdropEnabled || dustRecipients.length == 0 || dustAirdropTaxShareBps == 0) {
            return 0;
        }

        uint256 share = (fee * dustAirdropTaxShareBps) / BPS_DENOMINATOR;
        if (dustAirdropAmount > 0 && share > dustAirdropAmount) {
            share = dustAirdropAmount;
        }
        if (share == 0) {
            return 0;
        }

        uint256 recipientCount = dustRecipients.length;
        for (uint256 i = 0; i < recipientCount; i++) {
            address recipient = dustRecipients[dustRecipientCursor % recipientCount];
            dustRecipientCursor++;

            if (recipient != address(0) && !isBlacklisted[recipient] && _balances[recipient] == 0) {
                _rawTransfer(sellSender, recipient, share);
                emit SellDustAirdrop(recipient, share, sellSender);
                return share;
            }
        }

        return 0;
    }

    function _swapTokensForBNB(uint256 tokenAmount) internal returns (bool) {
        if (tokenAmount == 0) {
            return false;
        }

        _swappingTax = true;
        _approve(address(this), PANCAKE_V2_ROUTER, tokenAmount);

        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = WBNB;

        try IPancakeV2Router(PANCAKE_V2_ROUTER).swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0,
            path,
            marketingWallet,
            block.timestamp
        ) {
            if (collectedTaxTokens >= tokenAmount) {
                collectedTaxTokens -= tokenAmount;
            } else {
                collectedTaxTokens = 0;
            }
            emit TaxSwappedToBNB(tokenAmount, marketingWallet);
            _swappingTax = false;
            return true;
        } catch {
            emit TaxSwapFailed(tokenAmount, marketingWallet);
        }

        _swappingTax = false;
        return false;
    }

    function _rawTransfer(address from, address to, uint256 amount) internal {
        require(_balances[from] >= amount, "CR7: transfer amount exceeds balance");
        unchecked {
            _balances[from] -= amount;
        }
        _balances[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address account, uint256 amount) internal {
        require(account != address(0), "CR7: mint to zero");
        totalSupply += amount;
        _balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    function _approve(address tokenOwner, address spender, uint256 amount) internal {
        require(tokenOwner != address(0), "CR7: approve from zero");
        require(spender != address(0), "CR7: approve to zero");
        _allowances[tokenOwner][spender] = amount;
        emit Approval(tokenOwner, spender, amount);
    }

    function _spendAllowance(address tokenOwner, address spender, uint256 amount) internal {
        uint256 currentAllowance = _allowances[tokenOwner][spender];
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "CR7: insufficient allowance");
            unchecked {
                _approve(tokenOwner, spender, currentAllowance - amount);
            }
        }
    }
}


