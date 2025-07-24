// multi-coin-wallet-api/server.js

import express from "express";
import cors from "cors";
import * as bip39 from "bip39";
import * as bip32 from "bip32";
import * as bitcoin from "bitcoinjs-lib";
import { ethers, HDNodeWallet } from "ethers";
import TronWeb from "tronweb";
import { Keypair, Connection, SystemProgram, Transaction, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

const pathMap = {
  btc: "m/84'/0'/0'/0",
  ltc: "m/84'/2'/0'/0",
  eth: "m/44'/60'/0'/0",
  bnb: "m/44'/60'/0'/0",
  usdt: "m/44'/60'/0'/0",
  trx: "m/44'/195'/0'/0",
  sol: "m/44'/501'/0'/0'"
};

app.post("/wallet", async (req, res) => {
  const { mnemonic, coin, index = 0 } = req.body;
  if (!bip39.validateMnemonic(mnemonic)) return res.status(400).json({ error: "Invalid mnemonic" });

  const seed = await bip39.mnemonicToSeed(mnemonic);
  const path = pathMap[coin];
  if (!path) return res.status(400).json({ error: "Unsupported coin" });
  const root = bip32.fromSeed(seed);
  const child = root.derivePath(`${path}/${index}`);

  if (coin === "btc" || coin === "ltc") {
    const network = coin === "ltc"
      ? { ...bitcoin.networks.bitcoin, bech32: 'ltc', pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 }
      : bitcoin.networks.bitcoin;
    const { address } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network });
    return res.json({ coin, address, privateKey: child.toWIF(), publicKey: child.publicKey.toString("hex") });
  }

  if (["eth", "bnb", "usdt"].includes(coin)) {
    const wallet = HDNodeWallet.fromSeed(seed).derivePath(`${path}/${index}`);
    return res.json({ coin, address: wallet.address, privateKey: wallet.privateKey, publicKey: wallet.publicKey });
  }

  if (coin === "trx") {
    const tronWeb = new TronWeb();
    const addr = tronWeb.address.fromPrivateKey(child.privateKey.toString("hex"));
    return res.json({ coin, address: addr, privateKey: child.privateKey.toString("hex"), publicKey: child.publicKey.toString("hex") });
  }

  if (coin === "sol") {
    const keypair = Keypair.fromSeed(child.privateKey.slice(0, 32));
    return res.json({ coin, address: keypair.publicKey.toBase58(), privateKey: Buffer.from(keypair.secretKey).toString("hex") });
  }

  res.status(400).json({ error: "Unsupported coin" });
});

app.get("/balance/:coin/:address", async (req, res) => {
  const { coin, address } = req.params;
  try {
    if (coin === "btc" || coin === "ltc") {
      const url = `https://blockstream.info/${coin === 'ltc' ? 'ltc/' : ''}api/address/${address}`;
      const { data } = await axios.get(url);
      const balance = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 1e8;
      return res.json({ balance });
    }

    if (coin === "eth") {
      const provider = new ethers.JsonRpcProvider("https://ethereum.publicnode.com");
      const bal = await provider.getBalance(address);
      return res.json({ balance: ethers.formatEther(bal) });
    }

    if (coin === "bnb") {
      const provider = new ethers.JsonRpcProvider("https://bsc.publicnode.com");
      const bal = await provider.getBalance(address);
      return res.json({ balance: ethers.formatEther(bal) });
    }

    if (coin === "trx") {
      const { data } = await axios.get(`https://api.trongrid.io/v1/accounts/${address}`);
      const balance = data.data?.[0]?.balance || 0;
      return res.json({ balance: balance / 1e6 });
    }

    if (coin === "sol") {
      const conn = new Connection("https://api.mainnet-beta.solana.com");
      const bal = await conn.getBalance(new PublicKey(address));
      return res.json({ balance: bal / 1e9 });
    }

    res.status(400).json({ error: "Unsupported coin" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Wallet API running on port", port));
