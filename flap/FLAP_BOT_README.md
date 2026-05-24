# Flap BNB Board Monitor

This bot listens to Flap's BNB Portal `TokenCreated` and `TokenBought` events, filters new tokens, and can automatically buy matched tokens as soon as the first qualifying external buy arrives.

## Setup

```bash
npm install
copy .env.example .env
npm run flap
```

Keep `DRY_RUN=true` until logs look correct. Set `DRY_RUN=false` only after adding a funded wallet private key.

## Filters

- Created on Flap BNB Portal.
- Created within `MAX_TOKEN_AGE_SECONDS`, default `3`.
- Estimated market cap below `MAX_MARKET_CAP_USD`, default `$10,000`.
- Quote token/liquidity token must be native BNB.
- Buy tax and sell tax must each be `< 5%`.
- After a token passes the creation filters, the bot watches live buy events for up to `TOKEN_WATCH_SECONDS`, default `15`.
- The first qualifying external buy can trigger the bot immediately when `MIN_PREVIOUS_BUYS=1`; each qualifying buy must be at least `MIN_PREVIOUS_BUY_BNB`, default `0.01 BNB`.
- 5x position value triggers selling half.

## Important

Market cap is estimated from a small BNB quote and `BNB_USD`. For live trading, use a fast private RPC, a tiny test wallet, and verify the Flap contract addresses before enabling real buys.
