const fs = require("fs");
const path = require("path");
const os = require("os");
const { ethers } = require("ethers");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function findSolcModule() {
  try {
    return require("solc");
  } catch (_error) {}
  const cacheRoot = path.join(os.homedir(), "AppData", "Local", "npm-cache", "_npx");
  const dirs = fs.existsSync(cacheRoot) ? fs.readdirSync(cacheRoot, { withFileTypes: true }) : [];
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const candidate = path.join(cacheRoot, dirent.name, "node_modules", "solc");
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }
  throw new Error("Cannot find solc module");
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function compileContract(solc, contractPath) {
  const source = fs.readFileSync(contractPath, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "RooMintToken.sol": { content: source }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"]
        }
      }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors && output.errors.length) {
    const fatal = output.errors.filter((item) => item.severity === "error");
    if (fatal.length) {
      throw new Error(fatal.map((item) => item.formattedMessage).join("\n"));
    }
  }
  return output.contracts["RooMintToken.sol"].SquidToken;
}

async function main() {
  loadEnvFile(path.join(__dirname, "..", ".env"));
  const rpcUrl = process.env.BSC_RPC_URL || "https://bsc.publicnode.com";
  const privateKey = requireEnv("PRIVATE_KEY");
  const tokenName = process.env.TOKEN_NAME || "SquidToken";
  const tokenSymbol = process.env.TOKEN_SYMBOL || "SQUID";
  const ownerAddress = process.env.OWNER_ADDRESS || process.env.INITIAL_OWNER || "";
  const dividendPoolWallet = process.env.DIVIDEND_POOL_WALLET || process.env.MARKETING_WALLET || "0xe0591EF1783a61A7153E9FC367B9C526D80b2463";
  const ecosystemWallet = process.env.ECOSYSTEM_WALLET || process.env.PLATFORM_MARKETING_WALLET || "0xe0591EF1783a61A7153E9FC367B9C526D80b2463";

  const solc = findSolcModule();
  const artifact = compileContract(solc, path.join(__dirname, "..", "contracts", "RooMintToken.sol"));
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const owner = ownerAddress || wallet.address;
  const factory = new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, wallet);
  const contract = await factory.deploy(
    tokenName,
    tokenSymbol,
    owner,
    dividendPoolWallet,
    ecosystemWallet
  );
  console.log("deploy tx:", contract.deploymentTransaction().hash);
  await contract.waitForDeployment();
  console.log("token:", await contract.getAddress());
  console.log("name:", tokenName);
  console.log("symbol:", tokenSymbol);
  console.log("owner:", owner);
  console.log("dividend pool wallet:", dividendPoolWallet);
  console.log("ecosystem wallet:", ecosystemWallet);
  console.log("pancake pair:", await contract.pancakePair());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
