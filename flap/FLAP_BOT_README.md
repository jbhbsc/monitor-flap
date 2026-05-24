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
- To buy behind the developer/first external buy, use `MIN_PREVIOUS_BUYS=1` and set `MIN_PREVIOUS_BUY_BNB` to the minimum buy size, for example `0.05`.
- Qualifying buy checks are scoped to each token's own `TokenCreated.creator`, so each new token follows its own developer address.
- `PREVIOUS_BUY_LOOKAHEAD_BLOCKS` backfills recent buy logs after a token passes filters, reducing missed triggers when the dev buy arrives before the watch state is registered.
- For lower latency but higher risk, set `MIN_PREVIOUS_BUYS=0` to buy immediately after creation filters pass. Setting `QUOTE_PROBE_BNB` equal to `BUY_BNB` lets the bot reuse the filter quote for the buy transaction.
- Optional `GAS_PRICE_GWEI` sets a fixed BSC gas price for buy transactions.
- 5x position value triggers selling half.
- If a position is still below cost after `LOSS_SELL_AFTER_SECONDS`, default `3600`, the bot sells the full remaining balance. Positions at or above cost are left untouched.
- If a saved position repeatedly fails balance/quote monitoring, `CLOSE_AFTER_POSITION_ERRORS`, default `3`, marks it closed so stale or broken token records stop printing logs.

## Important

Market cap is estimated from a small BNB quote and `BNB_USD`. For live trading, use a fast private RPC, a tiny test wallet, and verify the Flap contract addresses before enabling real buys.
