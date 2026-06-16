const BSC_CHAIN_ID = 56n;
const BSC_CHAIN_HEX = "0x38";
const BSC_RPC = "https://bsc-dataseed.binance.org/";
const DEFAULT_SEND_TOKEN = "BNB";

// Deploy contracts/BatchBnbDistributor.sol once, then paste the deployed
// address here. The page does not expose this address field to end users.
const BATCH_DISTRIBUTOR_ADDRESS = "0xEE2e4958449F89df6A7BaD22a98Cc59e20AE256b";

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)"
];

const BATCH_DISTRIBUTOR_ABI = [
  "function distributeBnb(address[] recipients, uint256[] amounts) payable",
  "function distributeToken(address token, address[] recipients, uint256[] amounts)"
];

let browserProvider;
let connectedSigner;
let connectedAddress = "";
let generatedWallets = [];
let sendTokenMeta = null;

const $ = (selector) => document.querySelector(selector);
const provider = new ethers.JsonRpcProvider(BSC_RPC);
const ROW_SEPARATOR = /[\s,，]+/;

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isNativeBnbSend(value) {
  const text = String(value || "").trim().toLowerCase();
  return !text || text === "bnb" || text === "native";
}

function getBatchDistributor() {
  if (!ethers.isAddress(BATCH_DISTRIBUTOR_ADDRESS)) {
    throw new Error("Batch distributor is not configured. Deploy contracts/BatchBnbDistributor.sol and set BATCH_DISTRIBUTOR_ADDRESS in app.js.");
  }
  return BATCH_DISTRIBUTOR_ADDRESS;
}

function sumBigints(values) {
  return values.reduce((sum, value) => sum + value, 0n);
}

function log(target, message) {
  const box = $(target);
  const time = new Date().toLocaleTimeString();
  box.textContent += `[${time}] ${message}\n`;
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function parseSendRows(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [address, amount] = line.split(ROW_SEPARATOR).map((item) => item.trim()).filter(Boolean);
      if (!ethers.isAddress(address)) throw new Error(`Row ${index + 1}: invalid address`);
      if (!amount || Number(amount) <= 0) throw new Error(`Row ${index + 1}: invalid amount`);
      return { address, amount };
    });
}

function addAmountToRows() {
  const amount = $("#autoAmount").value.trim();
  if (!amount || Number(amount) <= 0) {
    alert("Enter a valid amount first.");
    return;
  }

  const rows = $("#sendRows").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [address] = line.split(ROW_SEPARATOR).map((item) => item.trim()).filter(Boolean);
      if (!ethers.isAddress(address)) throw new Error(`Row ${index + 1}: invalid address`);
      return `${address},${amount}`;
    });

  if (!rows.length) {
    alert("Paste recipient addresses first.");
    return;
  }

  $("#sendRows").value = rows.join("\n");
}

function parsePrivateKeys(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((key, index) => {
      try {
        return new ethers.Wallet(key, provider);
      } catch {
        throw new Error(`Row ${index + 1}: invalid private key`);
      }
    });
}

function toCsv(rows) {
  const escapeCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const header = ["index", "address", "privateKey", "mnemonic"];
  const body = rows.map((wallet, index) => [
    index + 1,
    wallet.address,
    wallet.privateKey,
    wallet.mnemonic
  ]);
  return [header, ...body].map((row) => row.map(escapeCell).join(",")).join("\n");
}

