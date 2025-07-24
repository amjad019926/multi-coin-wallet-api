import express from "express";
import cors from "cors";
import * as bip39 from "bip39";
import * as bip32 from "bip32";
import * as bitcoin from "bitcoinjs-lib";
import { ethers, HDNodeWallet } from "ethers";
import TronWeb from "tronweb";
import {
  Keypair,
  Connection,
  PublicKey,
} from "@solana/web3.js";
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

const usdtContracts = {
  eth: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  bnb: "0x55d398326f99059fF775485246999027B3197955",
  trx: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"
};

// Generate Wallet
app.post("/wallet", async (req, res) => {
  const { coin, index = 0 } = req.body;
  const mnemonic = bip39.generateMnemonic();
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const node = bip32.fromSeed(seed);

  let address = "";
  if (coin === "btc" || coin === "ltc") {
    const network = coin === "ltc" ? bitcoin.networks.litecoin : bitcoin.networks.bitcoin;
    const child = node.derivePath(pathMap[coin]);
    const { address: addr } = bitcoin.payments.p2wpkh({
      pubkey: child.publicKey,
      network
    });
    address = addr;
  } else if (coin === "eth" || coin === "bnb" || coin === "usdt") {
    const hd = HDNodeWallet.fromPhrase(mnemonic).derivePath(`44'/60'/0'/0/${index}`);
    address = hd.address;
  } else if (coin === "trx") {
    const tron = node.derivePath(pathMap.trx + `/${index}`);
    const pk = tron.privateKey.toString("hex");
    const tw = new TronWeb();
    address = tw.address.fromPrivateKey(pk);
  } else if (coin === "sol") {
    const key = Keypair.fromSeed(seed.slice(0, 32));
    address = key.publicKey.toBase58();
  }

  res.json({ mnemonic, coin, index, address });
});

