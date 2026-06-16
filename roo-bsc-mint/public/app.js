const config = window.TOKEN_CONFIG || {};
const $ = (selector) => document.querySelector(selector);

const BSC_CHAIN_ID_HEX = "0x38";
const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function pancakePair() view returns (address)",
  "function dividendPoolWallet() view returns (address)",
  "function ecosystemWallet() view returns (address)",
  "function withdrawableDividendOf(address) view returns (uint256)",
  "function dividendBalanceOf(address) view returns (uint256)",
  "function totalDividendsDeposited() view returns (uint256)",
  "function dividendReserve() view returns (uint256)",
  "function tradingEnabled() view returns (bool)",
  "function claimDividends() returns (uint256)"
];

let wallet = "";
let provider = null;
let signer = null;

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function setVisible(selector, visible) {
  const node = $(selector);
  if (node) node.classList.toggle("is-hidden", !visible);
}

function shortAddress(value) {
  const text = String(value || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) return "";
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function formatBnb(value) {
  try {
    return `${Number(ethers.formatEther(value)).toLocaleString(undefined, {
      maximumFractionDigits: 6
    })} BNB`;
  } catch (_error) {
    return "-- BNB";
  }
}

async function getBnbBalance(provider, address) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address || "")) return 0n;
  return provider.getBalance(address).catch(() => 0n);
}

function formatToken(value, symbol) {
  try {
    return `${Number(ethers.formatEther(value)).toLocaleString(undefined, {
      maximumFractionDigits: 4
    })} ${symbol || "SQUID"}`;
  } catch (_error) {
    return `-- ${symbol || "SQUID"}`;
  }
}

function setStatus(message) {
  setText("#statusText", message);
}

async function copyTokenAddress() {
  if (!hasTokenAddress()) {
    setStatus("暂无可复制的合约地址。");
    return;
  }
  await navigator.clipboard.writeText(config.tokenAddress);
  setStatus("合约地址已复制。");
}

function hasTokenAddress() {
  return /^0x[a-fA-F0-9]{40}$/.test(config.tokenAddress || "");
}

function getReadProvider() {
  if (provider) return provider;
  if (window.ethereum) return new ethers.BrowserProvider(window.ethereum);
  return new ethers.JsonRpcProvider(config.rpcUrl || "https://bsc.publicnode.com");
}

function getToken(readOrSigner) {
  if (!hasTokenAddress()) {
    throw new Error("请先在 config.js 填入 SquidToken 合约地址。");
  }
  return new ethers.Contract(config.tokenAddress, TOKEN_ABI, readOrSigner);
}

async function ensureBsc() {
  if (!window.ethereum) throw new Error("未检测到钱包。");
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (chainId === BSC_CHAIN_ID_HEX) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_ID_HEX }]
    });
  } catch (error) {
    if (error && error.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: BSC_CHAIN_ID_HEX,
          chainName: "BNB Smart Chain",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: [config.rpcUrl || "https://bsc.publicnode.com"],
          blockExplorerUrls: ["https://bscscan.com"]
        }]
      });
      return;
    }
    throw error;
  }
}

async function connectWallet() {
  await ensureBsc();
  provider = new ethers.BrowserProvider(window.ethereum);
  const accounts = await provider.send("eth_requestAccounts", []);
  wallet = accounts[0] || "";
  signer = await provider.getSigner();
  $("#connectButton").textContent = shortAddress(wallet);
  await refreshData();
}

async function refreshData() {
  if (!hasTokenAddress()) {
    setStatus("请先在 config.js 填入 SquidToken 合约地址。");
    updateStaticConfig();
    return;
  }

  const readProvider = getReadProvider();
  const token = getToken(readProvider);
  const symbol = config.tokenSymbol || await token.symbol().catch(() => "SQUID");

  const [
    tokenName,
    tokenSymbol,
    dividendReserve,
    tradingEnabled
  ] = await Promise.all([
    token.name().catch(() => config.tokenName || "SquidToken"),
    token.symbol().catch(() => symbol),
    token.dividendReserve().catch(() => getBnbBalance(readProvider, config.tokenAddress)),
    token.tradingEnabled().catch(() => false)
  ]);

  setText("#tokenNameLabel", tokenName);
  setVisible("#tokenNameRow", true);
  setText("#tokenAddressLabel", shortAddress(config.tokenAddress));
  setVisible("#tokenContractRow", false);
  setText("#totalDividendsLabel", formatBnb(dividendReserve));
  setText("#tradingStatusLabel", tradingEnabled ? "已开启" : "未开启");

  if (!wallet) {
    setText("#claimableAmount", "-- BNB");
    setText("#walletBalanceLabel", `-- ${tokenSymbol}`);
    setText("#dividendBalanceLabel", `-- ${tokenSymbol}`);
    setStatus("连接钱包后读取你的分红。");
    return;
  }

  const [claimable, balance, dividendBalance] = await Promise.all([
    token.withdrawableDividendOf(wallet).catch(() => 0n),
    token.balanceOf(wallet).catch(() => 0n),
    token.dividendBalanceOf(wallet).catch(() => 0n)
  ]);

  setText("#claimableAmount", formatBnb(claimable));
  setText("#walletBalanceLabel", formatToken(balance, tokenSymbol));
  setText("#dividendBalanceLabel", formatToken(dividendBalance, tokenSymbol));
  setStatus("分红数据已更新。");
}

function updateStaticConfig() {
  setText("#tokenNameLabel", "");
  setVisible("#tokenNameRow", false);
  setText("#tokenAddressLabel", "");
  setVisible("#tokenContractRow", false);
}

async function claimDividends() {
  if (!wallet) await connectWallet();
  if (!signer) signer = await provider.getSigner();
  const token = getToken(signer);
  setStatus("正在发起分红领取交易...");
  const tx = await token.claimDividends();
  setStatus(`交易已提交：${tx.hash}`);
  await tx.wait();
  setStatus("分红已领取到钱包。");
  await refreshData();
}

function bindEvents() {
  $("#connectButton").addEventListener("click", () => {
    connectWallet().catch((error) => setStatus(error.message || "连接钱包失败。"));
  });
  $("#claimButton").addEventListener("click", () => {
    claimDividends().catch((error) => setStatus(error.shortMessage || error.message || "领取失败。"));
  });
  $("#copyTokenAddressButton").addEventListener("click", () => {
    copyTokenAddress().catch(() => setStatus("复制失败，请手动复制。"));
  });

  if (window.ethereum && typeof window.ethereum.on === "function") {
    window.ethereum.on("accountsChanged", async (accounts) => {
      wallet = accounts && accounts[0] ? accounts[0] : "";
      signer = null;
      $("#connectButton").textContent = wallet ? shortAddress(wallet) : "连接钱包";
      await refreshData().catch(() => {});
    });
    window.ethereum.on("chainChanged", () => {
      window.location.reload();
    });
  }
}

updateStaticConfig();
bindEvents();
refreshData().catch((error) => setStatus(error.message || "读取链上数据失败。"));
