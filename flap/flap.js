const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config();

const ZERO = "0x0000000000000000000000000000000000000000";
const PORTAL = "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0";
const TAX_HELPER = "0x53841c73217735F37BC1775538b03b23feFD8346";
const POSITIONS_FILE = path.join(__dirname, "flap-positions.json");

const CFG = {
  rpcUrl: process.env.BSC_RPC_URL || "https://bsc.publicnode.com",
  wsUrl: process.env.BSC_WS_URL || "",
  privateKey: process.env.PRIVATE_KEY || "",
  dryRun: (process.env.DRY_RUN || "true").toLowerCase() !== "false",
  buyBnb: process.env.BUY_BNB || "0.01",
  maxAgeSeconds: Number(process.env.MAX_TOKEN_AGE_SECONDS || 3),
  maxMarketCapUsd: Number(process.env.MAX_MARKET_CAP_USD || 10000),
  maxBuyTaxBps: Number(process.env.MAX_BUY_TAX_BPS || 500),
  maxSellTaxBps: Number(process.env.MAX_SELL_TAX_BPS || 500),
  bnbUsd: Number(process.env.BNB_USD || 650),
  quoteProbeBnb: process.env.QUOTE_PROBE_BNB || "0.01",
  buySlippageBps: Number(process.env.BUY_SLIPPAGE_BPS || 1200),
  sellSlippageBps: Number(process.env.SELL_SLIPPAGE_BPS || 1200),
  takeProfitMultiple: Number(process.env.TAKE_PROFIT_MULTIPLE || 5),
  lossSellAfterSeconds: Number(process.env.LOSS_SELL_AFTER_SECONDS || 3600),
  pollMs: Number(process.env.PROFIT_POLL_MS || 5000),
  eventPollMs: Number(process.env.EVENT_POLL_MS || 1200),
  maxBlockRange: Number(process.env.MAX_BLOCK_RANGE || 20),
  minPreviousBuys: Number(process.env.MIN_PREVIOUS_BUYS || 1),
  minPreviousBuyBnb: process.env.MIN_PREVIOUS_BUY_BNB || "0.0",
  tokenWatchSeconds: Number(process.env.TOKEN_WATCH_SECONDS || 15),
};

const portalAbi = [
  "event TokenCreated(uint256 ts,address creator,uint256 nonce,address token,string name,string symbol,string meta)",
  "event TokenQuoteSet(address token,address quoteToken)",
  "event TokenBought(uint256 ts,address token,address buyer,uint256 amount,uint256 eth,uint256 fee,uint256 postPrice)",
  "event TokenSold(uint256 ts,address token,address seller,uint256 amount,uint256 eth,uint256 fee,uint256 postPrice)",
  "function quoteExactInput((address inputToken,address outputToken,uint256 inputAmount) params) returns (uint256 outputAmount)",
  "function swapExactInput((address inputToken,address outputToken,uint256 inputAmount,uint256 minOutputAmount,bytes permitData) params) payable returns (uint256 outputAmount)",
];

const taxHelperAbi = [
  "function getTaxTokenInfoV2(address taxToken) view returns ((uint16 marketBps,uint16 deflationBps,uint16 lpBps,uint16 dividendBps,uint16 buyTaxRate,uint16 sellTaxRate,uint256 burntTokenAmount,uint256 totalQuoteSentToDividend,uint256 totalQuoteAddedToLiquidity,uint256 totalTokenAddedToLiquidity,uint256 totalQuoteSentToMarketing,address dividendToken,address quoteToken,uint256 minimumShareBalance,(address addr,address factory,uint8 riskLevel,bool isOfficial,bool isAIConsumer) vaultInfo) info)",
];

const erc20Abi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const provider = new ethers.JsonRpcProvider(
  CFG.rpcUrl,
  { chainId: 56, name: "bnb" },
  { staticNetwork: true }
);
const eventProvider = CFG.wsUrl
  ? new ethers.WebSocketProvider(CFG.wsUrl, { chainId: 56, name: "bnb" }, { staticNetwork: true })
  : provider;
