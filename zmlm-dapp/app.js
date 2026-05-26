(function () {
  "use strict";

  const config = window.ZMLM_CONFIG || {};
  const BSC_CHAIN_ID = "0x38";
  const BSC_PARAMS = {
    chainId: BSC_CHAIN_ID,
    chainName: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: ["https://bsc-dataseed.binance.org/"],
    blockExplorerUrls: ["https://bscscan.com/"]
  };

  const MIN_MINT_BNB = Number(config.MIN_MINT_BNB || "0.01");
  const MAX_WALLET_MINT_BNB = Number(config.MAX_WALLET_MINT_BNB || "0.1");
  const MINT_STEP_BNB = Number(config.MINT_STEP_BNB || "0.01");
  const TOKENS_PER_STEP = Number(config.TOKENS_PER_0_01_BNB || "1000");
  const TOKEN_SYMBOL = config.TOKEN_SYMBOL || "ZMLM";

  const state = {
    account: "",
    chainId: "",
    walletMintedBnb: 0,
    totalMinted: Number(config.INITIAL_TOTAL_MINTED || 0),
    lastLimitAlertKey: ""
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    connectButton: $("connectButton"),
    mintButton: $("mintButton"),
    mintBnbAmount: $("mintBnbAmount"),
    walletMintedBnb: $("walletMintedBnb"),
    walletRemainingBnb: $("walletRemainingBnb"),
    minMintBnb: $("minMintBnb"),
    maxMintBnb: $("maxMintBnb"),
    statusText: $("statusText"),
    totalMinted: $("totalMinted"),
    maxSupply: $("maxSupply"),
    progressPercent: $("progressPercent"),
    progressBar: $("progressBar"),
    mintPrice: $("mintPrice"),
    networkDot: $("networkDot"),
    networkName: $("networkName"),
    mintContractText: $("mintContractText"),
    tokenContractText: $("tokenContractText"),
    telegramLink: $("telegramLink"),
    twitterLink: $("twitterLink")
  };

  function hasEthereum() {
    return typeof window.ethereum !== "undefined";
  }

  function isAddress(value) {
    return /^0x[a-fA-F0-9]{40}$/.test(value || "");
  }

  function shorten(value) {
    if (!value || !isAddress(value)) return "待配置";
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  function formatBnb(value) {
    return Number(value || 0).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }

  function formatToken(value) {
    return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 6 });
  }

  function storageKey(account) {
    return `zmlm:bnb-minted:${(account || "").toLowerCase()}`;
  }

  function getLocalMintedBnb(account) {
    return Number(localStorage.getItem(storageKey(account)) || 0);
  }

  function setLocalMintedBnb(account, amount) {
    localStorage.setItem(storageKey(account), String(Number(amount).toFixed(6)));
  }

  function normalizeBnbInput(value) {
    const clean = String(value || "").replace(/[^\d.]/g, "");
    const parts = clean.split(".");
    return parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}` : parts[0];
  }

  function getInputBnb() {
    const value = Number(els.mintBnbAmount ? els.mintBnbAmount.value : MIN_MINT_BNB);
    return Number.isFinite(value) ? value : 0;
  }

  function getMintSteps(bnb) {
    return Math.round(Number(bnb || 0) / MINT_STEP_BNB);
  }

  function getMintTokens(bnb) {
    return getMintSteps(bnb) * TOKENS_PER_STEP;
  }

  function getRemainingBnb() {
    return Math.max(0, Number((MAX_WALLET_MINT_BNB - state.walletMintedBnb).toFixed(6)));
  }

  function getAllowedMaxBnb() {
    return Math.min(MAX_WALLET_MINT_BNB, getRemainingBnb());
  }

  function isStepMultiple(value) {
    const scaled = Math.round(value * 100);
    const stepScaled = Math.round(MINT_STEP_BNB * 100);
    return scaled > 0 && scaled % stepScaled === 0 && Math.abs(value * 100 - scaled) < 0.000001;
  }

  function bnbToWeiHex(bnb) {
    const [wholePart, decimalPart = ""] = String(bnb).split(".");
    const decimals = (decimalPart + "0".repeat(18)).slice(0, 18);
    const wei = BigInt(wholePart || "0") * 10n ** 18n + BigInt(decimals || "0");
    return `0x${wei.toString(16)}`;
  }

  function uintHexToNumber(hex, decimals) {
    if (!hex || hex === "0x") return 0;
    const raw = BigInt(hex);
    if (!decimals) return Number(raw);
    return Number(raw / 10n ** BigInt(decimals));
  }

  function uintHexToDecimalNumber(hex, decimals, precision) {
    if (!hex || hex === "0x") return 0;
    const scale = 10n ** BigInt(decimals);
    const raw = BigInt(hex);
    const whole = raw / scale;
    const fraction = raw % scale;
    const paddedFraction = fraction.toString().padStart(decimals, "0").slice(0, precision);
    return Number(`${whole.toString()}.${paddedFraction || "0"}`);
  }

  function encodeAddressArg(address) {
    return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  }

  function setStatus(message, type) {
    if (!els.statusText) return;
    els.statusText.textContent = message;
    els.statusText.dataset.type = type || "neutral";
  }

  function setMintButton(disabled, label) {
    els.mintButton.disabled = disabled;
    els.mintButton.textContent = label || "Mint";
  }

  function getLimitWarning(inputBnb) {
    const allowedMax = getAllowedMaxBnb();
    if (inputBnb > allowedMax) {
      return `当前钱包剩余额度只有 ${formatBnb(allowedMax)} BNB，请输入 ${formatBnb(MIN_MINT_BNB)} 到 ${formatBnb(allowedMax)} BNB。`;
    }
    if (inputBnb < MIN_MINT_BNB) {
      return `最少需要 mint ${formatBnb(MIN_MINT_BNB)} BNB。`;
    }
    return "";
  }

  function alertLimitWarning(inputBnb) {
    const message = getLimitWarning(inputBnb);
    if (!message) {
      state.lastLimitAlertKey = "";
      return;
    }

    const key = `${state.account}:${message}:${formatBnb(inputBnb)}`;
    if (state.lastLimitAlertKey === key) return;
    state.lastLimitAlertKey = key;
    window.alert(message);
  }

  function updateProgress() {
    const totalSupply = Number(config.TOTAL_MINT_SUPPLY || 0);
    const totalMinted = Math.max(0, Number(state.totalMinted || 0));
    const percent = totalSupply > 0 ? Math.min(100, (totalMinted / totalSupply) * 100) : 0;

    els.totalMinted.textContent = formatToken(totalMinted);
    els.maxSupply.textContent = formatToken(totalSupply);
    els.progressPercent.textContent = `${percent.toFixed(percent >= 10 ? 0 : 1)}%`;
    els.progressBar.style.width = `${percent}%`;
  }

  function updateUi() {
    const isConnected = Boolean(state.account);
    const onBsc = state.chainId === BSC_CHAIN_ID;
    const hasContract = isAddress(config.MINT_CONTRACT_ADDRESS);
    const remaining = getRemainingBnb();
    const allowedMax = getAllowedMaxBnb();
    const inputBnb = getInputBnb();
    const displayBnb = inputBnb || MIN_MINT_BNB;
    const displayTokens = getMintTokens(displayBnb);

    if (els.walletMintedBnb) els.walletMintedBnb.textContent = formatBnb(state.walletMintedBnb);
    if (els.walletRemainingBnb) els.walletRemainingBnb.textContent = formatBnb(remaining);
    if (els.minMintBnb) els.minMintBnb.textContent = formatBnb(MIN_MINT_BNB);
    if (els.maxMintBnb) els.maxMintBnb.textContent = formatBnb(MAX_WALLET_MINT_BNB);

    els.mintPrice.textContent = `${formatBnb(displayBnb)} BNB = ${formatToken(displayTokens)} ${TOKEN_SYMBOL}`;
    els.mintContractText.textContent = shorten(config.MINT_CONTRACT_ADDRESS);
    els.tokenContractText.textContent = shorten(config.TOKEN_CONTRACT_ADDRESS || config.MINT_CONTRACT_ADDRESS);
    els.telegramLink.href = config.TELEGRAM_URL || "#";
    els.twitterLink.href = config.TWITTER_URL || "#";

    els.connectButton.textContent = isConnected ? shorten(state.account) : "连接钱包";
    els.networkDot.classList.toggle("online", onBsc);
    els.networkName.textContent = onBsc ? "BSC Mainnet" : "请切换到 BSC";

    if (!hasEthereum()) {
      setMintButton(true, "需要钱包");
      setStatus("请安装 MetaMask、OKX Wallet 或 Trust Wallet 等浏览器钱包。", "error");
    } else if (!hasContract) {
      setMintButton(true, "待配置合约");
      setStatus("请先在 config.js 填入 MINT_CONTRACT_ADDRESS。", "error");
    } else if (!isConnected) {
      setMintButton(true, "先连接钱包");
      setStatus("每 0.01 BNB 自动到账 1,000 ZMLM，单钱包最多 mint 0.1 BNB。", "neutral");
    } else if (!onBsc) {
      setMintButton(false, "切换到 BSC");
      setStatus("当前钱包不在 BSC 主网，点击按钮可请求切换。", "warning");
    } else if (remaining < MIN_MINT_BNB) {
      setMintButton(true, "已达上限");
      setStatus(`当前钱包已达到 ${formatBnb(MAX_WALLET_MINT_BNB)} BNB 的 mint 上限。`, "warning");
    } else if (inputBnb < MIN_MINT_BNB || inputBnb > allowedMax) {
      setMintButton(true, "超出额度");
      setStatus(`请输入 ${formatBnb(MIN_MINT_BNB)} 到 ${formatBnb(allowedMax)} BNB。`, "warning");
    } else if (!isStepMultiple(inputBnb)) {
      setMintButton(true, "金额错误");
      setStatus("Mint 金额必须是 0.01 BNB 的倍数。", "warning");
    } else {
      setMintButton(false, "Mint");
      setStatus(`本次将到账 ${formatToken(getMintTokens(inputBnb))} ${TOKEN_SYMBOL}。钱包剩余额度 ${formatBnb(remaining)} BNB。`, "neutral");
    }

    updateProgress();
  }

  async function connectWallet() {
    if (!hasEthereum()) {
      updateUi();
      return;
    }

    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      state.account = accounts[0] || "";
      state.chainId = await window.ethereum.request({ method: "eth_chainId" });
      state.walletMintedBnb = getLocalMintedBnb(state.account);
      await refreshWalletMinted();
      await refreshTotalMinted();
      updateUi();
    } catch (error) {
      setStatus(error.message || "连接钱包失败。", "error");
    }
  }

  async function switchToBsc() {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BSC_CHAIN_ID }]
      });
    } catch (error) {
      if (error && error.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [BSC_PARAMS]
        });
      } else {
        throw error;
      }
    }

    state.chainId = await window.ethereum.request({ method: "eth_chainId" });
    updateUi();
  }

  async function refreshTotalMinted() {
    if (!hasEthereum() || !isAddress(config.MINT_CONTRACT_ADDRESS) || !config.TOTAL_MINTED_SELECTOR) {
      return;
    }

    try {
      const result = await window.ethereum.request({
        method: "eth_call",
        params: [{ to: config.MINT_CONTRACT_ADDRESS, data: config.TOTAL_MINTED_SELECTOR }, "latest"]
      });

      state.totalMinted = uintHexToNumber(result, Number(config.TOTAL_MINTED_DECIMALS || 0));
    } catch (error) {
      state.totalMinted = Number(config.INITIAL_TOTAL_MINTED || 0);
    }
  }

  async function refreshWalletMinted() {
    if (
      !state.account ||
      !hasEthereum() ||
      !isAddress(config.MINT_CONTRACT_ADDRESS) ||
      !config.WALLET_MINTED_SELECTOR
    ) {
      return;
    }

    try {
      const result = await window.ethereum.request({
        method: "eth_call",
        params: [
          {
            to: config.MINT_CONTRACT_ADDRESS,
            data: `${config.WALLET_MINTED_SELECTOR}${encodeAddressArg(state.account)}`
          },
          "latest"
        ]
      });
      state.walletMintedBnb = uintHexToDecimalNumber(result, 18, 6);
      setLocalMintedBnb(state.account, state.walletMintedBnb);
    } catch (error) {
      state.walletMintedBnb = getLocalMintedBnb(state.account);
    }
  }

  async function mint() {
    if (!state.account) {
      await connectWallet();
      return;
    }

    if (state.chainId !== BSC_CHAIN_ID) {
      try {
        await switchToBsc();
      } catch (error) {
        setStatus(error.message || "切换 BSC 失败。", "error");
      }
      return;
    }

    if (!isAddress(config.MINT_CONTRACT_ADDRESS)) {
      updateUi();
      return;
    }

    const mintBnb = getInputBnb();
    const allowedMax = getAllowedMaxBnb();
    if (mintBnb < MIN_MINT_BNB || mintBnb > allowedMax) {
      alertLimitWarning(mintBnb);
      setStatus(`请输入 ${formatBnb(MIN_MINT_BNB)} 到 ${formatBnb(allowedMax)} BNB。`, "warning");
      updateUi();
      return;
    }
    if (!isStepMultiple(mintBnb)) {
      setStatus("Mint 金额必须是 0.01 BNB 的倍数。", "warning");
      updateUi();
      return;
    }

    const tx = {
      from: state.account,
      to: config.MINT_CONTRACT_ADDRESS,
      value: bnbToWeiHex(formatBnb(mintBnb))
    };

    if (config.MINT_MODE !== "transferOnly") {
      tx.data = config.MINT_FUNCTION_SELECTOR || "0x1249c58b";
    }

    try {
      setMintButton(true, "等待确认");
      setStatus("请在钱包里确认交易。", "warning");

      const hash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [tx]
      });

      state.walletMintedBnb = Number((state.walletMintedBnb + mintBnb).toFixed(6));
      state.totalMinted += getMintTokens(mintBnb);
      setLocalMintedBnb(state.account, state.walletMintedBnb);
      setStatus(`交易已提交：${hash.slice(0, 10)}...${hash.slice(-8)}`, "success");
      updateUi();
      setTimeout(refreshAllAndRender, 6000);
    } catch (error) {
      setStatus(error.message || "Mint 交易失败或已取消。", "error");
      updateUi();
    }
  }

  async function refreshAllAndRender() {
    await refreshWalletMinted();
    await refreshTotalMinted();
    updateUi();
  }

  function bindEvents() {
    els.connectButton.addEventListener("click", connectWallet);
    els.mintButton.addEventListener("click", mint);

    if (els.mintBnbAmount) {
      els.mintBnbAmount.addEventListener("input", () => {
        els.mintBnbAmount.value = normalizeBnbInput(els.mintBnbAmount.value);
        updateUi();
        if (state.account && state.chainId === BSC_CHAIN_ID) {
          alertLimitWarning(getInputBnb());
        }
      });
      els.mintBnbAmount.addEventListener("blur", updateUi);
    }

    if (hasEthereum()) {
      window.ethereum.on("accountsChanged", async (accounts) => {
        state.account = accounts[0] || "";
        state.lastLimitAlertKey = "";
        state.walletMintedBnb = getLocalMintedBnb(state.account);
        await refreshWalletMinted();
        updateUi();
      });
      window.ethereum.on("chainChanged", async (chainId) => {
        state.chainId = chainId;
        state.lastLimitAlertKey = "";
        await refreshAllAndRender();
      });
    }
  }

  async function boot() {
    bindEvents();
    updateUi();

    if (hasEthereum()) {
      try {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        state.account = accounts[0] || "";
        state.chainId = await window.ethereum.request({ method: "eth_chainId" });
        state.walletMintedBnb = getLocalMintedBnb(state.account);
        await refreshWalletMinted();
        await refreshTotalMinted();
      } catch (error) {
        state.account = "";
      }
      updateUi();
    }
  }

  boot();
})();
