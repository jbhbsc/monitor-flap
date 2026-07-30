const cfg = window.FLAP_SCRATCH_CONFIG;

const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
];

const LOTTERY_ABI = [
  "function stakeToken() view returns (address)",
  "function currentRoundId() view returns (uint256)",
  "function roundWindow(uint256) view returns (uint256 start,uint256 end)",
  "function ticketPrice() view returns (uint256)",
  "function maxTicketsPerUser() view returns (uint256)",
  "function userRoundTickets(uint256,address) view returns (uint256)",
  "function userRoundTicketStart(uint256,address) view returns (uint256)",
  "function userRoundTicketEnd(uint256,address) view returns (uint256)",
  "function entriesLength(uint256) view returns (uint256)",
  "function getRoundEntry(uint256,uint256) view returns (tuple(address user,uint256 tickets,uint256 amountPaid,uint256 cumulativeTickets))",
  "function rounds(uint256) view returns (uint256 totalTickets,uint256 totalStaked,bool drawn,address winner,uint256 winningTicket,uint256 rewardAmount,uint256 drawnAt)",
  "function stakeTickets(uint256 tickets)",
  "function drawRound(uint256 roundId)"
];

const POOL_ABI = [
  "function rewardBalance() view returns (uint256)",
  "function pendingChunks() view returns (uint256)"
];

const els = {
  connectBtn: document.querySelector("#connectBtn"),
  currentRound: document.querySelector("#currentRound"),
  countdownRound: document.querySelector("#countdownRound"),
  roundCountdown: document.querySelector("#roundCountdown"),
  rewardBalance: document.querySelector("#rewardBalance"),
  rewardAsset: document.querySelector("#rewardAsset"),
  myTicketCard: document.querySelector("#myTicketCard"),
  myTickets: document.querySelector("#myTickets"),
  ticketInput: document.querySelector("#ticketInput"),
  minusBtn: document.querySelector("#minusBtn"),
  plusBtn: document.querySelector("#plusBtn"),
  stakeQuote: document.querySelector("#stakeQuote"),
  approveBtn: document.querySelector("#approveBtn"),
  stakeBtn: document.querySelector("#stakeBtn"),
  txStatus: document.querySelector("#txStatus"),
  pendingChunks: document.querySelector("#pendingChunks"),
  pairAddress: document.querySelector("#pairAddress"),
  tokenAddress: document.querySelector("#tokenAddress"),
  lotteryAddress: document.querySelector("#lotteryAddress"),
  poolAddress: document.querySelector("#poolAddress"),
  ticketRoundMirror: document.querySelector("#ticketRoundMirror"),
  heroTicketHint: document.querySelector("#heroTicketHint"),
  chunkProgressText: document.querySelector("#chunkProgressText"),
  chunkProgressBar: document.querySelector("#chunkProgressBar"),
  nextTicketPreview: document.querySelector("#nextTicketPreview"),
  myTicketNumbers: document.querySelector("#myTicketNumbers"),
  recentWinners: document.querySelector("#recentWinners"),
  winModal: document.querySelector("#winModal"),
  closeModalBtn: document.querySelector("#closeModalBtn"),
  modalTitle: document.querySelector("#modalTitle"),
  winningNumberReveal: document.querySelector("#winningNumberReveal"),
  modalRound: document.querySelector("#modalRound"),
  modalReward: document.querySelector("#modalReward"),
  modalWinner: document.querySelector("#modalWinner"),
  myTicketsModal: document.querySelector("#myTicketsModal"),
  closeTicketsModalBtn: document.querySelector("#closeTicketsModalBtn"),
  ticketModalRound: document.querySelector("#ticketModalRound"),
  ticketModalCount: document.querySelector("#ticketModalCount"),
  ticketModalNumbers: document.querySelector("#ticketModalNumbers"),
  ticketModalAddress: document.querySelector("#ticketModalAddress"),
  drawScratchCanvas: document.querySelector("#drawScratchCanvas"),
  drawTriggerCanvas: document.querySelector("#drawTriggerCanvas"),
  drawTriggerRound: document.querySelector("#drawTriggerRound"),
  drawTriggerStatus: document.querySelector("#drawTriggerStatus")
};