const wallet = CFG.privateKey ? new ethers.Wallet(CFG.privateKey, provider) : null;
const portal = new ethers.Contract(PORTAL, portalAbi, wallet || provider);
const portalRead = new ethers.Contract(PORTAL, portalAbi, provider);
const taxHelper = new ethers.Contract(TAX_HELPER, taxHelperAbi, provider);
const portalIface = new ethers.Interface(portalAbi);
const tokenCreatedTopic = portalIface.getEvent("TokenCreated").topicHash;
const tokenBoughtTopic = portalIface.getEvent("TokenBought").topicHash;
const watchedTokens = new Map();
const purchasedTokens = new Set();
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function log(title, message = "") {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  console.log(`[${time}] ${title}${message ? ` ${message}` : ""}`);
}

function logError(title, error) {
  const message = error && error.message ? error.message : String(error);
  log(title, message);
}

function green(text) {
  return `${colors.green}${colors.bold}${text}${colors.reset}`;
}

function red(text) {
  return `${colors.red}${colors.bold}${text}${colors.reset}`;
}

function yellow(text) {
  return `${colors.yellow}${text}${colors.reset}`;
}

function loadPositions() {
  if (!fs.existsSync(POSITIONS_FILE)) return {};
  return JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8"));
}

function savePositions(positions) {
  fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, bigintReplacer, 2));
}

function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function fmtBnb(value) {
  return Number(ethers.formatEther(value)).toFixed(6);
}

function toBpsText(bps) {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

function minOut(amount, slippageBps) {
  return (amount * BigInt(10000 - slippageBps)) / 10000n;
}

async function quoteBuy(token, bnbIn) {
  return portalRead.quoteExactInput.staticCall({
    inputToken: ZERO,
    outputToken: token,
    inputAmount: bnbIn,
  });
}

async function quoteSell(token, tokenIn) {
  return portalRead.quoteExactInput.staticCall({
    inputToken: token,
    outputToken: ZERO,
    inputAmount: tokenIn,
  });
}

async function getDecimals(token) {
  const erc20 = new ethers.Contract(token, erc20Abi, provider);
  try {
    return Number(await erc20.decimals());
  } catch {
    return 18;
  }
}

async function estimateMarketCapUsd(token) {
  const probeIn = ethers.parseEther(CFG.quoteProbeBnb);
  const out = await quoteBuy(token, probeIn);
  if (out === 0n) return Number.POSITIVE_INFINITY;

  const decimals = await getDecimals(token);
  const tokensOut = Number(ethers.formatUnits(out, decimals));
  const bnbIn = Number(ethers.formatEther(probeIn));
  const priceBnb = bnbIn / tokensOut;
  return priceBnb * 1_000_000_000 * CFG.bnbUsd;
}

async function getTaxInfo(token) {
  try {
    const info = await taxHelper.getTaxTokenInfoV2(token);
    return {
      buyTaxBps: Number(info.buyTaxRate || 0),
      sellTaxBps: Number(info.sellTaxRate || 0),
      quoteToken: info.quoteToken || ZERO,
    };
  } catch (error) {
    return { buyTaxBps: 0, sellTaxBps: 0, quoteToken: ZERO, error: error.message };
  }
}

async function quoteTokenFromCreationTx(txHash, token) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return ZERO;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== PORTAL.toLowerCase()) continue;
    try {
      const parsed = portalIface.parseLog(log);
      if (parsed.name === "TokenQuoteSet" && parsed.args.token.toLowerCase() === token.toLowerCase()) {
        return parsed.args.quoteToken;
      }
    } catch {
      // Ignore unrelated Portal logs.
    }
  }

  return ZERO;
}

