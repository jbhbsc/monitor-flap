require("dotenv").config({ path: require("node:path").join(__dirname, ".env") });
require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const ZERO = "0x0000000000000000000000000000000000000000";
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const DEFAULT_HELPER3 = "0xF251F83e40a78868FcfA3FA4599Dad6494E46034";
const DEFAULT_TOKEN_MANAGER = "0x5c952063c7fc8610FFDB798152D69F0B9550762b";
const POSITIONS_FILE = path.join(__dirname, "four-positions.json");
const SEEN_TWEETS_FILE = path.join(__dirname, "seen-tweets.json");

const CFG = {
  rpcUrl: process.env.BSC_RPC_URL || "https://bsc.publicnode.com",
  privateKey: process.env.PRIVATE_KEY || "",
  dryRun: (process.env.DRY_RUN || "true").toLowerCase() !== "false",
  buyBnb: process.env.BUY_BNB || "0.01",
  bnbUsd: Number(process.env.BNB_USD || 650),
  maxAgeSeconds: Number(process.env.MAX_TOKEN_AGE_SECONDS || 3),
  maxMarketCapUsd: Number(process.env.MAX_MARKET_CAP_USD || 10000),
  buySlippageBps: Number(process.env.BUY_SLIPPAGE_BPS || 1200),
  sellSlippageBps: Number(process.env.SELL_SLIPPAGE_BPS || 1200),
  takeProfitMultiple: Number(process.env.TAKE_PROFIT_MULTIPLE || 5),
  minPreviousBuys: Number(process.env.MIN_PREVIOUS_BUYS || 1),
  minPreviousBuyBnb: process.env.MIN_PREVIOUS_BUY_BNB || "0.0",
  tokenWatchSeconds: Number(process.env.TOKEN_WATCH_SECONDS || 15),
  tweetSignalSeconds: Number(process.env.TWEET_SIGNAL_SECONDS || 300),
  twitterPollMs: Number(process.env.TWITTER_POLL_MS || 1500),
  fourPollMs: Number(process.env.FOUR_POLL_MS || 1200),
  eventPollMs: Number(process.env.EVENT_POLL_MS || 1200),
  profitPollMs: Number(process.env.PROFIT_POLL_MS || 5000),
  maxBlockRange: Number(process.env.MAX_BLOCK_RANGE || 20),
  targetHandles: (process.env.TARGET_TWITTER_HANDLES || "cz_binance,heyibinance")
    .split(",")
    .map((x) => normalizeHandle(x))
    .filter(Boolean),
  gmgnApiUrl: process.env.GMGN_X_API_URL || "",
  gmgnCookie: process.env.GMGN_COOKIE || "",
  twitterBearerToken: process.env.TWITTER_BEARER_TOKEN || "",
  tweetFile: process.env.TWEET_FILE || path.join(__dirname, "tweets.jsonl"),
  fourApiBase: process.env.FOUR_API_BASE || "https://four.meme/meme-api/v1",
  fourListUrls: (process.env.FOUR_LIST_URLS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  tokenManagers: (process.env.FOUR_TOKEN_MANAGERS || DEFAULT_TOKEN_MANAGER)
    .split(",")
    .map((x) => x.trim())
    .filter((x) => ethers.isAddress(x)),
  helper3: process.env.FOUR_HELPER3 || DEFAULT_HELPER3,
  quoteWhitelist: (process.env.BNB_QUOTE_ADDRESSES || `${ZERO},${WBNB}`)
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
};

const helperAbi = [
  "function getTokenInfo(address token) view returns (uint256 version,address tokenManager,address quote,uint256 lastPrice,uint256 tradingFeeRate,uint256 minTradingFee,uint256 launchTime,uint256 offers,uint256 maxOffers,uint256 funds,uint256 maxFunds,bool liquidityAdded)",
  "function tryBuy(address token,uint256 amount,uint256 funds) view returns (address tokenManager,address quote,uint256 estimatedAmount,uint256 estimatedCost,uint256 estimatedFee,uint256 amountMsgValue,uint256 amountApproval,uint256 amountFunds)",
  "function trySell(address token,uint256 amount) view returns (address tokenManager,address quote,uint256 funds,uint256 fee)",
];

const managerAbi = [
  "event TokenPurchase(address token,address account,uint256 price,uint256 amount,uint256 cost,uint256 fee,uint256 offers,uint256 funds)",
  "function buyTokenAMAP(uint256 origin,address token,uint256 funds,uint256 minAmount) payable",
  "function sellToken(address token,uint256 amount,uint256 minFunds)",
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
const wallet = CFG.privateKey ? new ethers.Wallet(CFG.privateKey, provider) : null;
const helper = new ethers.Contract(CFG.helper3, helperAbi, provider);
const managerIface = new ethers.Interface(managerAbi);
const tokenPurchaseTopic = managerIface.getEvent("TokenPurchase").topicHash;
const watchedTokens = new Map();
const purchasedTokens = new Set();
const activeTweets = new Map();
const mutedEndpointErrors = new Set();
const checkedTokenCandidates = new Set();
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
};

function log(title, message = "") {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  console.log(`[${time}] ${title}${message ? ` ${message}` : ""}`);
}

function logError(title, error) {
  log(title, error && error.message ? error.message : String(error));
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

function normalizeHandle(handle) {
  return String(handle || "").trim().replace(/^@/, "").toLowerCase();
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, bigintReplacer, 2));
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

function extractStatusId(value) {
  const text = String(value || "");
  const match = text.match(/(?:status|statuses)\/(\d+)/i) || text.match(/\b(\d{12,})\b/);
  return match ? match[1] : "";
}

function normalizeTweetUrl(handle, id) {
  return id ? `https://x.com/${normalizeHandle(handle)}/status/${id}` : "";
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchJsonQuiet(url, options = {}) {
  try {
    return await fetchJson(url, options);
  } catch (error) {
    const key = `${url} ${error.message}`;
    if (!mutedEndpointErrors.has(key)) {
      mutedEndpointErrors.add(key);
      logError("Endpoint disabled", error);
    }
    return null;
  }
}

function walkObjects(value, visitor) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visitor);
    return;
  }
  visitor(value);
  for (const child of Object.values(value)) walkObjects(child, visitor);
}

