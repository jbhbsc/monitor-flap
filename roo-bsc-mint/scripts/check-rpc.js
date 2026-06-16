const { ethers } = require("ethers");

async function main() {
  const rpcUrl = process.env.BSC_RPC_URL || "https://bsc.publicnode.com";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const blockNumber = await provider.getBlockNumber();
  console.log(JSON.stringify({
    rpcUrl,
    chainId: Number(network.chainId),
    name: network.name,
    blockNumber
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