function download(filename, text) {
  const blob = new Blob([`\uFEFF${text}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderWallets() {
  $("#walletList").innerHTML = generatedWallets
    .map((wallet, index) => `
      <div class="wallet-group">
        <div class="wallet-row">
          <div class="wallet-label">Address ${index + 1}</div>
          <div class="wallet-value">${escapeHtml(wallet.address)}</div>
          <button class="copy-btn" type="button" data-copy="${escapeHtml(wallet.address)}">Copy</button>
        </div>
        <div class="wallet-row">
          <div class="wallet-label">Mnemonic</div>
          <div class="wallet-value">${escapeHtml(wallet.mnemonic)}</div>
          <button class="copy-btn" type="button" data-copy="${escapeHtml(wallet.mnemonic)}">Copy</button>
        </div>
        <div class="wallet-row">
          <div class="wallet-label">Private key</div>
          <div class="wallet-value">${escapeHtml(wallet.privateKey)}</div>
          <button class="copy-btn" type="button" data-copy="${escapeHtml(wallet.privateKey)}">Copy</button>
        </div>
      </div>
    `)
    .join("");
  $("#walletResultHint").textContent = generatedWallets.length
    ? `Generated ${generatedWallets.length} wallets. Download and store offline.`
    : "No wallets generated";
}

async function switchToBsc() {
  if (!window.ethereum) throw new Error("No browser wallet detected.");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_HEX }]
    });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: BSC_CHAIN_HEX,
        chainName: "BNB Smart Chain",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: [BSC_RPC],
        blockExplorerUrls: ["https://bscscan.com"]
      }]
    });
  }
  browserProvider = new ethers.BrowserProvider(window.ethereum);
}

async function ensureWallet() {
  if (!window.ethereum) throw new Error("No browser wallet detected.");
  browserProvider = browserProvider || new ethers.BrowserProvider(window.ethereum);
  const network = await browserProvider.getNetwork();
  if (network.chainId !== BSC_CHAIN_ID) await switchToBsc();
  connectedSigner = await browserProvider.getSigner();
  connectedAddress = await connectedSigner.getAddress();
  $("#walletText").textContent = shortAddress(connectedAddress);
  await refreshBalance();
  return connectedSigner;
}

async function refreshBalance() {
  if (!connectedAddress) return;
  const balance = await provider.getBalance(connectedAddress);
  $("#balancePill").textContent = `${Number(ethers.formatEther(balance)).toFixed(4)} BNB`;
}

async function readToken(address, signerOrProvider = provider) {
  if (!ethers.isAddress(address)) throw new Error("Invalid token contract address.");
  const token = new ethers.Contract(address, ERC20_ABI, signerOrProvider);
  const [name, symbol, decimals] = await Promise.all([
    token.name().catch(() => ""),
    token.symbol(),
    token.decimals()
  ]);
  return { token, name, symbol, decimals: Number(decimals), address };
}

async function batchSend() {
  $("#sendLog").textContent = "";
  const rows = parseSendRows($("#sendRows").value);
  const tokenAddress = $("#sendToken").value.trim();
  const privateKey = $("#sendPrivateKey").value.trim();
  const signer = privateKey ? new ethers.Wallet(privateKey, provider) : await ensureWallet();
  const sender = privateKey ? signer.address : await signer.getAddress();
  const recipients = rows.map((row) => row.address);
  const distributorAddress = getBatchDistributor();
  const distributor = new ethers.Contract(distributorAddress, BATCH_DISTRIBUTOR_ABI, signer);

  log("#sendLog", `Sender: ${sender}`);

  if (isNativeBnbSend(tokenAddress)) {
    const amounts = rows.map((row) => ethers.parseEther(row.amount));
    const total = sumBigints(amounts);
    log("#sendLog", `One transaction BNB batch: ${rows.length} recipients, total ${ethers.formatEther(total)} BNB`);
    const tx = await distributor.distributeBnb(recipients, amounts, { value: total });
    log("#sendLog", `Submitted: ${tx.hash}`);
    await tx.wait();
    log("#sendLog", `Confirmed: ${tx.hash}`);
    await refreshBalance();
    return;
  }

  const meta = await readToken(tokenAddress, signer);
  const amounts = rows.map((row) => ethers.parseUnits(row.amount, meta.decimals));
  const total = sumBigints(amounts);
  const allowance = await meta.token.allowance(sender, distributorAddress).catch(() => 0n);

  if (allowance < total) {
    log("#sendLog", `Token approval required once for ${meta.symbol}. Approving max allowance so later batches only need the batch send transaction.`);
    const approveTx = await meta.token.approve(distributorAddress, ethers.MaxUint256);
    log("#sendLog", `Approval submitted: ${approveTx.hash}`);
    await approveTx.wait();
    log("#sendLog", `Approval confirmed: ${approveTx.hash}`);
  }

  log("#sendLog", `One transaction ${meta.symbol} batch: ${rows.length} recipients`);
  const tx = await distributor.distributeToken(meta.address, recipients, amounts);
  log("#sendLog", `Submitted: ${tx.hash}`);
  await tx.wait();
  log("#sendLog", `Confirmed: ${tx.hash}`);
  await refreshBalance();
}

async function batchCollect() {
  $("#collectLog").textContent = "";
  const target = $("#collectTarget").value.trim();
  const tokenAddress = $("#collectToken").value.trim();
  const leaveBnb = $("#leaveBnb").value || "0";
  const wallets = parsePrivateKeys($("#collectKeys").value);

  if (!ethers.isAddress(target)) throw new Error("Invalid collect target address.");
  log("#collectLog", `Collecting from ${wallets.length} wallets -> ${target}`);

  if (tokenAddress) {
    const meta = await readToken(tokenAddress, provider);
    log("#collectLog", `Collect token: ${meta.name || meta.symbol} (${meta.symbol})`);
    for (const [index, wallet] of wallets.entries()) {
      const token = meta.token.connect(wallet);
      const balance = await token.balanceOf(wallet.address);
      if (balance === 0n) {
        log("#collectLog", `${index + 1}/${wallets.length} ${wallet.address}: zero balance, skipped`);
        continue;
      }
      log("#collectLog", `${index + 1}/${wallets.length}: collect ${ethers.formatUnits(balance, meta.decimals)} ${meta.symbol}`);
      const tx = await token.transfer(target, balance);
      log("#collectLog", `Submitted: ${tx.hash}`);
      await tx.wait();
      log("#collectLog", `Confirmed: ${tx.hash}`);
    }
  } else {
    const keep = ethers.parseEther(leaveBnb);
    for (const [index, wallet] of wallets.entries()) {
      const balance = await provider.getBalance(wallet.address);
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");
      const gasCost = gasPrice * 21000n;
      const transferable = balance - keep - gasCost;
      if (transferable <= 0n) {
        log("#collectLog", `${index + 1}/${wallets.length} ${wallet.address}: insufficient balance, skipped`);
        continue;
      }
      log("#collectLog", `${index + 1}/${wallets.length}: collect ${ethers.formatEther(transferable)} BNB`);
      const tx = await wallet.sendTransaction({ to: target, value: transferable, gasLimit: 21000n, gasPrice });
      log("#collectLog", `Submitted: ${tx.hash}`);
      await tx.wait();
      log("#collectLog", `Confirmed: ${tx.hash}`);
    }
  }

  log("#collectLog", "Collect complete.");
}

document.querySelectorAll(".side-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".side-item").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    button.classList.add("active");
    $(`#view-${button.dataset.view}`).classList.add("active");
  });
});