function firstString(obj, keys) {
  for (const key of keys) {
    const value = obj && obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(obj, keys) {
  for (const key of keys) {
    const value = obj && obj[key];
    if (value !== undefined && value !== null && value !== "") return Number(value);
  }
  return 0;
}

function parseTweetObjects(payload) {
  const tweets = [];
  walkObjects(payload, (obj) => {
    const handle = normalizeHandle(
      firstString(obj, ["screen_name", "screenName", "username", "userName", "twitterUsername", "author"])
        || firstString(obj.user || obj.author || {}, ["screen_name", "screenName", "username", "userName"])
    );
    if (!CFG.targetHandles.includes(handle)) return;

    const url = firstString(obj, ["url", "tweet_url", "tweetUrl", "link", "statusUrl"]);
    const id = firstString(obj, ["id", "tweet_id", "tweetId", "status_id", "statusId"]) || extractStatusId(url);
    if (!id && !url) return;
    tweets.push({
      handle,
      id: String(id || extractStatusId(url)),
      url: url || normalizeTweetUrl(handle, id),
      text: firstString(obj, ["text", "content", "full_text", "fullText"]),
      createdAt: firstString(obj, ["created_at", "createdAt", "time", "timestamp"]),
    });
  });
  return tweets;
}

async function pollGmgnTweets() {
  if (!CFG.gmgnApiUrl) return [];
  const payload = await fetchJson(CFG.gmgnApiUrl, {
    headers: CFG.gmgnCookie ? { cookie: CFG.gmgnCookie } : {},
  });
  return parseTweetObjects(payload);
}

async function pollOfficialXTweets() {
  if (!CFG.twitterBearerToken) return [];
  const tweets = [];
  for (const handle of CFG.targetHandles) {
    const user = await fetchJson(`https://api.twitter.com/2/users/by/username/${handle}`, {
      headers: { authorization: `Bearer ${CFG.twitterBearerToken}` },
    });
    const id = user && user.data && user.data.id;
    if (!id) continue;
    const timeline = await fetchJson(
      `https://api.twitter.com/2/users/${id}/tweets?max_results=5&exclude=retweets,replies&tweet.fields=created_at`,
      { headers: { authorization: `Bearer ${CFG.twitterBearerToken}` } }
    );
    for (const item of timeline.data || []) {
      tweets.push({
        handle,
        id: item.id,
        url: normalizeTweetUrl(handle, item.id),
        text: item.text || "",
        createdAt: item.created_at || "",
      });
    }
  }
  return tweets;
}

function pollTweetFile() {
  if (!fs.existsSync(CFG.tweetFile)) return [];
  const lines = fs.readFileSync(CFG.tweetFile, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.flatMap((line) => {
    try {
      return parseTweetObjects(JSON.parse(line));
    } catch {
      return [];
    }
  });
}

async function pollTweets() {
  const seen = new Set(loadJson(SEEN_TWEETS_FILE, []));
  const sources = [pollTweetFile()];
  try {
    sources.push(await pollGmgnTweets());
  } catch (error) {
    logError("GMGN poll failed", error);
  }
  try {
    sources.push(await pollOfficialXTweets());
  } catch (error) {
    logError("X API poll failed", error);
  }

  for (const tweet of sources.flat()) {
    const id = tweet.id || extractStatusId(tweet.url);
    if (!tweet.handle || !id) continue;
    const key = `${tweet.handle}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    activeTweets.set(key, { ...tweet, id, seenAtMs: Date.now() });
    log("Tweet signal", `@${tweet.handle} ${tweet.url || id}`);
  }
  saveJson(SEEN_TWEETS_FILE, [...seen].slice(-500));
}

function pruneTweetSignals() {
  const now = Date.now();
  for (const [key, tweet] of activeTweets) {
    if (now - tweet.seenAtMs > CFG.tweetSignalSeconds * 1000) {
      activeTweets.delete(key);
    }
  }
}

async function fetchFourNewestTokens() {
  const out = [];

  const listUrls = CFG.fourListUrls.length
    ? CFG.fourListUrls
    : [
        `${CFG.fourApiBase}/public/token/search`,
        `${CFG.fourApiBase}/private/token/list?pageIndex=1&pageSize=40`,
        `${CFG.fourApiBase}/private/token/query?orderBy=TimeDesc&tokenName=&listedPancake=false&pageIndex=1&pageSize=40`,
      ];

  for (const url of listUrls) {
    const isSearch = url.includes("/public/token/search");
    const payload = await fetchJsonQuiet(
      url,
      isSearch
        ? {
            method: "POST",
            body: JSON.stringify({
              pageIndex: 1,
              pageSize: 40,
              status: "PUBLISH",
              sort: "DESC",
            }),
          }
        : {}
    );
    if (payload) out.push(payload);
  }

  const tokens = new Map();
  for (const payload of out) {
    walkObjects(payload, (obj) => {
      const address = firstString(obj, ["address", "tokenAddress", "contractAddress", "token", "ca"]);
      if (!ethers.isAddress(address)) return;
      const lower = address.toLowerCase();
      if (!tokens.has(lower)) tokens.set(lower, obj);
    });
  }
  return [...tokens.values()];
}

function tokenAddressOf(obj) {
  return firstString(obj, ["address", "tokenAddress", "contractAddress", "token", "ca"]);
}

function tokenSocialText(obj) {
  const pieces = [];
  walkObjects(obj, (child) => {
    for (const [key, value] of Object.entries(child)) {
      if (typeof value !== "string") continue;
      const lowerKey = key.toLowerCase();
      const lowerValue = value.toLowerCase();
      if (lowerKey.includes("twitter") || lowerKey.includes("tweet") || lowerValue.includes("x.com/") || lowerValue.includes("twitter.com/")) {
        pieces.push(value);
      }
    }
  });
  return pieces.join(" ");
}

function matchActiveTweet(tokenObj) {
  const social = tokenSocialText(tokenObj).toLowerCase();
  if (!social) return null;
  for (const tweet of activeTweets.values()) {
    const handle = normalizeHandle(tweet.handle);
    const id = tweet.id || extractStatusId(tweet.url);
    if (id && social.includes(id)) return tweet;
    if (handle && social.includes(handle) && tweet.url && social.includes(tweet.url.toLowerCase())) return tweet;
  }
  return null;
}

function extractAddressesFromLog(eventLog) {
  const addresses = new Set();
  for (const topic of eventLog.topics || []) {
    if (typeof topic === "string" && topic.length === 66) {
      const address = `0x${topic.slice(-40)}`;
      if (ethers.isAddress(address) && address.toLowerCase() !== ZERO) addresses.add(ethers.getAddress(address));
    }
  }

  const data = String(eventLog.data || "").replace(/^0x/, "");
  for (let i = 0; i + 64 <= data.length; i += 64) {
    const word = data.slice(i, i + 64);
    const address = `0x${word.slice(-40)}`;
    if (ethers.isAddress(address) && address.toLowerCase() !== ZERO) addresses.add(ethers.getAddress(address));
  }
  return [...addresses];
}

function tokenObjectFromAddress(token, detail = {}) {
  return {
    address: token,
    tokenAddress: token,
    ...detail,
  };
}

async function getTokenDetail(token) {
  const urls = [
    `${CFG.fourApiBase}/private/token/get/v2?address=${token}`,
    `${CFG.fourApiBase}/private/token/get?address=${token}`,
  ];
  for (const url of urls) {
    try {
      return await fetchJson(url);
    } catch {
      // Try the next known endpoint.
    }
  }
  return {};
}

async function getTokenInfo(token) {
  const info = await helper.getTokenInfo(token);
  return {
    version: Number(info.version),
    tokenManager: info.tokenManager,
    quote: info.quote,
    lastPrice: BigInt(info.lastPrice),
    launchTime: Number(info.launchTime),
    offers: BigInt(info.offers),
    funds: BigInt(info.funds),
    maxFunds: BigInt(info.maxFunds),
    liquidityAdded: Boolean(info.liquidityAdded),
  };
}

async function isFourToken(token) {
  try {
    const info = await getTokenInfo(token);
    const manager = String(info.tokenManager || "").toLowerCase();
    return CFG.tokenManagers.some((x) => x.toLowerCase() === manager) ? info : null;
  } catch {
    return null;
  }
}

async function quoteBuy(token, bnbIn) {
  const quote = await helper.tryBuy(token, 0n, bnbIn);
  return {
    tokenManager: quote.tokenManager,
    quote: quote.quote,
    estimatedAmount: BigInt(quote.estimatedAmount),
    estimatedCost: BigInt(quote.estimatedCost),
    estimatedFee: BigInt(quote.estimatedFee),
    amountMsgValue: BigInt(quote.amountMsgValue),
    amountFunds: BigInt(quote.amountFunds),
  };
}

async function quoteSell(token, tokenAmount) {
  const quote = await helper.trySell(token, tokenAmount);
  return {
    tokenManager: quote.tokenManager,
    quote: quote.quote,
    funds: BigInt(quote.funds),
    fee: BigInt(quote.fee),
  };
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
  const probeIn = ethers.parseEther(process.env.QUOTE_PROBE_BNB || CFG.buyBnb);
  const quote = await quoteBuy(token, probeIn);
  if (quote.estimatedAmount === 0n) return Number.POSITIVE_INFINITY;
  const decimals = await getDecimals(token);
  const tokensOut = Number(ethers.formatUnits(quote.estimatedAmount, decimals));
  const bnbIn = Number(ethers.formatEther(probeIn));
  return (bnbIn / tokensOut) * 1_000_000_000 * CFG.bnbUsd;
}

async function passesFilters(tokenObj, tweet) {
  const token = tokenAddressOf(tokenObj);
  const name = firstString(tokenObj, ["name", "tokenName"]) || token;
  const symbol = firstString(tokenObj, ["symbol", "shortName", "ticker"]) || "?";
  const info = await getTokenInfo(token);
  const launchTime =
    info.launchTime ||
    Math.floor(firstNumber(tokenObj, ["launchTime", "createTime", "createdAt", "timestamp"]) / 1000);
  const age = launchTime ? Math.floor(Date.now() / 1000) - launchTime : Number.POSITIVE_INFINITY;

  log("Filter", `${symbol}(${name}) age ${age}s, need <= ${CFG.maxAgeSeconds}s`);
  if (age > CFG.maxAgeSeconds) {
    return { ok: false, reason: `created ${age}s ago, over ${CFG.maxAgeSeconds}s` };
  }
  if (info.version !== 2) {
    return { ok: false, reason: `unsupported TokenManager version ${info.version}` };
  }
  if (info.liquidityAdded) {
    return { ok: false, reason: "already migrated/liquidity added" };
  }
  if (!CFG.quoteWhitelist.includes(String(info.quote).toLowerCase())) {
    return { ok: false, reason: `quote is not BNB: ${info.quote}` };
  }

  const marketCapUsd = await estimateMarketCapUsd(token);
  log("Filter", `estimated market cap ${marketCapUsd.toFixed(2)}, need < ${CFG.maxMarketCapUsd}`);
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
    buyTaxBps: 0,
    sellTaxBps: 0,
    tokenManager: info.tokenManager,
    tweet,
    previousBuys: 0,
  };
}

async function buyToken(candidate) {
  const inputAmount = ethers.parseEther(CFG.buyBnb);
  const quote = await quoteBuy(candidate.token, inputAmount);
  const minimumOut = minOut(quote.estimatedAmount, CFG.buySlippageBps);
  const tokenManager = quote.tokenManager || candidate.tokenManager;

  log(
    "Matched",
    `${candidate.symbol} contract ${green(candidate.token)} | buy contract ${green(tokenManager)} | tweet @${candidate.tweet.handle}/${candidate.tweet.id} | market cap ${candidate.marketCapUsd.toFixed(2)}`
  );
  log("Buy check", `qualified external buys: ${candidate.previousBuys}`);
  log("Buy quote", `spend ${CFG.buyBnb} BNB, expected ${quote.estimatedAmount.toString()}, minimum ${minimumOut.toString()}`);

  if (CFG.dryRun) {
    log("Dry run buy", `DRY_RUN=true; would buy ${CFG.buyBnb} BNB of ${candidate.symbol}`);
    return;
  }
  if (!wallet) throw new Error("DRY_RUN=false requires PRIVATE_KEY in .env");

  const manager = new ethers.Contract(tokenManager, managerAbi, wallet);
  const tx = await manager["buyTokenAMAP(uint256,address,uint256,uint256)"](0n, candidate.token, inputAmount, minimumOut, {
    value: inputAmount,
  });
  log("Buy sent", tx.hash);
  const receipt = await tx.wait();
  log("Buy confirmed", `block ${receipt.blockNumber}`);

  const tokenContract = new ethers.Contract(candidate.token, erc20Abi, provider);
  const balance = await tokenContract.balanceOf(wallet.address);
  const positions = loadJson(POSITIONS_FILE, {});
  positions[candidate.token.toLowerCase()] = {
    token: candidate.token,
    symbol: candidate.symbol,
    name: candidate.name,
    tokenManager,
    tweetUrl: candidate.tweet.url,
    spentWei: inputAmount.toString(),
    balanceAtBuy: balance.toString(),
    boughtAt: new Date().toISOString(),
    soldHalf: false,
  };
  saveJson(POSITIONS_FILE, positions);
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

async function handleTokenPurchaseLog(eventLog) {
  try {
    const parsed = managerIface.parseLog(eventLog);
    const [token, buyer, , , cost] = parsed.args;
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
    if (cost < minBuyWei) {
      log("Buy ignored", `${watched.candidate.symbol} external buy ${fmtBnb(cost)} BNB < ${CFG.minPreviousBuyBnb} BNB`);
      return;
    }

    watched.qualifiedBuys += 1;
    log("Qualified buy", `${watched.candidate.symbol} ${watched.qualifiedBuys}/${CFG.minPreviousBuys} | buyer ${buyer} | ${fmtBnb(cost)} BNB`);
    if (watched.qualifiedBuys >= CFG.minPreviousBuys) {
      await executeWatchedBuy(tokenKey, `qualified buy seen in tx ${eventLog.transactionHash}`);
    }
  } catch (error) {
    logError(`failed to handle TokenPurchase log, tx ${eventLog.transactionHash || "unknown"}`, error);
  }
}

async function handlePotentialToken(token, eventLog) {
  if (!ethers.isAddress(token)) return;
  const tokenKey = token.toLowerCase();
  if (checkedTokenCandidates.has(tokenKey) || purchasedTokens.has(tokenKey) || watchedTokens.has(tokenKey)) return;
  checkedTokenCandidates.add(tokenKey);

  const info = await isFourToken(token);
  if (!info) return;

  const detail = await getTokenDetail(token);
  const tokenObj = tokenObjectFromAddress(token, detail);
  const tweet = matchActiveTweet(tokenObj);
  if (!tweet) {
    log("Four token", `${yellow(token)} verified on-chain, waiting for matching tweet reference from API/detail`);
    return;
  }

  const symbol = firstString(tokenObj, ["symbol", "shortName", "ticker"]) || "?";
  log("Four match", `${symbol} contract ${green(token)} references @${tweet.handle}/${tweet.id}`);
  const candidate = await passesFilters(tokenObj, tweet);
  if (!candidate.ok) {
    log("Rejected", `${symbol} contract ${red(token)} | reason: ${candidate.reason}`);
    return;
  }

  watchedTokens.set(tokenKey, { candidate, createdAtMs: Date.now(), qualifiedBuys: 0 });
  log("Watching buys", `${symbol} contract ${green(token)} passed filters; buy contract ${green(candidate.tokenManager)}; will buy after ${CFG.minPreviousBuys} external buy(s) >= ${CFG.minPreviousBuyBnb} BNB`);
  if (CFG.minPreviousBuys <= 0) {
    await executeWatchedBuy(tokenKey, "no external buy required");
  }
}

async function handleManagerLog(eventLog) {
  if (eventLog.topics && eventLog.topics[0] === tokenPurchaseTopic) {
    await handleTokenPurchaseLog(eventLog);
  }

  const candidates = extractAddressesFromLog(eventLog);
  for (const address of candidates) {
    await handlePotentialToken(address, eventLog);
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

async function pollFourTokens() {
  const tokens = await fetchFourNewestTokens();
  for (const tokenObj of tokens) {
    const token = tokenAddressOf(tokenObj);
    if (!ethers.isAddress(token)) continue;
    const tokenKey = token.toLowerCase();
    if (purchasedTokens.has(tokenKey) || watchedTokens.has(tokenKey)) continue;

    const tweet = matchActiveTweet(tokenObj);
    if (!tweet) continue;

    const detail = await getTokenDetail(token);
    const merged = { ...tokenObj, detail };
    const detailTweet = matchActiveTweet(merged);
    if (!detailTweet) continue;

    const symbol = firstString(merged, ["symbol", "shortName", "ticker"]) || "?";
    log("Four match", `${symbol} contract ${green(token)} references @${detailTweet.handle}/${detailTweet.id}`);
    const candidate = await passesFilters(merged, detailTweet);
    if (!candidate.ok) {
      log("Rejected", `${symbol} contract ${red(token)} | reason: ${candidate.reason}`);
      continue;
    }

    watchedTokens.set(tokenKey, { candidate, createdAtMs: Date.now(), qualifiedBuys: 0 });
    log("Watching buys", `${symbol} contract ${green(token)} passed filters; buy contract ${green(candidate.tokenManager)}; will buy after ${CFG.minPreviousBuys} external buy(s) >= ${CFG.minPreviousBuyBnb} BNB`);
    if (CFG.minPreviousBuys <= 0) {
      await executeWatchedBuy(tokenKey, "no external buy required");
    }
  }
}

async function pollPurchaseEvents() {
  let lastBlock = await provider.getBlockNumber();
  let scanning = false;
  log("Listener started", `polling Four.meme manager logs from block ${lastBlock + 1}`);

  setInterval(async () => {
    if (scanning) return;
    scanning = true;
    try {
      const latest = await provider.getBlockNumber();
      if (latest <= lastBlock) return;
      const fromBlock = lastBlock + 1;
      const toBlock = Math.min(latest, lastBlock + CFG.maxBlockRange);
      const watchedManagers = [...watchedTokens.values()].map((x) => x.candidate.tokenManager);
      const addresses = [...new Set([...CFG.tokenManagers, ...watchedManagers])];
      const logs = [];
      for (const address of addresses) {
        logs.push(...await provider.getLogs({ address, fromBlock, toBlock }));
      }
      lastBlock = toBlock;
      logs.sort((a, b) => (a.blockNumber - b.blockNumber) || ((a.index ?? a.logIndex ?? 0) - (b.index ?? b.logIndex ?? 0)));
      for (const eventLog of logs) await handleManagerLog(eventLog);
      pruneWatchedTokens();
    } catch (error) {
      logError("manager scan failed", error);
    } finally {
      scanning = false;
    }
  }, CFG.eventPollMs);
}

async function sellHalf(position) {
  if (CFG.dryRun) {
    log("Dry run sell", `DRY_RUN=true; ${position.symbol} hit ${CFG.takeProfitMultiple}x, would sell half`);
    return;
  }
  if (!wallet) throw new Error("DRY_RUN=false requires PRIVATE_KEY in .env");

  const tokenContract = new ethers.Contract(position.token, erc20Abi, wallet);
  const balance = await tokenContract.balanceOf(wallet.address);
  const half = balance / 2n;
  if (half === 0n) return;

  const managerAddress = position.tokenManager || (await getTokenInfo(position.token)).tokenManager;
  const allowance = await tokenContract.allowance(wallet.address, managerAddress);
  if (allowance < half) {
    const approveTx = await tokenContract.approve(managerAddress, ethers.MaxUint256);
    log("Approve sent", `${position.symbol} ${approveTx.hash}`);
    await approveTx.wait();
  }

  const quote = await quoteSell(position.token, half);
  const minimumBnb = minOut(quote.funds, CFG.sellSlippageBps);
  const manager = new ethers.Contract(managerAddress, managerAbi, wallet);
  const tx = await manager.sellToken(position.token, half, minimumBnb);
  log("Sell sent", `${position.symbol} ${tx.hash}`);
  await tx.wait();

  const positions = loadJson(POSITIONS_FILE, {});
  positions[position.token.toLowerCase()].soldHalf = true;
  positions[position.token.toLowerCase()].soldAt = new Date().toISOString();
  saveJson(POSITIONS_FILE, positions);
  log("Sell confirmed", `${position.symbol} sold half`);
}

async function monitorTakeProfit() {
  if (!wallet) return;
  const positions = loadJson(POSITIONS_FILE, {});
  for (const position of Object.values(positions)) {
    if (position.soldHalf) continue;
    const tokenContract = new ethers.Contract(position.token, erc20Abi, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    if (balance === 0n) continue;
    const quote = await quoteSell(position.token, balance);
    const spent = BigInt(position.spentWei);
    const multiple = Number(ethers.formatEther(quote.funds)) / Number(ethers.formatEther(spent));
    log("Take profit monitor", `${position.symbol} current ${fmtBnb(quote.funds)} BNB, cost ${fmtBnb(spent)} BNB, multiple ${multiple.toFixed(2)}x`);
    if (quote.funds >= spent * BigInt(CFG.takeProfitMultiple)) {
      await sellHalf(position);
    }
  }
}

async function main() {
  log("Start", "Four.meme tweet-reference monitor");
  log("Mode", CFG.dryRun ? "DRY_RUN=true; monitor only" : `LIVE trading; wallet ${wallet.address}`);
  log("Targets", CFG.targetHandles.map((x) => `@${x}`).join(", "));
  log("Sources", `GMGN=${CFG.gmgnApiUrl ? "on" : "off"} X_API=${CFG.twitterBearerToken ? "on" : "off"} file=${CFG.tweetFile}`);
  log("Four managers", CFG.tokenManagers.join(", "));
  log("Buy config", `buy ${CFG.buyBnb} BNB, buy slippage ${toBpsText(CFG.buySlippageBps)}, sell slippage ${toBpsText(CFG.sellSlippageBps)}`);
  log("Filters", `age <= ${CFG.maxAgeSeconds}s; market cap < $${CFG.maxMarketCapUsd}; BNB quote; qualified external buys >= ${CFG.minPreviousBuys}; single external buy >= ${CFG.minPreviousBuyBnb} BNB; watch ${CFG.tokenWatchSeconds}s`);

  await pollPurchaseEvents();
  setInterval(() => pollTweets().then(pruneTweetSignals).catch((e) => logError("tweet poll failed", e)), CFG.twitterPollMs);
  if (CFG.fourListUrls.length) {
    setInterval(() => pollFourTokens().catch((e) => logError("four poll failed", e)), CFG.fourPollMs);
  }
  setInterval(() => monitorTakeProfit().catch((e) => logError("take profit monitor failed", e)), CFG.profitPollMs);
}

main().catch((error) => {
  logError("startup failed", error);
  process.exit(1);
});