const state = {
  provider: null,
  signer: null,
  account: "",
  token: null,
  lottery: null,
  pool: null,
  decimals: 18,
  symbol: "TOKEN",
  ticketPrice: 0n,
  maxTickets: 50n,
  currentRound: 0n,
  roundEnd: 0n,
  hasChainRound: false,
  currentRoundTotalTickets: 0n,
  userTicketsThisRound: 0n,
  enteredThisRound: false,
  drawTargetRound: 0n,
  drawInFlight: false,
  lastRoundEndRefresh: 0n
};

const scratchState = {
  surfaces: [],
  modalShown: false
};

function isConfigured() {
  return hasEthers() && ethers.isAddress(cfg.tokenAddress) && ethers.isAddress(cfg.lotteryAddress) && ethers.isAddress(cfg.prizePoolAddress);
}

function hasEthers() {
  return typeof window.ethers !== "undefined";
}

function looksLikeAddress(address) {
  return typeof address === "string" && /^0x[a-fA-F0-9]{40}$/.test(address);
}

function shortAddress(address) {
  if (!address || address === "0x0000000000000000000000000000000000000000") return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function setStatus(message) {
  els.txStatus.textContent = message;
}

function explainError(err) {
  const message = err?.shortMessage || err?.reason || err?.message || String(err);
  if (message.includes("TRANSFER_FROM_FAILED")) {
    return "购买失败：代币扣款失败。请检查购买代币是否是彩票合约绑定的代币、钱包余额是否足够、是否已授权，以及该代币是否限制合约转账。";
  }
  if (message.includes("ROUND_LIMIT")) {
    return "购买失败：本轮累计购买张数超过 50 张。";
  }
  if (message.includes("insufficient funds")) {
    return "购买失败：钱包 BNB 不足，无法支付 gas。";
  }
  if (message.includes("user rejected")) {
    return "交易已取消。";
  }
  return message;
}

function formatUnits(value, decimals = state.decimals, digits = 4) {
  const text = ethers.formatUnits(value, decimals);
  const [whole, frac = ""] = text.split(".");
  if (!frac || Number(frac) === 0) return whole;
  return `${whole}.${frac.slice(0, digits).replace(/0+$/, "")}`;
}

function formatTicketNumber(value) {
  const text = BigInt(value).toString();
  return text.padStart(Math.max(4, text.length), "0");
}

function formatTicketRange(start, end) {
  return start === end ? formatTicketNumber(start) : `${formatTicketNumber(start)}-${formatTicketNumber(end)}`;
}

function renderTicketRanges(element, ranges) {
  if (!element) return;
  if (!ranges.length) {
    element.textContent = "-";
    element.classList.remove("ticket-range-list");
    return;
  }
  element.classList.add("ticket-range-list");
  element.replaceChildren(
    ...ranges.map((range) => {
      const chip = document.createElement("span");
      chip.className = "ticket-range-chip";
      chip.textContent = range;
      return chip;
    })
  );
}

function ticketRangesText() {
  const ranges = Array.from(els.myTicketNumbers?.querySelectorAll(".ticket-range-chip") || [])
    .map((item) => item.textContent.trim())
    .filter(Boolean);
  return ranges.length ? ranges.join("，") : (els.myTicketNumbers?.textContent || "-");
}

function selectedTickets() {
  const raw = Number.parseInt(els.ticketInput.value || "1", 10);
  const remaining = state.maxTickets > state.userTicketsThisRound
    ? state.maxTickets - state.userTicketsThisRound
    : 0n;
  const max = Number(remaining);
  if (max <= 0) return 0;
  return Math.min(Math.max(raw, 1), max);
}

function updateStaticAddresses() {
  const isAddress = hasEthers() ? ethers.isAddress : looksLikeAddress;
  if (els.pairAddress) els.pairAddress.textContent = isAddress(cfg.pairAddress) ? shortAddress(cfg.pairAddress) : "待填写";
  if (els.tokenAddress) els.tokenAddress.textContent = isAddress(cfg.tokenAddress) ? shortAddress(cfg.tokenAddress) : "未配置";
  if (els.lotteryAddress) els.lotteryAddress.textContent = isAddress(cfg.lotteryAddress) ? shortAddress(cfg.lotteryAddress) : "未配置";
  if (els.poolAddress) els.poolAddress.textContent = isAddress(cfg.prizePoolAddress) ? shortAddress(cfg.prizePoolAddress) : "未配置";
}

function contractsReady() {
  if (state.token && state.lottery && state.pool) return true;
  setStatus("钱包可以先连接，但购买参与需要先在 config.js 填入 prizePoolAddress 和 lotteryAddress。");
  return false;
}

function updateQuote() {
  const remaining = state.maxTickets > state.userTicketsThisRound
    ? state.maxTickets - state.userTicketsThisRound
    : 0n;
  if (!state.ticketPrice) {
    els.stakeQuote.textContent = "-";
    els.nextTicketPreview.textContent = remaining > 0n ? formatTicketRange(1n, BigInt(selectedTickets())) : "本轮已满";
    return;
  }
  if (remaining === 0n) {
    els.stakeQuote.textContent = "-";
    els.nextTicketPreview.textContent = "本轮已满";
    return;
  }
  const tickets = BigInt(selectedTickets());
  const amount = state.ticketPrice * tickets;
  const start = state.currentRoundTotalTickets + 1n;
  const end = state.currentRoundTotalTickets + tickets;
  els.stakeQuote.textContent = `${formatUnits(amount)} ${state.symbol}`;
  els.nextTicketPreview.textContent = `${formatTicketRange(start, end)}（预计）`;
}

function updateChunkProgress(poolTokenBalance = 0n) {
  if (!els.chunkProgressText || !els.chunkProgressBar) return;
  const unit = 10n ** BigInt(state.decimals);
  const chunk = 500_000n * unit;
  const current = chunk === 0n ? 0n : poolTokenBalance % chunk;
  const percent = chunk === 0n ? 0 : Number((current * 10000n) / chunk) / 100;
  els.chunkProgressText.textContent = `${formatUnits(current, state.decimals, 2)} / 500000 ${state.symbol}`;
  els.chunkProgressBar.style.width = `${Math.min(percent, 100)}%`;
}

function updateRewardPoolText(reward, poolTokenBalance = 0n) {
  if (!els.rewardBalance) return;
  const rewardSymbol = cfg.rewardSymbol || "奖励币";
  els.rewardBalance.textContent = `${formatUnits(reward, cfg.rewardDecimals || 18)} ${rewardSymbol}`;
  if (els.rewardAsset) {
    els.rewardAsset.textContent = "";
    els.rewardAsset.hidden = true;
  }
}

function drawTriggerReady() {
  return state.drawTargetRound && state.drawTargetRound > 0n && !state.drawInFlight;
}

function setDrawTriggerLocked(locked) {
  if (!els.drawTriggerCanvas) return;
  els.drawTriggerCanvas.dataset.locked = locked ? "true" : "false";
  els.drawTriggerCanvas.classList.toggle("is-locked", locked);
}

function localFirstRoundStart() {
  const configured = Number(cfg.localFirstRoundStart || 0);
  if (configured > 0) return configured;
  const stored = Number(window.localStorage.getItem("flapScratchLocalStart") || 0);
  if (stored > 0) return stored;
  const now = Math.floor(Date.now() / 1000);
  window.localStorage.setItem("flapScratchLocalStart", String(now));
  return now;
}

function updateLocalRoundClock() {
  if (state.hasChainRound) return;
  const duration = Math.max(60, Number(cfg.roundDurationSeconds || 600));
  const start = localFirstRoundStart();
  const now = Math.floor(Date.now() / 1000);
  const elapsed = Math.max(0, now - start);
  const roundId = Math.floor(elapsed / duration) + 1;
  const left = duration - (elapsed % duration);
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  els.currentRound.textContent = `第 ${roundId} 轮`;
  els.countdownRound.textContent = String(roundId);
  els.roundCountdown.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function ensureNetwork() {
  const current = await window.ethereum.request({ method: "eth_chainId" });
  const target = `0x${Number(cfg.chainId).toString(16)}`;
  if (current === target) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target }]
    });
  } catch (err) {
    if (err.code !== 4902) throw err;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: target,
        chainName: cfg.chainName,
        nativeCurrency: cfg.nativeCurrency,
        rpcUrls: cfg.rpcUrls,
        blockExplorerUrls: cfg.blockExplorerUrls
      }]
    });
  }
}

