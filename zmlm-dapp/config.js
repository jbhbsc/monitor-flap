window.ZMLM_CONFIG = {
  // Deploy zmlm-dapp/contracts/ZMLMPaidMintToken.sol and fill the address here.
  MINT_CONTRACT_ADDRESS: "0xE7F861DeBEcA9B321cBA5e589C5357817617827B",

  // The paid-mint contract is also the token contract. Fill the same address after deployment.
  TOKEN_CONTRACT_ADDRESS: "0xE7F861DeBEcA9B321cBA5e589C5357817617827B",

  // payable mint() selector.
  MINT_MODE: "mintFunction",
  MINT_FUNCTION_SELECTOR: "0x1249c58b",

  // Mint rule: each 0.01 BNB mints 10,000 ZMLM.
  MIN_MINT_BNB: "0.01",
  MAX_WALLET_MINT_BNB: "0.1",
  MINT_STEP_BNB: "0.01",
  TOKENS_PER_0_01_BNB: "10000",
  TOKEN_SYMBOL: "ZMLM",

  // Frontend progress. Set this to the amount of tokens DEV transfers into the contract for mint inventory.
  TOTAL_MINT_SUPPLY: 10000000,

  // totalMintedTokens() returns uint256 token units with 18 decimals.
  TOTAL_MINTED_SELECTOR: "0x8e32e316",
  TOTAL_MINTED_DECIMALS: 18,

  // mintedWei(address) selector, used to show the connected wallet's real on-chain quota.
  WALLET_MINTED_SELECTOR: "0x61dcde0f",

  INITIAL_TOTAL_MINTED: 0,

  TELEGRAM_URL: "https://t.me/ZM666688888",
  TWITTER_URL: "https://x.com/zmcto_888?s=21",
  QQ_GROUP: "682808056"
};
