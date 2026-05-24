const CONFIG = {
  bscChainIdHex: window.QWFLAP_CONFIG?.bscChainIdHex || "0x38",
  bscChainId: window.QWFLAP_CONFIG?.bscChainId || 56,
  kofTokenAddress: window.QWFLAP_CONFIG?.kofTokenAddress || "0x0000000000000000000000000000000000000000",
  arenaContractAddress: window.QWFLAP_CONFIG?.arenaContractAddress || "0x0000000000000000000000000000000000000000",
};

const CHARACTERS = [
  { id: "silverk", name: "银焰·K", source: "K'", style: "冷焰爆发", skill: "银核爆拳", beats: "苍袖·Ash", weak: "赤炎·京", color: "#dbeafe", art: "./assets/silverk.svg", tag: "图中左上：银发冷焰" },
  { id: "ashveil", name: "苍袖·Ash", source: "Ash Crimson", style: "异色袖刃", skill: "翠焰旋舞", beats: "黑狮·卢卡", weak: "银焰·K", color: "#60a5fa", art: "./assets/ashveil.svg", tag: "图中上中：长袍奇袭" },
  { id: "lionrugal", name: "黑狮·卢卡", source: "Rugal/黑豹 Boss 原型", style: "王者压迫", skill: "黑狮裁决", beats: "赤炎·京", weak: "苍袖·Ash", color: "#c4b5fd", art: "./assets/lionrugal.svg", tag: "图中右上：黑狮统御" },
  { id: "akayan", name: "赤炎·京", source: "草薙京", style: "火焰格斗", skill: "大蛇薙", beats: "紫炎·庵", weak: "黑狮·卢卡", color: "#ff3d58", art: "./assets/akayan.svg", tag: "图中中左：火焰主角" },
  { id: "shien", name: "紫炎·庵", source: "八神庵", style: "暗炎奇袭", skill: "八稚女", beats: "饿狼·特瑞", weak: "赤炎·京", color: "#a855f7", art: "./assets/shien.svg", tag: "图中正中：红发暗炎" },
  { id: "terrywolf", name: "饿狼·特瑞", source: "KOF 皮衣银发格斗家", style: "力量反击", skill: "能量喷泉", beats: "赤炎·京", weak: "紫炎·庵", color: "#f4c75e", art: "./assets/terrywolf.svg", tag: "图中中右：皮衣重拳" },
  { id: "karategirl", name: "极拳·尤莉", source: "坂崎由莉", style: "空手道连打", skill: "飞燕疾风脚", beats: "忍姬·舞", weak: "电神·雅典娜", color: "#f472b6", art: "./assets/karategirl.svg", tag: "图中左下：空手道少女" },
  { id: "maitrap", name: "忍姬·舞", source: "不知火舞", style: "陷阱反制", skill: "超必杀忍蜂", beats: "紫炎·庵", weak: "极拳·尤莉", color: "#2dfc8c", art: "./assets/maitrap.svg", tag: "图中下中：折扇忍姬" },
  { id: "athenavolt", name: "电神·雅典娜", source: "麻宫雅典娜", style: "高速压制", skill: "雷光拳", beats: "极拳·尤莉", weak: "忍姬·舞", color: "#22d3ee", art: "./assets/athenavolt.svg", tag: "图中右下：青发偶像" },
];

const SKILLS = [
  { name: "大蛇薙", cost: 0, text: "直线高伤" },
  { name: "八稚女", cost: 0, text: "多段连击" },
  { name: "能量喷泉", cost: 0, text: "范围击飞" },
];

const ENEMIES = ["NeonFist", "ShadowMax", "RoofTiger", "VioletZero", "BurningWay"];
const ERC20_ABI = [
  "0x70a08231000000000000000000000000",
];

const state = {
  account: "",
  stake: 50,
  round: 1,
  timer: 15,
  playerWins: 0,
  enemyWins: 0,
  energy: 0,
  energyEarned: 0,
  mode: "normal",
  playerChar: CHARACTERS[0],
  enemyChar: CHARACTERS[1],
  playerSkill: SKILLS[0],
  enemySkill: SKILLS[1],
  totalBurned: 8720441,
  pool: 148902,
  myBurn: 0,
  matches: 0,
  wins: 0,
  countdown: null,
};