async function connect() {
  if (!window.ethereum) {
    setStatus("未检测到钱包，请安装 MetaMask 或 OKX Wallet。");
    return;
  }
  if (!hasEthers()) {
    setStatus("ethers 库没有加载成功。请检查网络，或把 ethers.umd.min.js 下载到本地后再打开页面。");
    return;
  }

  await ensureNetwork();
  state.provider = new ethers.BrowserProvider(window.ethereum);
  await state.provider.send("eth_requestAccounts", []);
  state.signer = await state.provider.getSigner();
  state.account = await state.signer.getAddress();
  els.connectBtn.textContent = shortAddress(state.account);

  if (!isConfigured()) {
    setStatus("钱包已连接。当前还没填写 prizePoolAddress 和 lotteryAddress，部署合约后填入 config.js 即可购买参与。");
    return;
  }

  state.token = new ethers.Contract(cfg.tokenAddress, TOKEN_ABI, state.signer);
  state.lottery = new ethers.Contract(cfg.lotteryAddress, LOTTERY_ABI, state.signer);
  state.pool = new ethers.Contract(cfg.prizePoolAddress, POOL_ABI, state.signer);

  state.decimals = await state.token.decimals();
  state.symbol = await state.token.symbol();
  setStatus("钱包已连接。每轮编号从 0001 开始，开奖会随机抽选本轮购买编号。");
  await refresh();
}

