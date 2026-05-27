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

  const state = {
    account: "",
    chainId: "",
    tokenBalance: 0n,
    allowance: 0n,
    userStake: 0n,
    totalStaked: 0n,
    pendingRewards: 0n,
    undistributedRewards: 0n,
    userWeightBps: 0n,
    nextDistributionTime: 0n
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    connectButton: $("poolConnectButton"),
    tokenAddress: $("poolTokenAddress"),
    stakeAmount: $("poolStakeAmount"),
    approveButton: $("poolApproveButton"),
    stakeButton: $("poolStakeButton"),
    unstakeButton: $("poolUnstakeButton"),
    claimButton: $("poolClaimButton"),
    statusText: $("poolStatusText"),
    userStake: $("poolUserStake"),
    userWeight: $("poolUserWeight"),
    pendingRewards: $("poolPendingRewards"),
    totalStaked: $("poolTotalStaked"),
    undistributedRewards: $("poolUndistributedRewards"),
    nextDistribution: $("poolNextDistribution")
  };

  function hasEthereum() {
    return typeof window.ethereum !== "undefined";
  }

  function isAddress(value) {
    return /^0x[a-fA-F0-9]{40}$/.test(value || "");
  }

  function shorten(value) {
    return isAddress(value) ? `${value.slice(0, 6)}...${value.slice(-4)}` : "待配置";
  }

  function setStatus(message, type) {
    els.statusText.textContent = message;
    els.statusText.dataset.type = type || "neutral";
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    if (label) button.textContent = label;
  }

  function stripDecimal(value) {
    const clean = String(value || "").replace(/[^\d.]/g, "");
    const parts = clean.split(".");
    return parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("").slice(0, 18)}` : parts[0];
  }

  function parseToken(value) {
    const normalized = stripDecimal(value);
    if (!normalized || Number(normalized) <= 0) return 0n;
    const [whole, frac = ""] = normalized.split(".");
    return BigInt(whole || "0") * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
  }

  function formatUnits(value, decimals, precision) {
    const raw = BigInt(value || 0);
    const scale = 10n ** BigInt(decimals);
    const whole = raw / scale;
    const fraction = raw % scale;
    const trimmed = fraction.toString().padStart(decimals, "0").slice(0, precision).replace(/0+$/, "");
    return trimmed ? `${whole.toString()}.${trimmed}` : whole.toString();
  }

  function encodeUint(value) {
    return BigInt(value).toString(16).padStart(64, "0");
  }

  function encodeAddress(address) {
    return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  }

  function decodeUint(hex) {
    if (!hex || hex === "0x") return 0n;
    return BigInt(hex);
  }

  function poolAddress() {
    return config.DIVIDEND_POOL_ADDRESS || "";
  }

  function tokenAddress() {
    return config.TOKEN_CONTRACT_ADDRESS || config.MINT_CONTRACT_ADDRESS || "";
  }

  async function call(to, data) {
    const result = await window.ethereum.request({ method: "eth_call", params: [{ to, data }, "latest"] });
    return decodeUint(result);
  }

  async function send(to, data, value) {
    return window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from: state.account, to, data, value: value || "0x0" }]
    });
  }

  async function connectWallet() {
    if (!hasEthereum()) {
      setStatus("请安装 MetaMask、OKX Wallet 或 Trust Wallet 等浏览器钱包。", "error");
      return;
    }
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    state.account = accounts[0] || "";
    state.chainId = await window.ethereum.request({ method: "eth_chainId" });
    await refreshAll();
  }

  async function switchToBsc() {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC_CHAIN_ID }] });
    } catch (error) {
      if (error && error.code === 4902) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [BSC_PARAMS] });
      } else {
        throw error;
      }
    }
    state.chainId = await window.ethereum.request({ method: "eth_chainId" });
  }

  async function refreshAll() {
    const token = tokenAddress();
    const pool = poolAddress();
    els.tokenAddress.textContent = isAddress(token) ? token : "待配置";
    const configured = isAddress(token) && isAddress(pool);

    if (!configured) {
      render();
      setStatus("分红池合约部署后，在 config.js 填入 DIVIDEND_POOL_ADDRESS 即可启用。", "warning");
      return;
    }

    if (!hasEthereum() || !state.account) {
      render();
      setStatus("连接钱包后可查看质押、权重和可领取 BNB。", "neutral");
      return;
    }

    if (state.chainId !== BSC_CHAIN_ID) {
      render();
      setStatus("当前钱包不在 BSC 主网，请先切换网络。", "warning");
      return;
    }

    const accountArg = encodeAddress(state.account);
    state.tokenBalance = await call(token, `${config.BALANCE_OF_SELECTOR}${accountArg}`);
    state.allowance = await call(token, `${config.ALLOWANCE_SELECTOR}${accountArg}${encodeAddress(pool)}`);
    state.totalStaked = await call(pool, config.POOL_TOTAL_STAKED_SELECTOR);
    state.undistributedRewards = await call(pool, config.POOL_UNDISTRIBUTED_REWARDS_SELECTOR);
    state.pendingRewards = await call(pool, `${config.POOL_PENDING_REWARDS_SELECTOR}${accountArg}`);
    state.userWeightBps = await call(pool, `${config.POOL_USER_WEIGHT_BPS_SELECTOR}${accountArg}`);
    state.nextDistributionTime = await call(pool, config.POOL_NEXT_DISTRIBUTION_SELECTOR);

    const stakeResult = await window.ethereum.request({
      method: "eth_call",
      params: [{ to: pool, data: `${config.POOL_STAKES_SELECTOR}${accountArg}` }, "latest"]
    });
    state.userStake = decodeUint(`0x${stakeResult.slice(2, 66)}`);
    render();
    setStatus("分红池数据已更新。", "success");
  }

  function render() {
    const connected = Boolean(state.account);
    const configured = isAddress(tokenAddress()) && isAddress(poolAddress());
    const onBsc = state.chainId === BSC_CHAIN_ID;
    els.connectButton.textContent = connected ? shorten(state.account) : "连接钱包";
    els.userStake.textContent = formatUnits(state.userStake, 18, 4);
    els.totalStaked.textContent = formatUnits(state.totalStaked, 18, 4);
    els.pendingRewards.textContent = formatUnits(state.pendingRewards, 18, 6);
    els.undistributedRewards.textContent = formatUnits(state.undistributedRewards, 18, 6);
    els.userWeight.textContent = `${(Number(state.userWeightBps) / 100).toFixed(2)}%`;
    els.nextDistribution.textContent = Number(state.nextDistributionTime)
      ? new Date(Number(state.nextDistributionTime) * 1000).toLocaleString("zh-CN")
      : "--";

    const disabled = !configured || !connected || !onBsc;
    els.approveButton.disabled = disabled;
    els.stakeButton.disabled = disabled;
    els.unstakeButton.disabled = disabled || state.userStake === 0n;
    els.claimButton.disabled = disabled || state.pendingRewards === 0n;
  }

  async function approve() {
    const amount = parseToken(els.stakeAmount.value);
    if (amount <= 0n) {
      setStatus("请输入授权数量。", "warning");
      return;
    }
    if (state.chainId !== BSC_CHAIN_ID) await switchToBsc();
    setBusy(els.approveButton, true, "授权中");
    try {
      const hash = await send(tokenAddress(), `${config.APPROVE_SELECTOR}${encodeAddress(poolAddress())}${encodeUint(amount)}`);
      setStatus(`授权已提交：${hash.slice(0, 10)}...${hash.slice(-8)}`, "success");
      setTimeout(refreshAll, 5000);
    } catch (error) {
      setStatus(error.message || "授权失败。", "error");
    } finally {
      setBusy(els.approveButton, false, "授权 ZMLM");
    }
  }

  async function stake() {
    const amount = parseToken(els.stakeAmount.value);
    if (amount <= 0n) {
      setStatus("请输入质押数量。", "warning");
      return;
    }
    if (amount > state.allowance) {
      setStatus("授权额度不足，请先授权 ZMLM。", "warning");
      return;
    }
    setBusy(els.stakeButton, true, "质押中");
    try {
      const hash = await send(poolAddress(), `${config.STAKE_SELECTOR}${encodeUint(amount)}`);
      setStatus(`质押已提交：${hash.slice(0, 10)}...${hash.slice(-8)}`, "success");
      setTimeout(refreshAll, 5000);
    } catch (error) {
      setStatus(error.message || "质押失败。", "error");
    } finally {
      setBusy(els.stakeButton, false, "质押");
    }
  }

  async function unstake() {
    const amount = parseToken(els.stakeAmount.value);
    const unstakeAmount = amount > 0n ? amount : state.userStake;
    if (unstakeAmount <= 0n || unstakeAmount > state.userStake) {
      setStatus("解除数量不能超过你的质押。", "warning");
      return;
    }
    setBusy(els.unstakeButton, true, "解除中");
    try {
      const hash = await send(poolAddress(), `${config.UNSTAKE_SELECTOR}${encodeUint(unstakeAmount)}`);
      setStatus(`解除质押已提交：${hash.slice(0, 10)}...${hash.slice(-8)}`, "success");
      setTimeout(refreshAll, 5000);
    } catch (error) {
      setStatus(error.message || "解除质押失败。", "error");
    } finally {
      setBusy(els.unstakeButton, false, "解除质押");
    }
  }

  async function claim() {
    setBusy(els.claimButton, true, "领取中");
    try {
      const hash = await send(poolAddress(), config.CLAIM_SELECTOR);
      setStatus(`领取已提交：${hash.slice(0, 10)}...${hash.slice(-8)}`, "success");
      setTimeout(refreshAll, 5000);
    } catch (error) {
      setStatus(error.message || "领取失败。", "error");
    } finally {
      setBusy(els.claimButton, false, "领取 BNB");
    }
  }

  function bind() {
    els.connectButton.addEventListener("click", connectWallet);
    els.approveButton.addEventListener("click", approve);
    els.stakeButton.addEventListener("click", stake);
    els.unstakeButton.addEventListener("click", unstake);
    els.claimButton.addEventListener("click", claim);
    els.stakeAmount.addEventListener("input", () => {
      els.stakeAmount.value = stripDecimal(els.stakeAmount.value);
    });

    if (hasEthereum()) {
      window.ethereum.on("accountsChanged", async (accounts) => {
        state.account = accounts[0] || "";
        await refreshAll();
      });
      window.ethereum.on("chainChanged", async (chainId) => {
        state.chainId = chainId;
        await refreshAll();
      });
    }
  }

  async function boot() {
    bind();
    render();
    if (hasEthereum()) {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      state.account = accounts[0] || "";
      state.chainId = await window.ethereum.request({ method: "eth_chainId" });
    }
    await refreshAll();
  }

  boot().catch((error) => setStatus(error.message || "分红池初始化失败。", "error"));
})();
