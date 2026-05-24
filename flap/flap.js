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
  gasPriceGwei: process.env.GAS_PRICE_GWEI || "",
  takeProfitMultiple: Number(process.env.TAKE_PROFIT_MULTIPLE || 5),
  lossSellAfterSeconds: Number(process.env.LOSS_SELL_AFTER_SECONDS || 3600),
  closeAfterPositionErrors: Number(process.env.CLOSE_AFTER_POSITION_ERRORS || 3),
  positionLogMs: Number(process.env.POSITION_LOG_MS || 60000),
  pollMs: Number(process.env.PROFIT_POLL_MS || 5000),
  eventPollMs: Number(process.env.EVENT_POLL_MS || 1200),
  maxBlockRange: Number(process.env.MAX_BLOCK_RANGE || 20),
  minPreviousBuys: Number(process.env.MIN_PREVIOUS_BUYS || 1),
  minPreviousBuyBnb: process.env.MIN_PREVIOUS_BUY_BNB || "0.0",
  previousBuyLookaheadBlocks: Number(process.env.PREVIOUS_BUY_LOOKAHEAD_BLOCKS || 3),
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
const timedStopLossErrorLogAt = new Map();
const positionStatusLogAt = new Map();
const buyQuoteCache = new Map();
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

function markPositionClosed(token, reason, extra = {}) {
  const positions = loadPositions();
  const key = token.toLowerCase();
  if (!positions[key]) return;
  positions[key] = {
    ...positions[key],
    ...extra,
    closed: true,
    closedReason: reason,
    closedAt: new Date().toISOString(),
  };
  savePositions(positions);
}