// Native Coin Balance
app.get("/balance/:coin/:address", async (req, res) => {
  const { coin, address } = req.params;
  try {
    if (coin === "btc" || coin === "ltc") {
      const url = coin === "btc"
        ? `https://blockstream.info/api/address/${address}`
        : `https://blockstream.info/ltc/api/address/${address}`;
      const { data } = await axios.get(url);
      return res.json({ balance: data.chain_stats.funded_txo_sum / 1e8 - data.chain_stats.spent_txo_sum / 1e8 });
    }
    if (coin === "eth" || coin === "bnb") {
      const rpc = coin === "eth" ? "https://ethereum.publicnode.com" : "https://bsc.publicnode.com";
      const provider = new ethers.JsonRpcProvider(rpc);
      const balance = await provider.getBalance(address);
      return res.json({ balance: ethers.formatEther(balance) });
    }
    if (coin === "trx") {
      const tronWeb = new TronWeb({ fullHost: "https://api.trongrid.io" });
      const balance = await tronWeb.trx.getBalance(address);
      return res.json({ balance: balance / 1e6 });
    }
    if (coin === "sol") {
      const conn = new Connection("https://api.mainnet-beta.solana.com");
      const lamports = await conn.getBalance(new PublicKey(address));
      return res.json({ balance: lamports / 1e9 });
    }
    res.status(400).json({ error: "Unsupported coin" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// USDT Token Balance
app.get("/balance/usdt/:network/:address", async (req, res) => {
  const { network, address } = req.params;
  try {
    if (network === "trx") {
      const tronWeb = new TronWeb({ fullHost: "https://api.trongrid.io" });
      const contract = await tronWeb.contract().at(usdtContracts.trx);
      const result = await contract.balanceOf(address).call();
      return res.json({ balance: parseFloat(result) / 1e6 });
    }
    if (["eth", "bnb"].includes(network)) {
      const rpc = network === "eth" ? "https://ethereum.publicnode.com" : "https://bsc.publicnode.com";
      const provider = new ethers.JsonRpcProvider(rpc);
      const abi = ["function balanceOf(address) view returns (uint256)"];
      const contract = new ethers.Contract(usdtContracts[network], abi, provider);
      const bal = await contract.balanceOf(address);
      return res.json({ balance: parseFloat(ethers.formatUnits(bal, 6)) });
    }
    res.status(400).json({ error: "Unsupported network" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Transaction History
app.get("/txs/:coin/:address", async (req, res) => {
  const { coin, address } = req.params;
  try {
    if (coin === "btc") {
      const { data } = await axios.get(`https://blockstream.info/api/address/${address}/txs`);
      return res.json(data);
    }
    if (coin === "ltc") {
      const { data } = await axios.get(`https://blockstream.info/ltc/api/address/${address}/txs`);
      return res.json(data);
    }
    if (coin === "eth") {
      const { data } = await axios.get(`https://api.etherscan.io/api?module=account&action=txlist&address=${address}&sort=desc&apikey=YourApiKey`);
      return res.json(data.result);
    }
    if (coin === "bnb") {
      const { data } = await axios.get(`https://api.bscscan.com/api?module=account&action=txlist&address=${address}&sort=desc&apikey=YourApiKey`);
      return res.json(data.result);
    }
    if (coin === "trx") {
      const { data } = await axios.get(`https://api.trongrid.io/v1/accounts/${address}/transactions`);
      return res.json(data.data);
    }
    if (coin === "sol") {
      const conn = new Connection("https://api.mainnet-beta.solana.com");
      const sigs = await conn.getConfirmedSignaturesForAddress2(new PublicKey(address));
      return res.json(sigs);
    }
    res.status(400).json({ error: "Unsupported coin" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fee Estimate
app.get("/fee/:coin", async (req, res) => {
  const { coin } = req.params;
  try {
    if (coin === "eth" || coin === "bnb") {
      const provider = new ethers.JsonRpcProvider(
        coin === "eth" ? "https://ethereum.publicnode.com" : "https://bsc.publicnode.com"
      );
      const fee = await provider.getFeeData();
      return res.json({ gasPrice: ethers.formatUnits(fee.gasPrice, "gwei") + " gwei" });
    }
    if (coin === "trx") {
      const tronWeb = new TronWeb({ fullHost: "https://api.trongrid.io" });
      const bandwidth = await tronWeb.trx.getBandwidth("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf");
      return res.json({ bandwidth });
    }
    if (coin === "btc" || coin === "ltc") {
      const url = `https://mempool.space${coin === 'ltc' ? '/litecoin' : ''}/api/v1/fees/recommended`;
      const { data } = await axios.get(url);
      return res.json({ fastestFee: data.fastestFee + " sat/vB" });
    }
    if (coin === "sol") {
      return res.json({ fee: "0.000005 SOL (fixed)" });
    }
    res.status(400).json({ error: "Unsupported coin" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Dashboard Summary
app.get("/dashboard/:coin/:address", async (req, res) => {
  const { coin, address } = req.params;
  try {
    const result = { coin, address, balance: 0, usdt: 0, txs: [] };
    const balanceRes = await axios.get(`https://multi-coin-wallet-api.onrender.com/balance/${coin}/${address}`);
    result.balance = balanceRes.data.balance;
    if (["eth", "bnb", "trx"].includes(coin)) {
      const usdtRes = await axios.get(`https://multi-coin-wallet-api.onrender.com/balance/usdt/${coin}/${address}`);
      result.usdt = usdtRes.data.balance;
    }
    const txRes = await axios.get(`https://multi-coin-wallet-api.onrender.com/txs/${coin}/${address}`);
    result.txs = txRes.data?.slice(0, 5) || [];
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send Tokens or Native Coins
app.post("/send", async (req, res) => {
  const { mnemonic, coin, network, to, amount, index = 0 } = req.body;
  try {
    if (coin === "usdt" && ["eth", "bnb"].includes(network)) {
      const provider = new ethers.JsonRpcProvider(
        network === "eth"
          ? "https://ethereum.publicnode.com"
          : "https://bsc.publicnode.com"
      );
      const hd = HDNodeWallet.fromPhrase(mnemonic).derivePath(`44'/60'/0'/0/${index}`);
      const signer = new ethers.Wallet(hd.privateKey, provider);
      const usdt = new ethers.Contract(usdtContracts[network], ["function transfer(address,uint256) returns (bool)"], signer);
      const tx = await usdt.transfer(to, ethers.parseUnits(amount, 6));
      return res.json({ hash: tx.hash });
    }

    if (coin === "usdt" && network === "trx") {
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const node = bip32.fromSeed(seed);
      const child = node.derivePath(pathMap.trx + `/${index}`);
      const privateKey = child.privateKey.toString("hex");
      const tronWeb = new TronWeb({ fullHost: "https://api.trongrid.io", privateKey });
      const contract = await tronWeb.contract().at(usdtContracts.trx);
      const result = await contract.transfer(to, amount * 1e6).send();
      return res.json({ hash: result });
    }

    if (["eth", "bnb"].includes(coin)) {
      const provider = new ethers.JsonRpcProvider(
        coin === "eth"
          ? "https://ethereum.publicnode.com"
          : "https://bsc.publicnode.com"
      );
      const hd = HDNodeWallet.fromPhrase(mnemonic).derivePath(`44'/60'/0'/0/${index}`);
      const signer = new ethers.Wallet(hd.privateKey, provider);
      const tx = await signer.sendTransaction({
        to,
        value: ethers.parseEther(amount)
      });
      return res.json({ hash: tx.hash });
    }

    if (coin === "trx") {
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const node = bip32.fromSeed(seed);
      const child = node.derivePath(pathMap.trx + `/${index}`);
      const tronWeb = new TronWeb({
        fullHost: "https://api.trongrid.io",
        privateKey: child.privateKey.toString("hex")
      });
      const tx = await tronWeb.trx.sendTransaction(to, amount * 1e6);
      return res.json({ hash: tx.txID });
    }

    res.status(400).json({ error: "Unsupported transfer type" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start Server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Wallet API running on port", port));