async function loadUserTicketRanges(roundId, user) {
  const ranges = [];
  try {
    const length = Number(await state.lottery.entriesLength(roundId));
    const cappedLength = Math.min(length, 500);
    for (let index = 0; index < cappedLength; index += 1) {
      const entry = await state.lottery.getRoundEntry(roundId, index);
      if (entry.user.toLowerCase() !== user.toLowerCase()) continue;
      const end = BigInt(entry.cumulativeTickets);
      const start = end - BigInt(entry.tickets) + 1n;
      ranges.push(formatTicketRange(start, end));
    }
    if (length > cappedLength) {
      ranges.push("更多编号请看链上记录");
    }
    if (ranges.length) return ranges;
  } catch (err) {
    // Older deployments can still be read through start/end mappings below.
  }

  try {
    const start = await state.lottery.userRoundTicketStart(roundId, user);
    const end = await state.lottery.userRoundTicketEnd(roundId, user);
    if (start > 0n && end >= start) {
      return [formatTicketRange(start, end)];
    }
  } catch (err) {
    // No compatible ticket range reader is available.
  }
  return ranges;
}

async function updateRecentHistory() {
  if (!state.lottery || state.currentRound <= 1n) {
    els.recentWinners.innerHTML = '<p class="empty-note">暂无历史开奖。</p>';
    return;
  }

  const cards = [];
  const start = state.currentRound - 1n;
  const end = start > 8n ? start - 7n : 1n;
  for (let roundId = start; roundId >= end; roundId -= 1n) {
    const round = await state.lottery.rounds(roundId);
    if (!round.drawn) continue;
    const number = formatTicketNumber(round.winningTicket);
    const reward = `${formatUnits(round.rewardAmount, cfg.rewardDecimals || 18)} ${cfg.rewardSymbol || "奖励币"}`;
    cards.push({ roundId, round, number, reward });
    if (roundId === 1n) break;
  }

  if (!cards.length) {
    els.recentWinners.innerHTML = '<p class="empty-note">暂无历史开奖。</p>';
    return;
  }

  els.recentWinners.innerHTML = cards.map((item, index) => `
    <button class="winner-item" type="button" data-history-index="${index}">
      <span>第 ${item.roundId.toString()} 轮</span>
      <strong>${item.number}</strong>
      <em>${item.round.winner}</em>
      <small>${item.reward}</small>
    </button>
  `).join("");

  els.recentWinners.querySelectorAll("[data-history-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = cards[Number(button.dataset.historyIndex)];
      showDrawResult(item.roundId, item.round);
    });
  });
}