function recordPositionMonitorError(position, reason, error) {
  const token = position.token;
  const key = token.toLowerCase();
  const positions = loadPositions();
  if (!positions[key] || positions[key].closed) return;

  const monitorErrors = Number(positions[key].monitorErrors || 0) + 1;
  positions[key].monitorErrors = monitorErrors;
  positions[key].lastMonitorError = error && error.message ? error.message : String(error);
  positions[key].lastMonitorErrorAt = new Date().toISOString();

  if (CFG.closeAfterPositionErrors > 0 && monitorErrors >= CFG.closeAfterPositionErrors) {
    positions[key].closed = true;
    positions[key].closedReason = `${reason}-errors`;
    positions[key].closedAt = new Date().toISOString();
    savePositions(positions);
    log("仓位关闭", `${position.symbol} ${reason} 连续失败 ${monitorErrors} 次，停止监控`);
    return;
  }

  savePositions(positions);
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

function txOverrides(extra = {}) {
  const overrides = { ...extra };
  if (CFG.gasPriceGwei) {
    overrides.gasPrice = ethers.parseUnits(CFG.gasPriceGwei, "gwei");
  }
  return overrides;
}

function shouldLogPositionStatus(token) {
  if (CFG.positionLogMs <= 0) return true;
  const key = token.toLowerCase();
  const now = Date.now();
  const lastLoggedAt = positionStatusLogAt.get(key) || 0;
  if (now - lastLoggedAt < CFG.positionLogMs) return false;
  positionStatusLogAt.set(key, now);
  return true;
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
  if (probeIn === ethers.parseEther(CFG.buyBnb)) {
    buyQuoteCache.set(token.toLowerCase(), {
      inputAmount: probeIn,
      expectedOut: out,
      cachedAt: Date.now(),
    });
  }

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
  log("过滤", `${symbol}(${name}) 创建 ${age}s，要求 <= ${CFG.maxAgeSeconds}s`);
  if (age > CFG.maxAgeSeconds) {
    return { ok: false, reason: `created ${age}s ago, over ${CFG.maxAgeSeconds}s` };
  }

  const [txQuoteToken, tax, marketCapUsd] = await Promise.all([
    quoteTokenFromCreationTx(event.log.transactionHash, token),
    getTaxInfo(token),
    estimateMarketCapUsd(token),
  ]);

  log("过滤", `创建交易报价资产 ${txQuoteToken === ZERO ? "BNB" : txQuoteToken}`);
  log(
    "Filter",
    `buy tax ${toBpsText(tax.buyTaxBps)} / sell tax ${toBpsText(tax.sellTaxBps)} / pool ${tax.quoteToken === ZERO ? "BNB" : tax.quoteToken}`
  );
  log("过滤", `预估市值 ${marketCapUsd.toFixed(2)}，要求 < ${CFG.maxMarketCapUsd}`);

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
  const cachedQuote = buyQuoteCache.get(candidate.token.toLowerCase());
  const expectedOut =
    cachedQuote && cachedQuote.inputAmount === inputAmount && Date.now() - cachedQuote.cachedAt <= 10_000
      ? cachedQuote.expectedOut
      : await quoteBuy(candidate.token, inputAmount);
  const minimumOut = minOut(expectedOut, CFG.buySlippageBps);

  log(
    "Matched",
    `${candidate.symbol} contract ${green(candidate.token)} | market cap ${candidate.marketCapUsd.toFixed(2)} | buy tax ${toBpsText(candidate.buyTaxBps)} | sell tax ${toBpsText(candidate.sellTaxBps)}`
  );
  log("买入检查", `合格外部买入次数：${candidate.previousBuys}`);
  log(
    "Buy quote",
    `spend ${CFG.buyBnb} BNB, expected token units ${expectedOut.toString()}, minimum out ${minimumOut.toString()}`
  );

  if (CFG.dryRun) {
    log("模拟买入", `DRY_RUN=true；本应买入 ${CFG.buyBnb} BNB 的 ${candidate.symbol}`);
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
    txOverrides({ value: inputAmount })
  );

  log("买入已发送", tx.hash);
  const receipt = await tx.wait();
  log("买入已确认", `区块 ${receipt.blockNumber}`);

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
  log("卖出已确认", `${position.symbol} 已卖出一半`);
}
async function sellTokenAmount(position, amount, reason) {
  if (CFG.dryRun) {
    log("模拟卖出", `DRY_RUN=true；${position.symbol} ${reason}，本应卖出 ${amount.toString()} token units`);
    return;
  }
  if (!wallet) throw new Error("DRY_RUN=false requires PRIVATE_KEY in .env");

  const token = position.token;
  const tokenContract = new ethers.Contract(token, erc20Abi, wallet);
  const allowance = await tokenContract.allowance(wallet.address, PORTAL);
  if (allowance < amount) {
    const approveTx = await tokenContract.approve(PORTAL, ethers.MaxUint256);
    log("授权已发送", `${position.symbol} ${approveTx.hash}`);
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
  log("卖出已发送", `${position.symbol} ${reason} ${tx.hash}`);
  await tx.wait();
}
async function monitorTakeProfit() {
  if (!wallet) return;
  const positions = loadPositions();

  for (const position of Object.values(positions)) {
    if (position.closed || position.soldHalf) continue;
    try {
      const tokenContract = new ethers.Contract(position.token, erc20Abi, provider);
      const balance = await tokenContract.balanceOf(wallet.address);
      if (balance === 0n) {
        markPositionClosed(position.token, "zero-balance");
        log("仓位关闭", `${position.symbol} 钱包余额为 0，停止监控`);
        continue;
      }

      const nowValue = await quoteSell(position.token, balance);
      const spent = BigInt(position.spentWei);
      const multiple = Number(ethers.formatEther(nowValue)) / Number(ethers.formatEther(spent));
      if (shouldLogPositionStatus(position.token)) {
        log("止盈监控", `${position.symbol} 当前 ${fmtBnb(nowValue)} BNB，成本 ${fmtBnb(spent)} BNB，倍数 ${multiple.toFixed(2)}x`);
      }

      if (nowValue >= spent * BigInt(CFG.takeProfitMultiple)) {
        await sellHalf(position);
      }
    } catch (error) {
      recordPositionMonitorError(position, "take-profit-monitor", error);
    }
  }
}
async function monitorTimedStopLoss() {
  if (!wallet || CFG.lossSellAfterSeconds <= 0) return;
  const positions = loadPositions();
  const now = Date.now();

  for (const position of Object.values(positions)) {
    try {
      await checkTimedStopLossPosition(position, now);
    } catch (error) {
      const tokenKey = String(position.token || position.symbol || "unknown").toLowerCase();
      const lastLoggedAt = timedStopLossErrorLogAt.get(tokenKey) || 0;
      if (now - lastLoggedAt >= 60_000) {
        timedStopLossErrorLogAt.set(tokenKey, now);
        logError(`定时止损跳过 ${position.symbol || tokenKey}`, error);
      }
      recordPositionMonitorError(position, "timed-stop-loss-monitor", error);
    }
  }
}
async function checkTimedStopLossPosition(position, now) {
  if (position.closed || position.soldAllLoss || !position.boughtAt) return;
  const boughtAtMs = Date.parse(position.boughtAt);
  if (!Number.isFinite(boughtAtMs) || now - boughtAtMs < CFG.lossSellAfterSeconds * 1000) return;

  const tokenContract = new ethers.Contract(position.token, erc20Abi, provider);
  const balance = await tokenContract.balanceOf(wallet.address);
  if (balance === 0n) {
    markPositionClosed(position.token, "zero-balance");
    log("仓位关闭", `${position.symbol} 钱包余额为 0，停止监控`);
    return;
  }

  const nowValue = await quoteSell(position.token, balance);
  const spent = BigInt(position.spentWei);
  const multiple = Number(ethers.formatEther(nowValue)) / Number(ethers.formatEther(spent));
  log(
    "Timed loss check",
    `${position.symbol} held ${Math.floor((now - boughtAtMs) / 1000)}s, current ${fmtBnb(nowValue)} BNB, cost ${fmtBnb(spent)} BNB, multiple ${multiple.toFixed(2)}x`
  );

  if (nowValue < spent) {
    log("定时止损卖出", `${position.symbol} 持仓超过 ${CFG.lossSellAfterSeconds}s 后仍低于成本，卖出全部`);
    await sellTokenAmount(position, balance, "timed-stop-loss-all");
    const latestPositions = loadPositions();
    latestPositions[position.token.toLowerCase()].soldAllLoss = true;
    latestPositions[position.token.toLowerCase()].soldAllLossAt = new Date().toISOString();
    latestPositions[position.token.toLowerCase()].lossSellValueWei = nowValue.toString();
    latestPositions[position.token.toLowerCase()].closed = true;
    latestPositions[position.token.toLowerCase()].closedReason = "timed-stop-loss-all";
    latestPositions[position.token.toLowerCase()].closedAt = new Date().toISOString();
    savePositions(latestPositions);
    log("卖出已确认", `${position.symbol} 已按定时止损卖出全部`);
  }
}
async function handleTokenCreatedLog(eventLog) {
  try {
    const parsed = portalIface.parseLog(eventLog);
    const [ts, creator, nonce, token, name, symbol, meta] = parsed.args;
    const event = { args: { ts, creator, nonce, token, name, symbol, meta }, log: eventLog };

    const tokenKey = token.toLowerCase();
    if (purchasedTokens.has(tokenKey) || watchedTokens.has(tokenKey)) return;

    log("新代币", `${symbol}(${name}) 合约 ${yellow(token)}`);
    log("创建信息", `创建者 ${creator} | tx ${eventLog.transactionHash} | 区块 ${eventLog.blockNumber}`);
    const candidate = await passesFilters(event);
    if (!candidate.ok) {
      log("已拒绝", `${symbol} 合约 ${red(token)} | 原因：${candidate.reason}`);
      return;
    }
    watchedTokens.set(tokenKey, {
      candidate,
      createdAtMs: Date.now(),
      qualifiedBuys: 0,
      creator: creator.toLowerCase(),
    });
    log(
      "等待跟买",
      `${symbol} 合约 ${green(token)} 已通过过滤；等待 ${CFG.minPreviousBuys} 笔外部买入，单笔 >= ${CFG.minPreviousBuyBnb} BNB 后跟买`
    );
    if (CFG.minPreviousBuys <= 0) {
      await executeWatchedBuy(tokenKey, "无需外部买入确认");
    } else {
      await backfillRecentBuys(tokenKey, eventLog.blockNumber);
    }
  } catch (error) {
    logError(`处理 TokenCreated 日志失败，tx ${eventLog.transactionHash || "unknown"}`, error);
  }
}
async function executeWatchedBuy(tokenKey, reason) {
  const watched = watchedTokens.get(tokenKey);
  if (!watched || purchasedTokens.has(tokenKey)) return;

  watchedTokens.delete(tokenKey);
  purchasedTokens.add(tokenKey);
  watched.candidate.previousBuys = watched.qualifiedBuys;
  log("买入触发", `${watched.candidate.symbol} ${reason}`);
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
      log("监控过期", `${watched.candidate.symbol} 在 ${CFG.tokenWatchSeconds}s 内没有合格买入`);
      return;
    }

    const ownAddress = wallet ? wallet.address.toLowerCase() : "";
    if (ownAddress && buyer.toLowerCase() === ownAddress) return;
    if (watched.creator && buyer.toLowerCase() !== watched.creator) {
      log("买入忽略", `${watched.candidate.symbol} 买家 ${buyer} 不是该币 dev ${watched.creator}`);
      return;
    }

    const minBuyWei = ethers.parseEther(CFG.minPreviousBuyBnb);
    if (eth < minBuyWei) {
      log(
        "买入忽略",
        `${watched.candidate.symbol} 外部买入 ${fmtBnb(eth)} BNB < ${CFG.minPreviousBuyBnb} BNB`
      );
      return;
    }

    watched.qualifiedBuys += 1;
    log(
      "合格买入",
      `${watched.candidate.symbol} ${watched.qualifiedBuys}/${CFG.minPreviousBuys} | 买家 ${buyer} | ${fmtBnb(eth)} BNB`
    );
    if (watched.qualifiedBuys >= CFG.minPreviousBuys) {
      await executeWatchedBuy(tokenKey, `看到合格买入 tx ${eventLog.transactionHash}`);
    }
  } catch (error) {
    logError(`处理 TokenBought 日志失败，tx ${eventLog.transactionHash || "unknown"}`, error);
  }
}