const $ = (id) => document.getElementById(id);

function fmt(n) {
  return Math.floor(n).toLocaleString("en-US");
}

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "未连接";
}

function addLog(text) {
  const box = $("battleLog");
  const p = document.createElement("p");
  p.textContent = text;
  box.prepend(p);
  while (box.children.length > 8) box.lastChild.remove();
}

function renderCharacters() {
  const grid = $("characterGrid");
  grid.innerHTML = "";
  CHARACTERS.forEach((char) => {
    const btn = document.createElement("button");
    btn.className = `char-btn${state.playerChar.name === char.name ? " active" : ""}`;
    btn.innerHTML = `<img src="${char.art}" alt=""><strong>${char.name}</strong><span>原型：${char.source}</span><span>${char.tag}</span>`;
    btn.style.borderColor = state.playerChar.name === char.name ? char.color : "";
    btn.addEventListener("click", () => {
      state.playerChar = char;
      state.playerSkill = { name: char.skill, cost: 0, text: char.style };
      renderAll();
    });
    grid.appendChild(btn);
  });
}

function renderSkills() {
  const grid = $("skillGrid");
  const skills = [
    { name: state.playerChar.skill, cost: 0, text: "角色得意技" },
    { name: "超必杀连击", cost: 50, text: "胜利时销毁 60%" },
    { name: "MAX 超必杀", cost: 100, text: "胜利时销毁 80% + bonus" },
  ];
  grid.innerHTML = "";
  skills.forEach((skill) => {
    const disabled = state.energy < skill.cost;
    const btn = document.createElement("button");
    btn.className = `skill-btn${state.playerSkill.name === skill.name ? " active" : ""}`;
    btn.innerHTML = `<strong>${skill.name}</strong><span>能量 ${skill.cost} · ${skill.text}</span>`;
    btn.disabled = disabled;
    btn.style.opacity = disabled ? "0.48" : "1";
    btn.addEventListener("click", () => {
      if (state.energy < skill.cost) return;
      state.playerSkill = skill;
      state.mode = skill.cost === 100 ? "max" : skill.cost === 50 ? "super" : "normal";
      renderAll();
    });
    grid.appendChild(btn);
  });
}

function renderPips() {
  [...$("playerPips").children].forEach((pip, index) => pip.classList.toggle("on", index < state.playerWins));
  [...$("enemyPips").children].forEach((pip, index) => pip.classList.toggle("on", index < state.enemyWins));
}

function renderLeaderboard() {
  const rows = [
    ["BlazeLee", "82W", "16连胜", "428K"],
    ["VioletZero", "77W", "11连胜", "391K"],
    ["RoofTiger", "64W", "9连胜", "310K"],
  ];
  $("leaderboard").innerHTML = rows
    .map((row, i) => `<div class="leader-row"><span>#${i + 1} ${row[0]}</span><strong>${row[1]} / ${row[2]} / ${row[3]}</strong></div>`)
    .join("");
}

function renderAll() {
  $("stakeAmount").textContent = fmt(state.stake);
  $("roundLabel").textContent = `ROUND ${Math.min(state.round, 3)} / 3`;
  $("timerLabel").textContent = state.timer;
  $("playerCharacter").textContent = state.playerChar.name;
  $("playerSkill").textContent = state.playerSkill.name;
  $("enemyCharacter").textContent = state.enemyChar.name;
  $("enemySkill").textContent = state.enemySkill.name;
  $("playerPortrait").src = state.playerChar.art;
  $("enemyPortrait").src = state.enemyChar.art;
  $("playerAvatar").textContent = state.playerChar.name.slice(-1);
  $("counterLabel").textContent = `克制：${state.playerChar.name} → ${state.playerChar.beats}`;
  $("energyValue").textContent = state.energy;
  $("energyRing").style.setProperty("--pct", `${Math.min(state.energy, 100)}%`);
  $("energyMode").textContent = state.mode === "max" ? "MAX 超必杀" : state.mode === "super" ? "超必杀" : "普通必杀";
  $("energyHint").textContent = state.energy >= 100 ? "MAX 可用" : state.energy >= 50 ? "超必杀可用" : "继续蓄能";
  $("burnCounter").textContent = fmt(state.totalBurned);
  $("poolLabel").textContent = `${fmt(state.pool)} $KOF`;
  $("myBurn").textContent = fmt(state.myBurn);
  $("energyEarned").textContent = state.energyEarned;
  $("winRate").textContent = state.matches ? `${Math.round((state.wins / state.matches) * 100)}%` : "0%";
  $("walletLabel").textContent = shortAddress(state.account);
  renderCharacters();
  renderSkills();
  renderPips();
}

