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
- 3% sell tax routed directly to the marketing wallet.
- Owner-managed blacklist and whitelist.
- Owner-managed AMM pair marking.
- Automatically creates and marks the PancakeSwap V2 ZMLM/WBNB, ZMLM/USDT, and ZMLM/FIST pairs on deployment.
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

The constructor automatically calls PancakeSwap V2 factory on BNB Chain and stores the created `pancakeWbnbPair`, `pancakeUsdtPair`, and `pancakeFistPair`. All three are marked as AMM pairs for sell tax before ownership can be renounced. After `renounceOwnership()`, owner-only functions such as `setAutomatedMarketMakerPair` can no longer be called.

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
