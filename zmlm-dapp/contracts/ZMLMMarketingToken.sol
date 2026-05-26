// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ZMLMMarketingToken
 * @notice ERC20 token with owner-managed marketing wallet, fee whitelist,
 * blacklist, AMM pair marking, and tax routed to the marketing wallet.
 *
 * Tax behavior:
 * - If `from` is an AMM pair, `buyTaxBps` is used.
 * - If `to` is an AMM pair, `sellTaxBps` is used.
 * - Otherwise `transferTaxBps` is used.
 * - Whitelisted addresses are excluded from tax.
 * - Blacklisted addresses cannot send or receive.
 *
 * BPS means basis points: 100 = 1%, 1000 = 10%.
 */
contract ZMLMMarketingToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public owner;
    address public marketingWallet;

    uint16 public buyTaxBps;
    uint16 public sellTaxBps;
    uint16 public transferTaxBps;

    uint16 public constant MAX_TAX_BPS = 2_500; // 25%
    uint16 public constant BPS_DENOMINATOR = 10_000;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    mapping(address => bool) public isTaxWhitelisted;
    mapping(address => bool) public isBlacklisted;
    mapping(address => bool) public isAutomatedMarketMakerPair;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MarketingWalletUpdated(address indexed previousWallet, address indexed newWallet);
    event TaxesUpdated(uint16 buyTaxBps, uint16 sellTaxBps, uint16 transferTaxBps);
    event TaxWhitelistUpdated(address indexed account, bool isWhitelisted);
    event BlacklistUpdated(address indexed account, bool isBlacklisted);
    event AutomatedMarketMakerPairUpdated(address indexed pair, bool isPair);

    modifier onlyOwner() {
        require(msg.sender == owner, "ZMLM: caller is not owner");
        _;
    }

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        uint256 initialSupply,
        address initialMarketingWallet
    ) {
        require(initialMarketingWallet != address(0), "ZMLM: zero marketing wallet");

        name = tokenName;
        symbol = tokenSymbol;
        owner = msg.sender;
        marketingWallet = initialMarketingWallet;

        isTaxWhitelisted[msg.sender] = true;
        isTaxWhitelisted[address(this)] = true;
        isTaxWhitelisted[initialMarketingWallet] = true;

        _mint(msg.sender, initialSupply * 10 ** decimals);
        emit OwnershipTransferred(address(0), msg.sender);
        emit MarketingWalletUpdated(address(0), initialMarketingWallet);
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address tokenOwner, address spender) external view returns (uint256) {
        return _allowances[tokenOwner][spender];
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
        require(currentAllowance >= subtractedValue, "ZMLM: decreased allowance below zero");
        unchecked {
            _approve(msg.sender, spender, currentAllowance - subtractedValue);
        }
        return true;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZMLM: zero new owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
        isTaxWhitelisted[newOwner] = true;
        emit TaxWhitelistUpdated(newOwner, true);
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    function setMarketingWallet(address newMarketingWallet) external onlyOwner {
        require(newMarketingWallet != address(0), "ZMLM: zero marketing wallet");
        emit MarketingWalletUpdated(marketingWallet, newMarketingWallet);
        marketingWallet = newMarketingWallet;
        isTaxWhitelisted[newMarketingWallet] = true;
        emit TaxWhitelistUpdated(newMarketingWallet, true);
    }

    function setTaxes(
        uint16 newBuyTaxBps,
        uint16 newSellTaxBps,
        uint16 newTransferTaxBps
    ) external onlyOwner {
        require(newBuyTaxBps <= MAX_TAX_BPS, "ZMLM: buy tax too high");
        require(newSellTaxBps <= MAX_TAX_BPS, "ZMLM: sell tax too high");
        require(newTransferTaxBps <= MAX_TAX_BPS, "ZMLM: transfer tax too high");

        buyTaxBps = newBuyTaxBps;
        sellTaxBps = newSellTaxBps;
        transferTaxBps = newTransferTaxBps;
        emit TaxesUpdated(newBuyTaxBps, newSellTaxBps, newTransferTaxBps);
    }

    function setTaxWhitelisted(address account, bool whitelisted) external onlyOwner {
        isTaxWhitelisted[account] = whitelisted;
        emit TaxWhitelistUpdated(account, whitelisted);
    }

    function setTaxWhitelistBatch(address[] calldata accounts, bool whitelisted) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            isTaxWhitelisted[accounts[i]] = whitelisted;
            emit TaxWhitelistUpdated(accounts[i], whitelisted);
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
        require(pair != address(0), "ZMLM: zero pair");
        isAutomatedMarketMakerPair[pair] = isPair;
        emit AutomatedMarketMakerPairUpdated(pair, isPair);
    }

    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "ZMLM: zero recipient");
        require(token != address(this), "ZMLM: cannot rescue own token");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZMLM: rescue failed");
    }

    function rescueBNB(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "ZMLM: zero recipient");
        (bool success, ) = to.call{value: amount}("");
        require(success, "ZMLM: BNB rescue failed");
    }

    receive() external payable {}

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "ZMLM: transfer from zero");
        require(to != address(0), "ZMLM: transfer to zero");
        require(!isBlacklisted[from] && !isBlacklisted[to], "ZMLM: blacklisted address");

        uint256 fromBalance = _balances[from];
        require(fromBalance >= amount, "ZMLM: transfer amount exceeds balance");

        uint256 fee = _calculateFee(from, to, amount);
        uint256 sendAmount = amount - fee;

        unchecked {
            _balances[from] = fromBalance - amount;
        }

        if (fee > 0) {
            _balances[marketingWallet] += fee;
            emit Transfer(from, marketingWallet, fee);
        }

        _balances[to] += sendAmount;
        emit Transfer(from, to, sendAmount);
    }

    function _calculateFee(address from, address to, uint256 amount) internal view returns (uint256) {
        if (amount == 0 || isTaxWhitelisted[from] || isTaxWhitelisted[to]) {
            return 0;
        }

        uint16 taxBps = transferTaxBps;
        if (isAutomatedMarketMakerPair[from]) {
            taxBps = buyTaxBps;
        } else if (isAutomatedMarketMakerPair[to]) {
            taxBps = sellTaxBps;
        }

        if (taxBps == 0) {
            return 0;
        }

        return (amount * taxBps) / BPS_DENOMINATOR;
    }

    function _mint(address account, uint256 amount) internal {
        require(account != address(0), "ZMLM: mint to zero");
        totalSupply += amount;
        _balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    function _approve(address tokenOwner, address spender, uint256 amount) internal {
        require(tokenOwner != address(0), "ZMLM: approve from zero");
        require(spender != address(0), "ZMLM: approve to zero");
        _allowances[tokenOwner][spender] = amount;
        emit Approval(tokenOwner, spender, amount);
    }

    function _spendAllowance(address tokenOwner, address spender, uint256 amount) internal {
        uint256 currentAllowance = _allowances[tokenOwner][spender];
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "ZMLM: insufficient allowance");
            unchecked {
                _approve(tokenOwner, spender, currentAllowance - amount);
            }
        }
    }
}