async function backfillRecentBuys(tokenKey, createdBlock) {
  if (CFG.previousBuyLookaheadBlocks <= 0) return;
  const watched = watchedTokens.get(tokenKey);
  if (!watched || purchasedTokens.has(tokenKey)) return;

  try {
    const latest = await provider.getBlockNumber();
    const fromBlock = createdBlock;
    const toBlock = Math.min(latest, createdBlock + CFG.previousBuyLookaheadBlocks);
    if (toBlock < fromBlock) return;

    const logs = await provider.getLogs({
      address: PORTAL,
      topics: [tokenBoughtTopic],
      fromBlock,
      toBlock,
    });
    logs.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return (a.index ?? a.logIndex ?? 0) - (b.index ?? b.logIndex ?? 0);
    });
    log("回查买入", `${watched.candidate.symbol} 区块 ${fromBlock} -> ${toBlock}，发现 ${logs.length} 条买入日志`);
    for (const eventLog of logs) {
      await handleTokenBoughtLog(eventLog);
      if (purchasedTokens.has(tokenKey)) return;
    }
  } catch (error) {
    logError(`${watched.candidate.symbol} 回查买入失败`, error);
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
      log("监控过期", `${watched.candidate.symbol} 在 ${CFG.tokenWatchSeconds}s 内没有合格买入`);
    }
  }
}

