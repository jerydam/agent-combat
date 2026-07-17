import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // BOT Chain mainnet — chainId 677, gas token BOT, explorer scan.botchain.ai
    botchain: {
      url: process.env.BOTCHAIN_RPC ?? "",
      chainId: 677,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    // Testnet: grab RPC + chainId from dev-docs.botchain.ai, fund via
    // faucet.botchain.ai, then fill these in .env
    botchainTestnet: {
      url: process.env.BOTCHAIN_TESTNET_RPC ?? "",
      chainId: Number(process.env.BOTCHAIN_TESTNET_CHAIN_ID ?? 0),
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};

export default config;
