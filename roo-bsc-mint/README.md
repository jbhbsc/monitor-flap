# roo-bsc-mint

Standalone BSC SquidToken module.

## Current Mode

This project no longer has a mint flow. It deploys `SquidToken` and serves a dividend claim page.

- Total supply: `1,000,000`
- All supply is sent to the owner/dev wallet
- Pancake V2 pair is created in the constructor
- Non-whitelist buys receive `5%` of the bought tokens
- `5%` tokens are collected by the contract, swapped to BNB, and deposited into the claimable dividend pool
- `90%` tokens are sent to the ecosystem wallet
- The owner can update these buy tax percentages with basis points, as long as the three values total `10000`
- Whitelist buys receive `100%` normally
- Dividend shares are weighted by the amount of tokens collected into the dividend pool from each buyer
- Users claim BNB dividends on `public/index.html`

## Constructor Params

```text
tokenName
tokenSymbol
initialOwner
initialDividendPoolWallet
initialEcosystemWallet
```

PancakeSwap V2 router on BSC is hardcoded:

```text
0x10ED43C718714eb63d5aA57B78B54704E256024E
```

## Main Owner Methods

```text
setTradingEnabled(bool)
setFeeExempt(address,bool)
setTradingWhitelist(address,bool)
batchSetTradingWhitelist(address[],bool)
setLiquidityManager(address,bool)
setBlacklist(address,bool)
setAutomatedMarketMakerPair(address,bool)
setNonWhitelistBuyTaxBps(uint256,uint256,uint256)
rescueToken(address,uint256,address)
```

## Dividend Methods

```text
claimDividends()
withdrawableDividendOf(address)
dividendBalanceOf(address)
totalDividendShares()
totalDividendsDeposited()
pendingDividendTokens()
processDividendTokens()
```

## Local

```bash
npm install
npm start
```

Default local URL:

```text
http://127.0.0.1:4310
```

## Deploy Script Env

```text
PRIVATE_KEY=
BSC_RPC_URL=https://bsc.publicnode.com
TOKEN_NAME=SquidToken
TOKEN_SYMBOL=SQUID
OWNER_ADDRESS=0xYourDevWallet
DIVIDEND_POOL_WALLET=0xYourDividendPoolWallet
ECOSYSTEM_WALLET=0xYourEcosystemWallet
```

Run deploy:

```bash
npm run deploy:token
```