async function connectWallet() {
  if (!window.ethereum) {
    addLog("未检测到钱包，请安装 MetaMask 或兼容钱包。");
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    state.account = accounts[0] || "";
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (chainId !== CONFIG.bscChainIdHex) {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CONFIG.bscChainIdHex }],
      });
    }
    addLog(`钱包已连接：${shortAddress(state.account)}`);
    await refreshBalance();
    renderAll();
  } catch (error) {
    addLog(`钱包连接失败：${error.message || error}`);
  }
}

async function refreshBalance() {
  if (!state.account || !window.ethereum || CONFIG.kofTokenAddress === "0x0000000000000000000000000000000000000000") {
    $("balanceLabel").textContent = "余额 -- $KOF";
    return;
  }
  try {
    const data = `${ERC20_ABI[0]}${state.account.slice(2).padStart(64, "0")}`;
    const result = await window.ethereum.request({
      method: "eth_call",
      params: [{ to: CONFIG.kofTokenAddress, data }, "latest"],
    });
    const balance = Number(BigInt(result) / 10n ** 18n);
    $("balanceLabel").textContent = `余额 ${fmt(balance)} $KOF`;
  } catch {
    $("balanceLabel").textContent = "余额读取失败";
  }
}

function pickEnemy() {
  state.enemyChar = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
  state.enemySkill = { name: state.enemyChar.skill, cost: 0, text: state.enemyChar.style };
  $("enemyName").textContent = ENEMIES[Math.floor(Math.random() * ENEMIES.length)];
}

function startTimer() {
  clearInterval(state.countdown);
  state.timer = 15;
  state.countdown = setInterval(() => {
    state.timer -= 1;
    if (state.timer <= 0) resolveRound();
    renderAll();
  }, 1000);
}

function weightedWin() {
  let playerWeight = 50;
  if (state.playerChar.beats === state.enemyChar.name) playerWeight += 15;
  if (state.playerChar.weak === state.enemyChar.name) playerWeight -= 15;
  if (state.playerChar.name === "电神·雷欧娜") playerWeight += 8;
  if (state.mode === "super") playerWeight += 7;
  if (state.mode === "max") playerWeight += 12;
  return Math.random() * 100 < Math.max(18, Math.min(82, playerWeight));
}

function resolveRound() {
  clearInterval(state.countdown);
  const playerWon = weightedWin();
  const burnRate = playerWon ? (state.mode === "max" ? 0.8 : state.mode === "super" ? 0.6 : 0.4) : 0.4;
  const burned = state.stake * burnRate;
  const poolAdd = state.stake * 0.3;
  const bonus = playerWon && state.mode === "max" ? state.stake * 0.1 : 0;

  if (playerWon) state.playerWins += 1;
  else state.enemyWins += 1;

  state.totalBurned += burned;
  state.pool += poolAdd;
  state.myBurn += playerWon ? burned : state.stake * 0.4;
  state.energy = Math.min(120, state.energy + 10 - (state.mode === "max" ? 100 : state.mode === "super" ? 50 : 0));
  state.energyEarned += 10;

  const skill = state.playerSkill.name;
  $("koBanner").textContent = playerWon ? "K.O. WIN" : "COUNTER HIT";
  $("koBanner").classList.remove("flash");
  $("koBanner").offsetHeight;
  $("koBanner").classList.add("flash");
  $(playerWon ? "enemyArt" : "playerArt").classList.add("hit");
  setTimeout(() => $("enemyArt").classList.remove("hit"), 460);
  setTimeout(() => $("playerArt").classList.remove("hit"), 460);

  addLog(
    playerWon
      ? `${state.playerChar.name} 释放 ${skill}，烧毁对方 ${fmt(burned)} $KOF，MAX bonus ${fmt(bonus)} $KOF。`
      : `${state.enemyChar.name} 反击成功，本回合你贡献焚币 ${fmt(state.stake * 0.4)} $KOF。`
  );

  state.mode = "normal";
  state.playerSkill = { name: state.playerChar.skill, cost: 0, text: state.playerChar.style };

  if (state.round >= 3) {
    finishMatch();
  } else {
    state.round += 1;
    pickEnemy();
    state.timer = 15;
    startTimer();
  }
  renderAll();
}