async function passesFilters(event) {
  const { token, name, symbol, ts } = event.args;
  const age = Math.floor(Date.now() / 1000) - Number(ts);
  log("Filter", `${symbol}(${name}) age ${age}s, need <= ${CFG.maxAgeSeconds}s`);
  if (age > CFG.maxAgeSeconds) {
    return { ok: false, reason: `created ${age}s ago, over ${CFG.maxAgeSeconds}s` };
  }

  const [txQuoteToken, tax, marketCapUsd] = await Promise.all([
    quoteTokenFromCreationTx(event.log.transactionHash, token),
    getTaxInfo(token),
    estimateMarketCapUsd(token),
  ]);

  log("Filter", `creation quote asset ${txQuoteToken === ZERO ? "BNB" : txQuoteToken}`);
  log(
    "Filter",
    `buy tax ${toBpsText(tax.buyTaxBps)} / sell tax ${toBpsText(tax.sellTaxBps)} / pool ${tax.quoteToken === ZERO ? "BNB" : tax.quoteToken}`
  );
  log("Filter", `estimated market cap ${marketCapUsd.toFixed(2)}, need < ${CFG.maxMarketCapUsd}`);

  if (txQuoteToken !== ZERO) {
    return { ok: false, reason: `creation quoteToken is not BNB: ${txQuoteToken}` };
  }
  if (tax.quoteToken !== ZERO) {
    return { ok: false, reason: `tax quoteToken is not BNB: ${tax.quoteToken}` };
  }
  if (tax.buyTaxBps >= CFG.maxBuyTaxBps || tax.sellTaxBps >= CFG.maxSellTaxBps) {
    return {
      ok: false,
      reason: `tax too high: buy ${toBpsText(tax.buyTaxBps)}, sell ${toBpsText(tax.sellTaxBps)}`,
    };
  }

  if (!Number.isFinite(marketCapUsd) || marketCapUsd > CFG.maxMarketCapUsd) {
    return { ok: false, reason: `estimated market cap ${marketCapUsd.toFixed(2)}, over ${CFG.maxMarketCapUsd}` };
  }

  return {
    ok: true,
    token,
    name,
    symbol,
    age,
    marketCapUsd,
    buyTaxBps: tax.buyTaxBps,
    sellTaxBps: tax.sellTaxBps,
    previousBuys: 0,
  };
}
async function buyToken(candidate) {
  const inputAmount = ethers.parseEther(CFG.buyBnb);
  const expectedOut = await quoteBuy(candidate.token, inputAmount);
  const minimumOut = minOut(expectedOut, CFG.buySlippageBps);

  log(
    "Matched",
    `${candidate.symbol} contract ${green(candidate.token)} | market cap ${candidate.marketCapUsd.toFixed(2)} | buy tax ${toBpsText(candidate.buyTaxBps)} | sell tax ${toBpsText(candidate.sellTaxBps)}`
  );
  log("Buy check", `qualified external buys: ${candidate.previousBuys}`);
  log(
    "Buy quote",
    `spend ${CFG.buyBnb} BNB, expected token units ${expectedOut.toString()}, minimum out ${minimumOut.toString()}`
  );

  if (CFG.dryRun) {
    log("Dry run buy", `DRY_RUN=true; would buy ${CFG.buyBnb} BNB of ${candidate.symbol}`);
    return;
  }
  if (!wallet) throw new Error("DRY_RUN=false requires PRIVATE_KEY in .env");

  const tx = await portal.swapExactInput(
    {
      inputToken: ZERO,
      outputToken: candidate.token,
      inputAmount,
      minOutputAmount: minimumOut,
      permitData: "0x",
    },
    { value: inputAmount }
  );

  log("Buy sent", tx.hash);
  const receipt = await tx.wait();
  log("Buy confirmed", `block ${receipt.blockNumber}`);

  const tokenContract = new ethers.Contract(candidate.token, erc20Abi, provider);
  const balance = await tokenContract.balanceOf(wallet.address);
  const positions = loadPositions();
  positions[candidate.token.toLowerCase()] = {
    token: candidate.token,
    symbol: candidate.symbol,
    name: candidate.name,
    spentWei: inputAmount.toString(),
    balanceAtBuy: balance.toString(),
    boughtAt: new Date().toISOString(),
    soldHalf: false,
  };
  savePositions(positions);
}
async function sellHalf(position) {
  const token = position.token;
  const tokenContract = new ethers.Contract(token, erc20Abi, provider);
  const balance = wallet ? await tokenContract.balanceOf(wallet.address) : BigInt(position.balanceAtBuy || 0);
  const half = balance / 2n;
  if (half === 0n) return;

  await sellTokenAmount(position, half, "take-profit-half");

  const positions = loadPositions();
  positions[token.toLowerCase()].soldHalf = true;
  positions[token.toLowerCase()].soldAt = new Date().toISOString();
  savePositions(positions);
  log("Sell confirmed", `${position.symbol} sold half`);
}
async function sellTokenAmount(position, amount, reason) {
  if (CFG.dryRun) {
    log("Dry run sell", `DRY_RUN=true; ${position.symbol} ${reason}, would sell ${amount.toString()} token units`);
    return;
  }
  if (!wallet) throw new Error("DRY_RUN=false requires PRIVATE_KEY in .env");

  const token = position.token;
  const tokenContract = new ethers.Contract(token, erc20Abi, wallet);
  const allowance = await tokenContract.allowance(wallet.address, PORTAL);
  if (allowance < amount) {
    const approveTx = await tokenContract.approve(PORTAL, ethers.MaxUint256);
    log("Approve sent", `${position.symbol} ${approveTx.hash}`);
    await approveTx.wait();
  }

  const expectedBnb = await quoteSell(token, amount);
  const minimumBnb = minOut(expectedBnb, CFG.sellSlippageBps);
  const tx = await portal.swapExactInput({
    inputToken: token,
    outputToken: ZERO,
    inputAmount: amount,
    minOutputAmount: minimumBnb,
    permitData: "0x",
  });
  log("Sell sent", `${position.symbol} ${reason} ${tx.hash}`);
  await tx.wait();
}
async function monitorTakeProfit() {
  if (!wallet) return;
  const positions = loadPositions();

  for (const position of Object.values(positions)) {
    if (position.soldHalf) continue;
    const tokenContract = new ethers.Contract(position.token, erc20Abi, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    if (balance === 0n) continue;

    const nowValue = await quoteSell(position.token, balance);
    const spent = BigInt(position.spentWei);
    const multiple = Number(ethers.formatEther(nowValue)) / Number(ethers.formatEther(spent));
    log("Take profit monitor", `${position.symbol} current ${fmtBnb(nowValue)} BNB, cost ${fmtBnb(spent)} BNB, multiple ${multiple.toFixed(2)}x`);

    if (nowValue >= spent * BigInt(CFG.takeProfitMultiple)) {
      await sellHalf(position);
    }
  }
}
async function monitorTimedStopLoss() {
  if (!wallet || CFG.lossSellAfterSeconds <= 0) return;
  const positions = loadPositions();
  const now = Date.now();

  for (const position of Object.values(positions)) {
    if (position.soldAllLoss || !position.boughtAt) continue;
    const boughtAtMs = Date.parse(position.boughtAt);
    if (!Number.isFinite(boughtAtMs) || now - boughtAtMs < CFG.lossSellAfterSeconds * 1000) continue;

    const tokenContract = new ethers.Contract(position.token, erc20Abi, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    if (balance === 0n) continue;

    const nowValue = await quoteSell(position.token, balance);
    const spent = BigInt(position.spentWei);
    const multiple = Number(ethers.formatEther(nowValue)) / Number(ethers.formatEther(spent));
    log(
      "Timed loss check",
      `${position.symbol} held ${Math.floor((now - boughtAtMs) / 1000)}s, current ${fmtBnb(nowValue)} BNB, cost ${fmtBnb(spent)} BNB, multiple ${multiple.toFixed(2)}x`
    );

    if (nowValue < spent) {
      log("Timed loss sell", `${position.symbol} is below cost after ${CFG.lossSellAfterSeconds}s; selling all`);
      await sellTokenAmount(position, balance, "timed-stop-loss-all");
      const latestPositions = loadPositions();
      latestPositions[position.token.toLowerCase()].soldAllLoss = true;
      latestPositions[position.token.toLowerCase()].soldAllLossAt = new Date().toISOString();
      latestPositions[position.token.toLowerCase()].lossSellValueWei = nowValue.toString();
      savePositions(latestPositions);
      log("Sell confirmed", `${position.symbol} sold all by timed stop loss`);
    }
  }
}
async function handleTokenCreatedLog(eventLog) {
  try {
    const parsed = portalIface.parseLog(eventLog);
    const [ts, creator, nonce, token, name, symbol, meta] = parsed.args;
    const event = { args: { ts, creator, nonce, token, name, symbol, meta }, log: eventLog };

    const tokenKey = token.toLowerCase();
    if (purchasedTokens.has(tokenKey) || watchedTokens.has(tokenKey)) return;

    log("New token", `${symbol}(${name}) contract ${yellow(token)}`);
    log("Creation", `creator ${creator} | tx ${eventLog.transactionHash} | block ${eventLog.blockNumber}`);
    const candidate = await passesFilters(event);
    if (!candidate.ok) {
      log("Rejected", `${symbol} contract ${red(token)} | reason: ${candidate.reason}`);
      return;
    }
    watchedTokens.set(tokenKey, {
      candidate,
      createdAtMs: Date.now(),
      qualifiedBuys: 0,
    });
    log(
      "Watching buys",
      `${symbol} contract ${green(token)} passed filters; will buy after ${CFG.minPreviousBuys} external buy(s) >= ${CFG.minPreviousBuyBnb} BNB`
    );
    if (CFG.minPreviousBuys <= 0) {
      await executeWatchedBuy(tokenKey, "no external buy required");
    }
  } catch (error) {
    logError(`failed to handle TokenCreated log, tx ${eventLog.transactionHash || "unknown"}`, error);
  }
}
async function executeWatchedBuy(tokenKey, reason) {
  const watched = watchedTokens.get(tokenKey);
  if (!watched || purchasedTokens.has(tokenKey)) return;

  watchedTokens.delete(tokenKey);
  purchasedTokens.add(tokenKey);
  watched.candidate.previousBuys = watched.qualifiedBuys;
  log("Buy trigger", `${watched.candidate.symbol} ${reason}`);
  await buyToken(watched.candidate);
}

async function handleTokenBoughtLog(eventLog) {
  try {
    const parsed = portalIface.parseLog(eventLog);
    const [, token, buyer, , eth] = parsed.args;
    const tokenKey = token.toLowerCase();
    const watched = watchedTokens.get(tokenKey);
    if (!watched || purchasedTokens.has(tokenKey)) return;

    if (Date.now() - watched.createdAtMs > CFG.tokenWatchSeconds * 1000) {
      watchedTokens.delete(tokenKey);
      log("Watch expired", `${watched.candidate.symbol} no qualifying buy within ${CFG.tokenWatchSeconds}s`);
      return;
    }

    const ownAddress = wallet ? wallet.address.toLowerCase() : "";
    if (ownAddress && buyer.toLowerCase() === ownAddress) return;

    const minBuyWei = ethers.parseEther(CFG.minPreviousBuyBnb);
    if (eth < minBuyWei) {
      log(
        "Buy ignored",
        `${watched.candidate.symbol} external buy ${fmtBnb(eth)} BNB < ${CFG.minPreviousBuyBnb} BNB`
      );
      return;
    }

    watched.qualifiedBuys += 1;
    log(
      "Qualified buy",
      `${watched.candidate.symbol} ${watched.qualifiedBuys}/${CFG.minPreviousBuys} | buyer ${buyer} | ${fmtBnb(eth)} BNB`
    );
    if (watched.qualifiedBuys >= CFG.minPreviousBuys) {
      await executeWatchedBuy(tokenKey, `first qualified buy seen in tx ${eventLog.transactionHash}`);
    }
  } catch (error) {
    logError(`failed to handle TokenBought log, tx ${eventLog.transactionHash || "unknown"}`, error);
  }
}

async function handlePortalLog(eventLog) {
  if (eventLog.topics[0] === tokenCreatedTopic) {
    await handleTokenCreatedLog(eventLog);
  } else if (eventLog.topics[0] === tokenBoughtTopic) {
    await handleTokenBoughtLog(eventLog);
  }
}

function pruneWatchedTokens() {
  const now = Date.now();
  for (const [tokenKey, watched] of watchedTokens) {
    if (now - watched.createdAtMs > CFG.tokenWatchSeconds * 1000) {
      watchedTokens.delete(tokenKey);
      log("Watch expired", `${watched.candidate.symbol} no qualifying buy within ${CFG.tokenWatchSeconds}s`);
    }
  }
}

async function pollTokenCreatedEvents() {
  let lastBlock = await provider.getBlockNumber();
  let scanning = false;
  log("Listener started", `polling Portal logs from block ${lastBlock + 1}; watching TokenCreated + TokenBought`);

  setInterval(async () => {
    if (scanning) return;
    scanning = true;
    try {
      const latest = await provider.getBlockNumber();
      if (latest <= lastBlock) return;

      const fromBlock = lastBlock + 1;
      const toBlock = Math.min(latest, lastBlock + CFG.maxBlockRange);
      log("Scan blocks", `${fromBlock} -> ${toBlock}`);
      const logs = await provider.getLogs({
        address: PORTAL,
        topics: [[tokenCreatedTopic, tokenBoughtTopic]],
        fromBlock,
        toBlock,
      });
      logs.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return (a.index ?? a.logIndex ?? 0) - (b.index ?? b.logIndex ?? 0);
      });

      lastBlock = toBlock;
      if (logs.length === 0) {
        log("Scan result", "no Portal create/buy logs this round");
      } else {
        log("Scan result", `found ${logs.length} Portal create/buy log(s)`);
      }
      for (const eventLog of logs) {
        await handlePortalLog(eventLog);
      }
      pruneWatchedTokens();
    } catch (error) {
      logError("block scan failed", error);
    } finally {
      scanning = false;
    }
  }, CFG.eventPollMs);
}