async function pollTokenCreatedEvents() {
  let lastBlock = await provider.getBlockNumber();
  let scanning = false;
  log("监听已启动", `从区块 ${lastBlock + 1} 轮询 Portal 日志；监控 TokenCreated + TokenBought`);

  setInterval(async () => {
    if (scanning) return;
    scanning = true;
    try {
      const latest = await provider.getBlockNumber();
      if (latest <= lastBlock) return;

      const fromBlock = lastBlock + 1;
      const toBlock = Math.min(latest, lastBlock + CFG.maxBlockRange);
      log("扫描区块", `${fromBlock} -> ${toBlock}`);
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
        log("扫描结果", "本轮没有 Portal 创建/买入日志");
      } else {
        log("扫描结果", `发现 ${logs.length} 条 Portal 创建/买入日志`);
      }
      for (const eventLog of logs) {
        await handlePortalLog(eventLog);
      }
      pruneWatchedTokens();
    } catch (error) {
      logError("区块扫描失败", error);
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
        logError(`实时日志处理失败，tx ${eventLog.transactionHash || "unknown"}`, error)
      );
    }
  );

  eventProvider.on("error", (error) => {
    logError("实时 provider 错误", error);
  });
}

async function main() {
  log("启动", `Flap BNB Board 监控器，Portal 合约 ${PORTAL}`);
  log("模式", CFG.dryRun ? "DRY_RUN=true；仅监控不交易" : `实盘交易；钱包 ${wallet.address}`);
  log("RPC", CFG.rpcUrl);
  log("事件监听", CFG.wsUrl ? `已启用 BSC_WS_URL：${CFG.wsUrl}` : `HTTP 每 ${CFG.eventPollMs}ms 轮询`);
  log("买入配置", `买入 ${CFG.buyBnb} BNB，买入滑点 ${toBpsText(CFG.buySlippageBps)}，卖出滑点 ${toBpsText(CFG.sellSlippageBps)}`);
  log(
    "Filters",
    `age <= ${CFG.maxAgeSeconds}s; market cap < $${CFG.maxMarketCapUsd}; pool BNB; buy tax < ${toBpsText(CFG.maxBuyTaxBps)}; sell tax < ${toBpsText(CFG.maxSellTaxBps)}; qualified external buys >= ${CFG.minPreviousBuys}; single external buy >= ${CFG.minPreviousBuyBnb} BNB; watch ${CFG.tokenWatchSeconds}s`
  );
  log("止盈", `达到 ${CFG.takeProfitMultiple}x 卖出一半`);
  log("定时止损", CFG.lossSellAfterSeconds > 0 ? `${CFG.lossSellAfterSeconds}s 后仍亏损则卖出全部` : "已关闭");
  log("仓位清理", CFG.closeAfterPositionErrors > 0 ? `连续 ${CFG.closeAfterPositionErrors} 次监控错误后关闭仓位` : "已关闭");
  log("仓位日志", CFG.positionLogMs > 0 ? `每 ${CFG.positionLogMs}ms 打印一次未触发仓位状态` : "每次检查都打印");

  if (CFG.wsUrl) {
    await subscribePortalEvents();
  } else {
    await pollTokenCreatedEvents();
  }

  setInterval(() => {
    monitorTakeProfit().catch((error) => logError("止盈监控失败", error));
    monitorTimedStopLoss().catch((error) => logError("定时止损监控失败", error));
  }, CFG.pollMs);
}

main().catch((error) => {
  logError("启动失败", error);
  process.exit(1);
});
