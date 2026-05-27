window.ZMLM_CONFIG = {
  // Deploy zmlm-dapp/contracts/ZMLMPaidMintToken.sol and fill the address here.
  MINT_CONTRACT_ADDRESS: "0x599348190E2B869A7fa60Ca0D02446Fb50E17777",

  // The paid-mint contract is also the token contract. Fill the same address after deployment.
  TOKEN_CONTRACT_ADDRESS: "0x599348190E2B869A7fa60Ca0D02446Fb50E17777",
  DIVIDEND_POOL_ADDRESS: "",

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
  // Backend/admin display switch. false means every user sees 0% progress.
  MINT_PROGRESS_ENABLED: true,

  // totalMintedTokens() returns uint256 token units with 18 decimals.
  TOTAL_MINTED_SELECTOR: "0x8e32e316",
  TOTAL_MINTED_DECIMALS: 18,

  // mintedWei(address) selector, used to show the connected wallet's real on-chain quota.
  WALLET_MINTED_SELECTOR: "0x61dcde0f",

  STAKE_SELECTOR: "0xa694fc3a",
  UNSTAKE_SELECTOR: "0x2e17de78",
  CLAIM_SELECTOR: "0x4e71d92d",
  APPROVE_SELECTOR: "0x095ea7b3",
  ALLOWANCE_SELECTOR: "0xdd62ed3e",
  BALANCE_OF_SELECTOR: "0x70a08231",
  POOL_PENDING_REWARDS_SELECTOR: "0x31d7a262",
  POOL_USER_WEIGHT_BPS_SELECTOR: "0x067208d2",
  POOL_TOTAL_STAKED_SELECTOR: "0x817b1cd2",
  POOL_UNDISTRIBUTED_REWARDS_SELECTOR: "0x319ce2bb",
  POOL_NEXT_DISTRIBUTION_SELECTOR: "0x091fb010",
  POOL_STAKES_SELECTOR: "0x16934fc4",

  INITIAL_TOTAL_MINTED: 0,

  TELEGRAM_URL: "https://t.me/ZM666688888",
  TWITTER_URL: "https://x.com/zmcto_888?s=21",
  QQ_GROUP: "682808056"
};
