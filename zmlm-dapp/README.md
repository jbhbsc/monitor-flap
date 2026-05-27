# ZMLM DApp

Static BSC mint DApp for `contracts/ZMLMPaidMintToken.sol`.

## Mint Rule

- `0.01 BNB` mints `10,000 ZMLM`.
- Mint amount must be a multiple of `0.01 BNB`.
- One wallet can mint up to `0.1 BNB`, equal to `10,000 ZMLM`.
- User mint tokens are transferred from the contract inventory.
- After deployment, the DEV wallet should transfer the planned mint inventory into the token contract address.
- BNB paid by minters is forwarded to the DEV wallet.
- The contract enforces the same rules; frontend checks are only user guidance.

## Contract Features

- Paid mint with automatic token delivery from contract inventory.
- 3% default buy tax and 3% default sell tax. Buy and sell tax are swapped to BNB and sent to the marketing wallet by default.
- Owner-managed blacklist and whitelist.
- Owner-managed AMM pair marking.
- Automatically creates and marks the PancakeSwap V2 ZMLM/WBNB, ZMLM/USDT, ZMLM/FIST, and ZMLM/ZM pairs on deployment.
- Trading on/off switch.
- Transfer ownership and renounce ownership.
- Rescue BNB or tokens accidentally sent to the contract.
- Optional, transparent sell-triggered dust airdrop to a configured recipient list.

The contract cannot secretly create new EOA wallets. The dust airdrop feature sends a tiny share of the sell tax to owner-configured zero-balance recipients and emits `SellDustAirdrop`.

By default, `dustAirdropTaxShareBps` is `10`, which means `10 / 10000 = 1/1000` of the sell tax. Example: a 10,000 ZMLM sell pays 300 ZMLM tax; 0.3 ZMLM can be airdropped and 299.7 ZMLM goes to the marketing wallet.

Constructor parameters:

- `tokenName`: token name, for example `ZMLM`.
- `tokenSymbol`: token symbol, for example `ZMLM`.
- `initialDevWallet`: DEV wallet that receives the full fixed initial supply and all mint BNB. It is also the default marketing wallet.

The constructor automatically calls PancakeSwap V2 factory on BNB Chain and stores the created `pancakeWbnbPair`, `pancakeUsdtPair`, `pancakeFistPair`, and `pancakeZmPair`. All four are marked as AMM pairs for sell tax before ownership can be renounced. After `renounceOwnership()`, owner-only functions such as `setAutomatedMarketMakerPair` can no longer be called.

Tax values use BPS: `300 = 3%`, `1000 = 10%`. The owner can call `setTaxes(buy, sell, transfer)` up to `maxTaxBps`, and can call `setMaxTaxBps` up to the hard cap `5000 = 50%`. After ownership is renounced, tax values and limits cannot be changed.

`swapTaxToBnbEnabled` is enabled by default. On AMM buys and sells, the marketing share of the tax is collected by the contract, swapped through PancakeSwap V2 to BNB, and sent to `marketingWallet`. The owner can disable this with `setSwapTaxToBnbEnabled(false)`, in which case tax is sent as tokens.

## Start

```bash
npm.cmd start
```

Then open:

```text
http://127.0.0.1:4173
```

## Config

After deployment, edit `config.js`:

- `MINT_CONTRACT_ADDRESS`: deployed `ZMLMPaidMintToken` address.
- `TOKEN_CONTRACT_ADDRESS`: same token address for display.
- `TOTAL_MINT_SUPPLY`: set to the amount of tokens the DEV wallet transfers into the contract as mint inventory.
- `TELEGRAM_URL` and `TWITTER_URL`: community links.

The frontend calls payable `mint()` using selector `0x1249c58b`.

## Batch Sweep BNB

The local script `scripts/sweep-bnb.js` can batch transfer BNB from multiple wallets into one receive address. Keep private keys only in your local `.env` file and never commit it.

1. Install dependencies:

```bash
npm.cmd install
```

2. Copy `.env.example` to `.env`, then fill:

```text
BNB_SWEEP_TO=0xYourReceiveAddress
BNB_SWEEP_PRIVATE_KEYS=0xkey1,0xkey2
```

`BNB_SWEEP_TO` can also be the ZMLM mint contract address. The deployed contract has a payable `receive()` function, so a plain BNB transfer to the contract can trigger mint.

3. Preview only:

```bash
npm.cmd run sweep:bnb
```

4. Preview a fixed transfer amount from every wallet:

```bash
npm.cmd run sweep:bnb -- --amount 0.01
```

5. Execute real transfers:

```bash
npm.cmd run sweep:bnb -- --execute
```

Or execute a fixed transfer amount:

```bash
npm.cmd run sweep:bnb -- --amount 0.01 --execute
```

The script estimates gas per wallet. A plain wallet transfer usually uses `21000` gas, but sending BNB to the ZMLM mint contract needs more gas because the contract mints tokens and forwards BNB internally. If the RPC cannot estimate gas, set `BNB_SWEEP_GAS_LIMIT=200000` in `.env`.

The script keeps a small BNB reserve for gas and skips wallets without enough balance. If no amount is provided, it transfers each wallet's available BNB after gas and reserve.
