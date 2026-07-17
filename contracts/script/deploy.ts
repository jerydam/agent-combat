import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const baseURI =
    process.env.METADATA_BASE_URI ?? "https://api.agentarena.example/metadata/";
  const gameServer = process.env.GAME_SERVER_ADDRESS ?? deployer.address;

  const nft = await (await ethers.getContractFactory("AgentNFT")).deploy(baseURI);
  await nft.waitForDeployment();
  const nftAddr = await nft.getAddress();
  console.log("AgentNFT:      ", nftAddr);

  const arena = await (await ethers.getContractFactory("BattleArena")).deploy(nftAddr, gameServer);
  await arena.waitForDeployment();
  console.log("BattleArena:   ", await arena.getAddress());

  const solo = await (await ethers.getContractFactory("SoloArena")).deploy(nftAddr, gameServer);
  await solo.waitForDeployment();
  console.log("SoloArena:     ", await solo.getAddress());

  const league = await (await ethers.getContractFactory("League")).deploy(nftAddr, gameServer);
  await league.waitForDeployment();
  console.log("League:        ", await league.getAddress());

  const tournament = await (await ethers.getContractFactory("Tournament")).deploy(nftAddr, gameServer);
  await tournament.waitForDeployment();
  console.log("Tournament:    ", await tournament.getAddress());

  const market = await (await ethers.getContractFactory("Marketplace")).deploy(nftAddr);
  await market.waitForDeployment();
  console.log("Marketplace:   ", await market.getAddress());

  // Authorize every battle-recording contract on the NFT
  for (const c of [arena, solo]) {
    await (await nft.setArena(await c.getAddress(), true)).wait();
  }
  console.log("Arenas authorized (BattleArena, SoloArena)");
  console.log("\nNext: mint house bots with nft.mintAgent(...), then solo.setBot(id, true), and solo.fundVault({value}) for staked play.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
