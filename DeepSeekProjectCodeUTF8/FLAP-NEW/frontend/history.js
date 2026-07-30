const cfg = window.FLAP_SCRATCH_CONFIG;

const LOTTERY_ABI = [
  "function currentRoundId() view returns (uint256)",
  "function rounds(uint256) view returns (uint256 totalTickets,uint256 totalStaked,bool drawn,address winner,uint256 winningTicket,uint256 rewardAmount,uint256 drawnAt)"
];

const els = {
  range: document.querySelector("#archiveRange"),
  status: document.querySelector("#historyStatus"),
  list: document.querySelector("#historyList"),
  reload: document.querySelector("#reloadHistoryBtn")
};

function shortAddress(address) {
  if (!address || address === ethers.ZeroAddress) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUnits(value, decimals = 18, digits = 4) {
  const text = ethers.formatUnits(value, decimals);
  const [whole, frac = ""] = text.split(".");
  if (!frac || Number(frac) === 0) return whole;
  return `${whole}.${frac.slice(0, digits).replace(/0+$/, "")}`;
}

function formatTicketNumber(value) {
  const text = BigInt(value).toString();
  return text.padStart(Math.max(4, text.length), "0");
}

function formatTime(seconds) {
  if (!seconds) return "-";
  return new Date(Number(seconds) * 1000).toLocaleString("zh-CN", { hour12: false });
}

function configured() {
  return ethers.isAddress(cfg.lotteryAddress) && Array.isArray(cfg.rpcUrls) && cfg.rpcUrls.length > 0;
}

async function loadHistory() {
  if (!configured()) {
    els.status.textContent = "请先在 config.js 填入 lotteryAddress 和 rpcUrls。";
    els.list.innerHTML = "";
    return;
  }

  els.status.textContent = "正在读取链上历史...";
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrls[0], cfg.chainId);
  const lottery = new ethers.Contract(cfg.lotteryAddress, LOTTERY_ABI, provider);
  const currentRound = await lottery.currentRoundId();
  const latestDone = currentRound > 1n ? currentRound - 1n : 0n;
  if (latestDone === 0n) {
    els.range.textContent = "暂无已结束轮次";
    els.status.textContent = "暂无历史开奖。";
    els.list.innerHTML = "";
    return;
  }

  const firstRound = latestDone > 50n ? latestDone - 49n : 1n;
  els.range.textContent = `第 ${firstRound.toString()} 轮 - 第 ${latestDone.toString()} 轮`;

  const rows = [];
  for (let roundId = latestDone; roundId >= firstRound; roundId -= 1n) {
    const round = await lottery.rounds(roundId);
    if (round.drawn) {
      rows.push({ roundId, round });
    }
    if (roundId === 1n) break;
  }

  if (!rows.length) {
    els.status.textContent = "最近 50 轮暂无已开奖记录。";
    els.list.innerHTML = "";
    return;
  }

  els.status.textContent = `已读取 ${rows.length} 条开奖记录。`;
  els.list.innerHTML = rows.map(({ roundId, round }) => `
    <article class="archive-item">
      <div class="archive-number">
        <span>第 ${roundId.toString()} 轮</span>
        <strong>${formatTicketNumber(round.winningTicket)}</strong>
      </div>
      <dl>
        <div><dt>派奖金额</dt><dd>${formatUnits(round.rewardAmount, cfg.rewardDecimals || 18)} ${cfg.rewardSymbol || "奖励币"}</dd></div>
        <div><dt>奖池金额</dt><dd>${formatUnits(round.rewardAmount, cfg.rewardDecimals || 18)} ${cfg.rewardSymbol || "奖励币"}</dd></div>
        <div><dt>中奖地址</dt><dd>${round.winner}</dd></div>
        <div><dt>开奖时间</dt><dd>${formatTime(round.drawnAt)}</dd></div>
        <div><dt>总编号数</dt><dd>${round.totalTickets.toString()}</dd></div>
      </dl>
    </article>
  `).join("");
}

els.reload.addEventListener("click", () => {
  loadHistory().catch((err) => {
    els.status.textContent = err.shortMessage || err.message;
  });
});

loadHistory().catch((err) => {
  els.status.textContent = err.shortMessage || err.message;
});