async function updateDrawTrigger() {
  if (!els.drawTriggerStatus || !els.drawTriggerRound) return;

  state.drawTargetRound = 0n;
  setDrawTriggerLocked(true);
  if (!state.lottery || state.currentRound <= 1n) {
    els.drawTriggerRound.textContent = "-";
    const roundText = state.currentRound > 0n ? state.currentRound.toString() : "1";
    els.drawTriggerStatus.textContent = `当前参与第 ${roundText} 轮；本轮结束后，会在下一轮刮开本轮开奖。`;
    return;
  }

  const targetRoundId = state.currentRound - 1n;
  const targetRound = await state.lottery.rounds(targetRoundId);
  els.drawTriggerRound.textContent = `第 ${targetRoundId.toString()} 轮`;

  if (targetRound.drawn) {
    els.drawTriggerStatus.textContent = `第 ${targetRoundId.toString()} 轮已开奖。当前可参与第 ${state.currentRound.toString()} 轮，等它结束后再刮本轮开奖。`;
    return;
  }
  if (targetRound.totalTickets === 0n) {
    els.drawTriggerStatus.textContent = `第 ${targetRoundId.toString()} 轮没有购买编号，不能刮开奖。当前可参与第 ${state.currentRound.toString()} 轮。`;
    return;
  }

  state.drawTargetRound = targetRoundId;
  setDrawTriggerLocked(false);
  els.drawTriggerStatus.textContent = `当前可参与第 ${state.currentRound.toString()} 轮；本卡开奖第 ${targetRoundId.toString()} 轮，刮开查看是否中奖。`;
}

async function refresh() {
  if (!state.lottery) return;

  state.currentRound = await state.lottery.currentRoundId();
  const [, end] = await state.lottery.roundWindow(state.currentRound);
  state.roundEnd = end;
  state.hasChainRound = true;
  state.ticketPrice = await state.lottery.ticketPrice();
  state.maxTickets = await state.lottery.maxTicketsPerUser();

  const tickets = await state.lottery.userRoundTickets(state.currentRound, state.account);
  const reward = await state.pool.rewardBalance();
  const round = await state.lottery.rounds(state.currentRound);
  const previousId = state.currentRound > 1n ? state.currentRound - 1n : 0n;
  const poolTokenBalance = await state.token.balanceOf(cfg.prizePoolAddress);
  const ranges = await loadUserTicketRanges(state.currentRound, state.account);

  state.currentRoundTotalTickets = BigInt(round.totalTickets);
  state.userTicketsThisRound = tickets;
  state.enteredThisRound = tickets > 0n;
  const reachedTicketLimit = tickets >= state.maxTickets;
  els.currentRound.textContent = `第 ${state.currentRound.toString()} 轮`;
  els.countdownRound.textContent = state.currentRound.toString();
  if (els.ticketRoundMirror) {
    els.ticketRoundMirror.textContent = `第 ${state.currentRound.toString()} 轮`;
  }
  if (els.heroTicketHint) {
    els.heroTicketHint.textContent = `第 ${state.currentRound.toString()} 轮 · ${formatTicketNumber(1)} 起编号`;
  }
  els.myTickets.textContent = `${tickets.toString()} / ${state.maxTickets.toString()}`;
  renderTicketRanges(els.myTicketNumbers, ranges);
  const remainingTickets = reachedTicketLimit ? 0 : Number(state.maxTickets - tickets);
  els.ticketInput.max = String(Math.max(1, remainingTickets));
  if (remainingTickets > 0 && Number(els.ticketInput.value || "1") > remainingTickets) {
    els.ticketInput.value = String(remainingTickets);
  }
  if (els.approveBtn) els.approveBtn.disabled = reachedTicketLimit;
  els.stakeBtn.disabled = reachedTicketLimit;
  els.stakeBtn.textContent = reachedTicketLimit ? "本轮已满" : "购买参与";
  updateRewardPoolText(reward, poolTokenBalance);
  updateChunkProgress(poolTokenBalance);
  updateQuote();
  updateCountdown();
  await updateDrawTrigger();
  await updateRecentHistory();
}

