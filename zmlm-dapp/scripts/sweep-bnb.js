"use strict";

const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config();

const { ethers } = require("ethers");

const DEFAULT_GAS_LIMIT = 21000n;
const DEFAULT_MIN_BALANCE = "0.00005";
const DEFAULT_RPC_URLS = [
  "https://bsc-dataseed.binance.org/",
  "https://bsc-dataseed1.binance.org/",
  "https://bsc-dataseed2.binance.org/",
  "https://bsc-dataseed3.binance.org/",
  "https://bsc-dataseed4.binance.org/",
  "https://bsc-rpc.publicnode.com",
  "https://binance.llamarpc.com"
];

function printUsage() {
  console.log(`
Batch sweep BNB from many wallets into one address.

Dry-run preview:
  npm.cmd run sweep:bnb

Execute real transfers:
  npm.cmd run sweep:bnb -- --execute

Transfer a fixed amount from each wallet:
  npm.cmd run sweep:bnb -- --amount 0.01
  npm.cmd run sweep:bnb -- --amount 0.01 --execute

Run only selected wallet numbers:
  npm.cmd run sweep:bnb -- --amount 0.01 --only 4
  npm.cmd run sweep:bnb -- --amount 0.01 --only 2,4 --execute

Required .env:
  BNB_RPC_URL=https://bsc-dataseed.binance.org/,https://bsc-dataseed1.binance.org/
  BNB_SWEEP_TO=0xYourReceiveAddress
  BNB_SWEEP_PRIVATE_KEYS=0xkey1,0xkey2

Optional .env:
  BNB_SWEEP_AMOUNT=0.01
  BNB_SWEEP_MIN_BALANCE=0.00005
  BNB_SWEEP_GAS_LIMIT=200000
`);
}

function getArgValue(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  if (index === -1) return "";
  return args[index + 1] || "";
}

function getOnlySet() {
  const raw = getArgValue("--only");
  if (!raw) return null;

  const values = raw
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);

  return values.length ? new Set(values) : null;
}

function getPrivateKeys() {
  const inlineKeys = splitPrivateKeys(process.env.BNB_SWEEP_PRIVATE_KEYS || "");
  const looseKeys = readLoosePrivateKeysFromEnvFile();
  return [...inlineKeys, ...looseKeys]
    .filter((item, index, keys) => keys.indexOf(item) === index)
    .filter((item) => !item.includes("YOUR_PRIVATE_KEY"));
}

function splitPrivateKeys(raw) {
  return String(raw || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readLoosePrivateKeysFromEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return [];

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const keys = [];
  let inPrivateKeyBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (/^BNB_SWEEP_PRIVATE_KEYS\s*=/.test(trimmed)) {
      inPrivateKeyBlock = true;
      keys.push(...splitPrivateKeys(trimmed.replace(/^BNB_SWEEP_PRIVATE_KEYS\s*=/, "")));
      continue;
    }

    if (/^[A-Z0-9_]+\s*=/.test(trimmed)) {
      inPrivateKeyBlock = false;
      continue;
    }

    if (inPrivateKeyBlock) {
      keys.push(...splitPrivateKeys(trimmed));
    }
  }

  return keys;
}

function requireAddress(value, label) {
  const clean = String(value || "").trim();
  if (!ethers.isAddress(clean)) {
    throw new Error(`${label} is not a valid address.`);
  }
  const address = ethers.getAddress(clean);
  if (address === ethers.ZeroAddress) {
    throw new Error(`${label} is still the zero address. Please set your real receive or mint contract address in .env.`);
  }
  return address;
}

function parsePositiveEther(value, label) {
  try {
    const parsed = ethers.parseEther(String(value));
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw new Error(`${label} must be a valid BNB amount.`);
  }
}

function parseGasLimit(value) {
  if (!value) return 0n;
  const parsed = BigInt(value);
  if (parsed < DEFAULT_GAS_LIMIT) {
    throw new Error("BNB_SWEEP_GAS_LIMIT must be at least 21000.");
  }
  return parsed;
}

function getRpcUrls() {
  const raw = process.env.BNB_RPC_URL || "";
  const configured = raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return [...configured, ...DEFAULT_RPC_URLS].filter((item, index, urls) => urls.indexOf(item) === index);
}

async function createWorkingProvider(rpcUrls) {
  let lastError;
  for (const rpcUrl of rpcUrls) {
    try {
      await probeRpc(rpcUrl);
      const provider = new ethers.JsonRpcProvider(rpcUrl, 56, { staticNetwork: true });
      return { provider, rpcUrl };
    } catch (error) {
      lastError = error;
      console.log(`RPC unavailable, trying next: ${rpcUrl}`);
    }
  }

  throw lastError || new Error("No BNB RPC URL configured.");
}