$("#createWalletsBtn").addEventListener("click", () => {
  const count = Number($("#walletCount").value);
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    alert("Enter a wallet count between 1 and 500.");
    return;
  }
  generatedWallets = Array.from({ length: count }, () => {
    const wallet = ethers.Wallet.createRandom();
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic?.phrase || ""
    };
  });
  renderWallets();
});

$("#downloadWalletsBtn").addEventListener("click", () => {
  if (!generatedWallets.length) {
    alert("Generate wallets first.");
    return;
  }
  download(`bsc-wallets-${Date.now()}.csv`, toCsv(generatedWallets));
});

$("#clearWalletsBtn").addEventListener("click", () => {
  generatedWallets = [];
  renderWallets();
});

$("#walletList").addEventListener("click", async (event) => {
  const button = event.target.closest(".copy-btn");
  if (!button) return;
  try {
    await copyText(button.dataset.copy || "");
    const oldText = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = oldText;
    }, 900);
  } catch {
    alert("Copy failed.");
  }
});

$("#connectBtn").addEventListener("click", async () => {
  try {
    await ensureWallet();
  } catch (error) {
    alert(error.message || "Connect failed.");
  }
});

$("#switchChainBtn").addEventListener("click", async () => {
  try {
    await switchToBsc();
    await ensureWallet();
  } catch (error) {
    alert(error.message || "Switch chain failed.");
  }
});

$("#loadTokenBtn").addEventListener("click", async () => {
  try {
    if (isNativeBnbSend($("#sendToken").value)) {
      sendTokenMeta = { name: "BNB", symbol: "BNB", decimals: 18, address: "" };
      $("#sendTokenInfo").textContent = "BNB / native coin / decimals 18";
      return;
    }
    sendTokenMeta = await readToken($("#sendToken").value.trim(), provider);
    $("#sendTokenInfo").textContent = `${sendTokenMeta.name || sendTokenMeta.symbol} / ${sendTokenMeta.symbol} / decimals ${sendTokenMeta.decimals}`;
  } catch (error) {
    alert(error.message || "Read token failed.");
  }
});

$("#autoAmountBtn").addEventListener("click", () => {
  try {
    addAmountToRows();
  } catch (error) {
    alert(error.message || "Auto amount failed.");
  }
});

$("#batchSendBtn").addEventListener("click", async () => {
  try {
    await batchSend();
  } catch (error) {
    log("#sendLog", `Failed: ${error.reason || error.shortMessage || error.message || error}`);
  }
});

$("#batchCollectBtn").addEventListener("click", async () => {
  try {
    await batchCollect();
  } catch (error) {
    log("#collectLog", `Failed: ${error.reason || error.shortMessage || error.message || error}`);
  }
});

$("#fillGeneratedKeysBtn").addEventListener("click", () => {
  if (!generatedWallets.length) {
    alert("No generated wallets yet.");
    return;
  }
  $("#collectKeys").value = generatedWallets.map((wallet) => wallet.privateKey).join("\n");
});

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", () => window.location.reload());
  window.ethereum.on?.("chainChanged", () => window.location.reload());
}

if (!$("#sendToken").value.trim()) {
  $("#sendToken").value = DEFAULT_SEND_TOKEN;
}