function updateCountdown() {
  if (!state.roundEnd) {
    updateLocalRoundClock();
    return;
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  const left = state.roundEnd > now ? state.roundEnd - now : 0n;
  const minutes = left / 60n;
  const seconds = left % 60n;
  els.roundCountdown.textContent = left > 0n
    ? `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : "本轮已结束，可开奖";

  if (left === 0n && state.hasChainRound && state.lastRoundEndRefresh !== state.currentRound) {
    state.lastRoundEndRefresh = state.currentRound;
    refresh().catch(() => {});
  }
}

async function approve() {
  if (!state.token) return connect();
  if (!contractsReady()) return;
  if (state.userTicketsThisRound >= state.maxTickets) {
    setStatus("本地址本轮已买满 50 张，等待下一轮再参与。");
    return;
  }
  const amount = state.ticketPrice * BigInt(selectedTickets());
  setStatus("正在提交授权交易...");
  const tx = await state.token.approve(cfg.lotteryAddress, amount);
  await tx.wait();
  setStatus("授权完成，可以购买参与。");
  await refresh();
}

async function stake() {
  if (!state.lottery) return connect();
  if (!contractsReady()) return;
  if (state.userTicketsThisRound >= state.maxTickets) {
    setStatus("本地址本轮已买满 50 张，等待下一轮再参与。");
    return;
  }
  const tickets = BigInt(selectedTickets());
  const amount = state.ticketPrice * tickets;
  if (tickets <= 0n || amount <= 0n) {
    setStatus("本轮已买满 50 张，等待下一轮再参与。");
    return;
  }

  const contractStakeToken = await state.lottery.stakeToken();
  if (contractStakeToken.toLowerCase() !== cfg.tokenAddress.toLowerCase()) {
    setStatus(`购买失败：当前彩票合约绑定的代币是 ${shortAddress(contractStakeToken)}，但前端配置的是 ${shortAddress(cfg.tokenAddress)}。需要重新部署/填写匹配的新彩票合约。`);
    return;
  }

  const balance = await state.token.balanceOf(state.account);
  if (balance < amount) {
    setStatus(`购买失败：钱包余额不足。本次需要 ${formatUnits(amount)} ${state.symbol}，当前余额 ${formatUnits(balance)} ${state.symbol}。`);
    return;
  }

  const allowance = await state.token.allowance(state.account, cfg.lotteryAddress);
  if (allowance < amount) {
    setStatus("授权额度不足，正在自动提交授权交易。授权确认后会继续购买参与...");
    const approveTx = await state.token.approve(cfg.lotteryAddress, amount);
    await approveTx.wait();
    setStatus("授权完成，正在继续购买参与...");
  }

  const start = state.currentRoundTotalTickets + 1n;
  const end = state.currentRoundTotalTickets + tickets;
  setStatus(`正在购买，当前预计编号 ${formatTicketRange(start, end)}。如果同时有人参与，最终以链上实际编号为准...`);
  try {
    const tx = await state.lottery.stakeTickets(tickets);
    await tx.wait();
    await refresh();
    setStatus(`购买成功，本轮实际编号：${ticketRangesText()}。`);
  } catch (err) {
    setStatus(explainError(err));
  }
}

async function triggerDrawFromScratch() {
  if (state.drawInFlight) return;
  if (!state.lottery) {
    await connect();
    if (!state.lottery) return;
  }
  if (!contractsReady()) return;
  if (!state.drawTargetRound || state.drawTargetRound <= 0n) {
    setStatus("还没到开奖时间。倒计时结束后，有购买编号的上一轮才可以刮开奖。");
    if (els.drawTriggerCanvas) paintScratchMask(els.drawTriggerCanvas, "刮开开奖");
    return;
  }

  state.drawInFlight = true;
  setDrawTriggerLocked(true);
  const roundId = state.drawTargetRound;
  try {
    setStatus(`正在为第 ${roundId.toString()} 轮发起链上随机开奖交易...`);
    if (els.drawTriggerStatus) {
      els.drawTriggerStatus.textContent = "请在钱包确认交易，确认后链上随机生成中奖编号。";
    }
    const tx = await state.lottery.drawRound(roundId);
    await tx.wait();
    const round = await state.lottery.rounds(roundId);
    setStatus(`第 ${roundId.toString()} 轮开奖完成，中奖编号 ${formatTicketNumber(round.winningTicket)}。`);
    await refresh();
    showDrawResult(roundId, round);
  } finally {
    state.drawInFlight = false;
    if (els.drawTriggerCanvas) paintScratchMask(els.drawTriggerCanvas, "刮开开奖");
  }
}

function paintScratchMask(canvas, label = "SCRATCH TO REVEAL") {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const gradient = ctx.createLinearGradient(0, 0, rect.width, rect.height);
  gradient.addColorStop(0, "#f2f2f0");
  gradient.addColorStop(0.28, "#d8d8d5");
  gradient.addColorStop(0.62, "#bdbdb9");
  gradient.addColorStop(1, "#eeeeea");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 1;
  for (let x = -rect.height; x < rect.width; x += 9) {
    ctx.beginPath();
    ctx.moveTo(x, rect.height);
    ctx.lineTo(x + rect.height, 0);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.58;
  for (let i = 0; i < 720; i += 1) {
    const x = Math.random() * rect.width;
    const y = Math.random() * rect.height;
    ctx.fillStyle = i % 4 === 0 ? "rgba(255,255,255,0.92)" : "rgba(72,72,72,0.13)";
    ctx.fillRect(x, y, Math.random() * 1.9 + 0.4, Math.random() * 1.9 + 0.4);
  }

  ctx.globalAlpha = 0.24;
  ctx.strokeStyle = "rgba(90,90,90,0.34)";
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 26; i += 1) {
    const x = Math.random() * rect.width;
    const y = Math.random() * rect.height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.random() * 28 + 10, y + Math.random() * 8 - 4);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(88,88,88,0.52)";
  ctx.font = rect.width > 260 ? "800 18px system-ui" : "800 12px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.width / 2, rect.height / 2);
}

function scratchAt(surface, event) {
  const rect = surface.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const ctx = surface.canvas.getContext("2d");
  const radius = surface.canvas.classList.contains("tile-canvas") ? 18 : 34;

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function scratchRatio(canvas) {
  const ctx = canvas.getContext("2d");
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let cleared = 0;
  for (let i = 3; i < pixels.length; i += 16) {
    if (pixels[i] < 80) cleared += 1;
  }
  return cleared / (pixels.length / 16);
}

function showDrawResult(roundId, round) {
  els.modalTitle.textContent = "开奖完成，请刮出中奖编号";
  els.winningNumberReveal.textContent = formatTicketNumber(round.winningTicket);
  els.modalRound.textContent = `第 ${roundId.toString()} 轮`;
  els.modalReward.textContent = `${formatUnits(round.rewardAmount, cfg.rewardDecimals || 18)} ${cfg.rewardSymbol || "奖励币"}`;
  els.modalWinner.textContent = round.winner;
  paintScratchMask(els.drawScratchCanvas, "刮开中奖编号");
  els.winModal.classList.add("visible");
  els.winModal.setAttribute("aria-hidden", "false");
}

function initScratchCanvases() {
  const canvases = Array.from(document.querySelectorAll(".scratch-canvas, .tile-canvas"));
  scratchState.surfaces = canvases.map((canvas) => ({ canvas, drawing: false }));

  scratchState.surfaces.forEach((surface) => {
    const label = surface.canvas.id === "drawTriggerCanvas" ? "刮开开奖" : "刮开中奖编号";
    paintScratchMask(surface.canvas, label);

    surface.canvas.addEventListener("pointerdown", (event) => {
      if (surface.canvas.id === "drawTriggerCanvas" && !drawTriggerReady()) {
        const message = state.lottery
          ? "还没到开奖时间，倒计时结束后才可以刮开开奖。"
          : "请先连接钱包同步链上轮次，倒计时结束后才可以刮开开奖。";
        setStatus(message);
        paintScratchMask(surface.canvas, "刮开开奖");
        return;
      }
      surface.drawing = true;
      surface.canvas.setPointerCapture(event.pointerId);
      scratchAt(surface, event);
    });
    surface.canvas.addEventListener("pointermove", (event) => {
      if (!surface.drawing) return;
      scratchAt(surface, event);
    });
    surface.canvas.addEventListener("pointerup", (event) => {
      if (!surface.drawing) return;
      surface.drawing = false;
      surface.canvas.releasePointerCapture(event.pointerId);
      if (surface.canvas.id === "drawTriggerCanvas" && scratchRatio(surface.canvas) > 0.55) {
        triggerDrawFromScratch().catch((err) => {
          setStatus(err.shortMessage || err.message);
          paintScratchMask(surface.canvas, "刮开开奖");
        });
      }
    });
    surface.canvas.addEventListener("pointercancel", () => {
      surface.drawing = false;
    });
  });
}

function closeModal() {
  els.winModal.classList.remove("visible");
  els.winModal.setAttribute("aria-hidden", "true");
}

function showMyTicketsModal() {
  if (!els.myTicketsModal) return;
  els.ticketModalRound.textContent = state.currentRound > 0n ? `第 ${state.currentRound.toString()} 轮` : "-";
  els.ticketModalCount.textContent = els.myTickets.textContent || "-";
  els.ticketModalNumbers.innerHTML = "";
  const ticketChips = Array.from(els.myTicketNumbers?.querySelectorAll(".ticket-range-chip") || []);
  if (ticketChips.length) {
    els.ticketModalNumbers.classList.add("ticket-range-list");
    els.ticketModalNumbers.replaceChildren(...ticketChips.map((item) => item.cloneNode(true)));
  } else {
    els.ticketModalNumbers.classList.remove("ticket-range-list");
    els.ticketModalNumbers.textContent = els.myTicketNumbers.textContent || "-";
  }
  els.ticketModalAddress.textContent = state.account || "-";
  els.myTicketsModal.classList.add("visible");
  els.myTicketsModal.setAttribute("aria-hidden", "false");
}

function closeMyTicketsModal() {
  if (!els.myTicketsModal) return;
  els.myTicketsModal.classList.remove("visible");
  els.myTicketsModal.setAttribute("aria-hidden", "true");
}

function wireEvents() {
  els.connectBtn.addEventListener("click", () => connect().catch((err) => setStatus(err.shortMessage || err.message)));
  els.approveBtn?.addEventListener("click", () => approve().catch((err) => setStatus(err.shortMessage || err.message)));
  els.stakeBtn.addEventListener("click", () => stake().catch((err) => setStatus(explainError(err))));
  els.minusBtn.addEventListener("click", () => {
    els.ticketInput.value = Math.max(1, selectedTickets() - 1);
    updateQuote();
  });
  els.plusBtn.addEventListener("click", () => {
    const remaining = state.maxTickets > state.userTicketsThisRound
      ? Number(state.maxTickets - state.userTicketsThisRound)
      : 0;
    els.ticketInput.value = Math.min(Math.max(1, remaining), selectedTickets() + 1);
    updateQuote();
  });
  els.ticketInput.addEventListener("input", updateQuote);
  els.myTicketCard?.addEventListener("click", showMyTicketsModal);
  els.myTicketCard?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    showMyTicketsModal();
  });
  els.closeModalBtn.addEventListener("click", closeModal);
  els.closeTicketsModalBtn?.addEventListener("click", closeMyTicketsModal);
  els.winModal.addEventListener("click", (event) => {
    if (event.target === els.winModal) closeModal();
  });
  els.myTicketsModal?.addEventListener("click", (event) => {
    if (event.target === els.myTicketsModal) closeMyTicketsModal();
  });
  window.ethereum?.on("accountsChanged", () => connect().catch((err) => setStatus(err.shortMessage || err.message)));
  window.ethereum?.on("chainChanged", () => window.location.reload());
  window.addEventListener("resize", () => {
    window.clearTimeout(window.__scratchResizeTimer);
    window.__scratchResizeTimer = window.setTimeout(() => {
      scratchState.surfaces.forEach((surface) => {
        const label = surface.canvas.id === "drawTriggerCanvas" ? "刮开开奖" : "刮开中奖编号";
        paintScratchMask(surface.canvas, label);
      });
      scratchState.modalShown = false;
    }, 180);
  });
}

updateStaticAddresses();
updateChunkProgress();
updateLocalRoundClock();
initScratchCanvases();
wireEvents();
setInterval(updateCountdown, 1000);
setInterval(() => refresh().catch(() => {}), 5000);