async function subscribePortalEvents() {
  const latest = await provider.getBlockNumber();
  log(
    "Listener started",
    `real-time ${CFG.wsUrl ? "WebSocket" : "provider"} logs from block ${latest + 1}; watching TokenCreated + TokenBought`
  );

  eventProvider.on(
    {
      address: PORTAL,
      topics: [[tokenCreatedTopic, tokenBoughtTopic]],
    },
    (eventLog) => {
      handlePortalLog(eventLog).catch((error) =>
        logError(`real-time log handler failed, tx ${eventLog.transactionHash || "unknown"}`, error)
      );
    }
  );

  eventProvider.on("error", (error) => {
    logError("real-time provider error", error);
  });
}

async function main() {
  log("Start", `Flap BNB Board monitor, Portal contract ${PORTAL}`);
  log("Mode", CFG.dryRun ? "DRY_RUN=true; monitor only" : `LIVE trading; wallet ${wallet.address}`);
  log("RPC", CFG.rpcUrl);
  log("Events", CFG.wsUrl ? `BSC_WS_URL enabled: ${CFG.wsUrl}` : `HTTP polling every ${CFG.eventPollMs}ms`);
  log("Buy config", `buy ${CFG.buyBnb} BNB, buy slippage ${toBpsText(CFG.buySlippageBps)}, sell slippage ${toBpsText(CFG.sellSlippageBps)}`);
  log(
    "Filters",
    `age <= ${CFG.maxAgeSeconds}s; market cap < $${CFG.maxMarketCapUsd}; pool BNB; buy tax < ${toBpsText(CFG.maxBuyTaxBps)}; sell tax < ${toBpsText(CFG.maxSellTaxBps)}; qualified external buys >= ${CFG.minPreviousBuys}; single external buy >= ${CFG.minPreviousBuyBnb} BNB; watch ${CFG.tokenWatchSeconds}s`
  );
  log("Take profit", `sell half at ${CFG.takeProfitMultiple}x`);
  log("Timed stop loss", CFG.lossSellAfterSeconds > 0 ? `sell all losers after ${CFG.lossSellAfterSeconds}s` : "disabled");

  if (CFG.wsUrl) {
    await subscribePortalEvents();
  } else {
    await pollTokenCreatedEvents();
  }

  setInterval(() => {
    monitorTakeProfit().catch((error) => logError("take profit monitor failed", error));
    monitorTimedStopLoss().catch((error) => logError("timed stop loss monitor failed", error));
  }, CFG.pollMs);
}

main().catch((error) => {
  logError("startup failed", error);
  process.exit(1);
});