function finishMatch() {
  clearInterval(state.countdown);
  state.matches += 1;
  const playerWonMatch = state.playerWins > state.enemyWins;
  if (playerWonMatch) state.wins += 1;
  const prize = state.stake * 3 * 0.7 + (playerWonMatch ? state.pool * 0.01 : 0);
  $("koBanner").textContent = playerWonMatch ? "FINAL K.O." : "DEFEATED";
  addLog(playerWonMatch ? `终局胜利，赢得约 ${fmt(prize)} $KOF。` : "终局落败，焚币记录已写入战绩。");
}

function quickMatch() {
  if (state.stake < 10) {
    addLog("最低押注为 10 $KOF。");
    return;
  }
  state.round = 1;
  state.playerWins = 0;
  state.enemyWins = 0;
  state.mode = "normal";
  pickEnemy();
  $("koBanner").textContent = "FIGHT";
  addLog(`快速匹配成功，押注区间 ±20%，本局每回合 ${fmt(state.stake)} $KOF。`);
  startTimer();
  renderAll();
}

function createArena() {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  addLog(`擂台码 ${code} 已生成，等待对手锁定押注。`);
}

function setStake(delta) {
  state.stake = Math.max(10, Math.min(500000, state.stake + delta));
  renderAll();
}

function tipPlayer() {
  state.pool += 20;
  addLog("观战打赏已加入高手对局，同时 3% 注入焚币奖金池。");
  renderAll();
}

function initCanvas() {
  const canvas = $("skyCanvas");
  const ctx = canvas.getContext("2d");
  const sparks = Array.from({ length: 90 }, () => ({
    x: Math.random(),
    y: Math.random(),
    s: 0.5 + Math.random() * 2.2,
    v: 0.001 + Math.random() * 0.004,
  }));

  function resize() {
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;
    sparks.forEach((p) => {
      p.y -= p.v;
      if (p.y < 0) {
        p.y = 1;
        p.x = Math.random();
      }
      ctx.fillStyle = Math.random() > 0.08 ? "rgba(244,199,94,.42)" : "rgba(168,85,247,.7)";
      ctx.fillRect(p.x * w, p.y * h, p.s * devicePixelRatio, p.s * devicePixelRatio * 4);
    });

    if (Math.random() > 0.975) {
      ctx.strokeStyle = "rgba(244,199,94,.72)";
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.beginPath();
      const x = Math.random() * w;
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 40 * devicePixelRatio, h * 0.18);
      ctx.lineTo(x - 20 * devicePixelRatio, h * 0.34);
      ctx.stroke();
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  draw();
}

function wireEvents() {
  $("connectBtn").addEventListener("click", connectWallet);
  $("stakeMinus").addEventListener("click", () => setStake(-10));
  $("stakePlus").addEventListener("click", () => setStake(10));
  $("matchBtn").addEventListener("click", quickMatch);
  $("arenaBtn").addEventListener("click", createArena);
  $("tipBtn").addEventListener("click", tipPlayer);
  $("superBtn").addEventListener("click", () => {
    if (state.energy < 50) return addLog("能量不足，超必杀需要 50。");
    state.mode = "super";
    state.playerSkill = { name: "超必杀连击", cost: 50, text: "胜利时销毁 60%" };
    renderAll();
  });
  $("maxBtn").addEventListener("click", () => {
    if (state.energy < 100) return addLog("能量不足，MAX 超必杀需要 100。");
    state.mode = "max";
    state.playerSkill = { name: "MAX 超必杀", cost: 100, text: "胜利时销毁 80% + bonus" };
    renderAll();
  });
}

initCanvas();
wireEvents();
renderLeaderboard();
renderAll();