async function probeRpc(rpcUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: []
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data.result) {
      throw new Error(data.error ? data.error.message : "No RPC result");
    }
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    printUsage();
    return;
  }

  const execute = args.has("--execute");
  const onlySet = getOnlySet();
  const rpcUrls = getRpcUrls();
  const to = requireAddress(process.env.BNB_SWEEP_TO, "BNB_SWEEP_TO");
  const privateKeys = getPrivateKeys();
  const cliAmount = getArgValue("--amount");
  const fixedAmountRaw = cliAmount || process.env.BNB_SWEEP_AMOUNT || "";
  const fixedAmountSource = cliAmount ? "--amount" : process.env.BNB_SWEEP_AMOUNT ? ".env BNB_SWEEP_AMOUNT" : "";
  const fixedAmount = fixedAmountRaw ? parsePositiveEther(fixedAmountRaw, "BNB_SWEEP_AMOUNT/--amount") : 0n;
  const minBalance = parsePositiveEther(process.env.BNB_SWEEP_MIN_BALANCE || DEFAULT_MIN_BALANCE, "BNB_SWEEP_MIN_BALANCE");
  const configuredGasLimit = parseGasLimit(process.env.BNB_SWEEP_GAS_LIMIT);

  if (!privateKeys.length) {
    throw new Error("BNB_SWEEP_PRIVATE_KEYS is empty.");
  }

  const { provider, rpcUrl } = await createWorkingProvider(rpcUrls);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits("1", "gwei");

  console.log(execute ? "Mode: EXECUTE real transfers" : "Mode: DRY RUN preview only");
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Receive address: ${to}`);
  console.log(`Wallet count: ${privateKeys.length}`);
  if (onlySet) console.log(`Only wallet numbers: ${[...onlySet].join(", ")}`);
  console.log(`Gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  console.log(configuredGasLimit > 0n ? `Gas limit: ${configuredGasLimit.toString()}` : "Gas limit: auto estimate per wallet");
  console.log(`Keep minimum balance: ${ethers.formatEther(minBalance)} BNB`);
  console.log(fixedAmount > 0n ? `Transfer amount per wallet: ${ethers.formatEther(fixedAmount)} BNB (${fixedAmountSource})` : "Transfer amount per wallet: all available balance after gas + reserve");
  console.log("");

  let sentCount = 0;
  let failedCount = 0;
  let totalSweep = 0n;

  for (const [index, privateKey] of privateKeys.entries()) {
    const walletNumber = index + 1;
    if (onlySet && !onlySet.has(walletNumber)) {
      continue;
    }

    let wallet;
    try {
      wallet = new ethers.Wallet(privateKey, provider);
    } catch {
      console.log(`[${walletNumber}] Invalid private key, skipped.`);
      continue;
    }

    const from = await wallet.getAddress();
    const balance = await provider.getBalance(from);
    const previewValue = fixedAmount > 0n ? fixedAmount : balance;
    const gasLimit = configuredGasLimit > 0n ? configuredGasLimit : await estimateTransferGas(wallet, to, previewValue);
    const gasCost = gasPrice * gasLimit;
    const reserved = gasCost + minBalance;

    console.log(`[${walletNumber}] ${from}`);
    console.log(`  Balance: ${ethers.formatEther(balance)} BNB`);
    console.log(`  Gas limit: ${gasLimit.toString()}`);

    if (from.toLowerCase() === to.toLowerCase()) {
      console.log("  Skipped: source is the receive address.");
      continue;
    }

    const needed = fixedAmount > 0n ? fixedAmount + gasCost + minBalance : reserved;
    if (balance < needed) {
      console.log(`  Skipped: balance is not enough for amount + gas + minimum reserve.`);
      continue;
    }

    const value = fixedAmount > 0n ? fixedAmount : balance - reserved;
    console.log(`  Transfer amount: ${ethers.formatEther(value)} BNB`);

    if (!execute) {
      totalSweep += value;
      continue;
    }

    try {
      const tx = await wallet.sendTransaction({
        to,
        value,
        gasLimit,
        gasPrice
      });

      console.log(`  Sent: ${tx.hash}`);
      await tx.wait();
      console.log("  Confirmed.");
      sentCount += 1;
      totalSweep += value;
    } catch (error) {
      failedCount += 1;
      console.log(`  Failed: ${formatTxError(error)}`);
      if (String(error.message || "").includes("already known")) {
        console.log("  The transaction may already be pending or broadcast. Check the wallet address on BscScan before retrying.");
      }
    }
  }

  console.log("");
  console.log(`Total sweep amount: ${ethers.formatEther(totalSweep)} BNB`);
  if (execute) {
    console.log(`Confirmed transfers: ${sentCount}`);
    console.log(`Failed transfers: ${failedCount}`);
  } else {
    console.log("Dry run complete. Add --execute to send real transactions.");
  }
}

function formatTxError(error) {
  const message = error.info && error.info.error && error.info.error.message
    ? error.info.error.message
    : error.shortMessage || error.reason || error.message || String(error);
  return message.length > 300 ? `${message.slice(0, 300)}...` : message;
}

async function estimateTransferGas(wallet, to, value) {
  try {
    const estimated = await wallet.estimateGas({ to, value });
    return (estimated * 130n) / 100n;
  } catch (error) {
    const reason = error.reason || error.shortMessage || error.message || "estimate failed";
    console.log(`  Gas estimate failed: ${reason}`);
    console.log("  Falling back to gas limit 200000. If this still fails, inspect the contract mint requirements.");
    return 200000n;
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message || error}`);
  process.exitCode = 1;
});
