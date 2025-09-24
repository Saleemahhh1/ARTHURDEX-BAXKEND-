// server.js
// Node >= 18, package.json must have "type": "module"

import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import mongoose from "mongoose";
import {
  Client,
  AccountId,
  PrivateKey,
  Hbar,
  TransferTransaction,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenAssociateTransaction,
  TokenInfoQuery,
  AccountBalanceQuery,
  TokenType,
  TokenSupplyType
} from "@hashgraph/sdk";
import dotenv from "dotenv";

dotenv.config();

const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || "change_me";
const MONGO_URI = process.env.MONGO_URI || "";
const HEDERA_OPERATOR_ID = process.env.HEDERA_OPERATOR_ID || "";
const HEDERA_OPERATOR_KEY = process.env.HEDERA_OPERATOR_KEY || "";
const MIRROR_NODE = process.env.MIRROR_NODE_URL || "https://testnet.mirrornode.hedera.com";
const COINGECKO_IDS = process.env.COINGECKO_IDS || "hedera-hashgraph"; // coin ids comma separated
const PRICE_UPDATE_INTERVAL_MS = Number(process.env.PRICE_UPDATE_INTERVAL_MS || 60_000);

// ---------- Mongoose models ----------
const mongoConnect = async () => {
  if (!MONGO_URI) {
    console.warn("MONGO_URI not set — running without persistent DB (will fallback to memory).");
    return;
  }
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log("MongoDB connected");
};

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: String,
  passphrase: String,
  accounts: [{
    accountId: String,
    privateKeyEncrypted: String, // optional (avoid storing plain keys)
    passphrase: String,
    hbar: { type: Number, default: 0 },
    metadata: mongoose.Schema.Types.Mixed
  }],
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model("User", userSchema);

const txSchema = new mongoose.Schema({
  accountId: String,
  type: String,
  tokenId: String,
  amount: Number,
  status: String,
  transactionId: String,
  metadata: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.models.Transaction || mongoose.model("Transaction", txSchema);

const priceSchema = new mongoose.Schema({
  coinId: String,
  usd: Number,
  change_24h: Number,
  updatedAt: { type: Date, default: Date.now }
});
const Price = mongoose.models.Price || mongoose.model("Price", priceSchema);

// In-memory fallback storage (if no Mongo)
const memoryStore = { users: new Map(), txs: [] };

// ---------- Hedera client ----------
let hederaClient = null;
try {
  if (HEDERA_OPERATOR_ID && HEDERA_OPERATOR_KEY) {
    hederaClient = Client.forTestnet();
    hederaClient.setOperator(AccountId.fromString(HEDERA_OPERATOR_ID), PrivateKey.fromString(HEDERA_OPERATOR_KEY));
    console.log("Hedera client initialized (testnet)");
  } else {
    console.warn("HEDERA_OPERATOR_* not set — HTS operations requiring server operator will fail.");
  }
} catch (err) {
  console.error("Hedera client init error:", err);
  hederaClient = null;
}

// ---------- Express setup ----------
const app = express();
app.use(cors({ origin: "*" })); // allow any origin for frontend access
app.use(express.json({ limit: "300kb" }));
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

/* ---------- Auth helpers ---------- */
function genToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: "3h" });
}
async function hashPassword(pw) {
  return bcrypt.hash(pw, 12);
}
async function comparePassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

async function authMiddleware(req, res, next) {
  try {
    const a = req.headers.authorization || "";
    if (!a) return res.status(401).json({ error: "Missing Authorization header" });
    const token = a.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Malformed Authorization header" });
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data;
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* ---------- Health ---------- */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "ArthurDex Backend (HTS + Mongo + Price Cache)",
    hedera: !!hederaClient ? "enabled" : "disabled",
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString()
  });
});

/* ---------- Auth routes ---------- */
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password, passphrase } = req.body;
    if (!username || !password || !passphrase) return res.status(400).json({ error: "Missing fields" });

    if (MONGO_URI) {
      const exists = await User.findOne({ username }).exec();
      if (exists) return res.status(400).json({ error: "User exists" });
      const hash = await hashPassword(password);
      const u = new User({ username, passwordHash: hash, passphrase, accounts: [] });
      await u.save();
      return res.json({ success: true, token: genToken(username) });
    } else {
      if (memoryStore.users.has(username)) return res.status(400).json({ error: "User exists" });
      const hash = await hashPassword(password);
      memoryStore.users.set(username, { username, passwordHash: hash, passphrase, accounts: [] });
      return res.json({ success: true, token: genToken(username) });
    }
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (MONGO_URI) {
      const u = await User.findOne({ username }).exec();
      if (!u) return res.status(400).json({ error: "Invalid credentials" });
      const ok = await comparePassword(password, u.passwordHash);
      if (!ok) return res.status(400).json({ error: "Invalid credentials" });
      return res.json({ success: true, token: genToken(username) });
    } else {
      const u = memoryStore.users.get(username);
      if (!u) return res.status(400).json({ error: "Invalid credentials" });
      const ok = await comparePassword(password, u.passwordHash);
      if (!ok) return res.status(400).json({ error: "Invalid credentials" });
      return res.json({ success: true, token: genToken(username) });
    }
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/recover", async (req, res) => {
  try {
    const { passphrase } = req.body;
    if (!passphrase) return res.status(400).json({ error: "Missing passphrase" });
    if (MONGO_URI) {
      const u = await User.findOne({ passphrase }).exec();
      if (!u) return res.status(400).json({ error: "Invalid passphrase" });
      return res.json({ success: true, token: genToken(u.username) });
    } else {
      for (let [k, v] of memoryStore.users.entries()) {
        if (v.passphrase === passphrase) {
          return res.json({ success: true, token: genToken(k) });
        }
      }
      return res.status(400).json({ error: "Invalid passphrase" });
    }
  } catch (err) {
    console.error("recover error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/verify-password", authMiddleware, async (req, res) => {
  try {
    const { password } = req.body;
    const username = req.user?.username;
    if (!username) return res.status(400).json({ error: "No user" });
    if (MONGO_URI) {
      const u = await User.findOne({ username }).exec();
      if (!u) return res.status(400).json({ error: "User not found" });
      const ok = await comparePassword(password, u.passwordHash);
      return res.json({ success: ok });
    } else {
      const u = memoryStore.users.get(username);
      if (!u) return res.status(400).json({ error: "User not found" });
      const ok = await comparePassword(password, u.passwordHash);
      return res.json({ success: ok });
    }
  } catch (err) {
    console.error("verify-password error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ---------- Transactions (store/retrieve) ---------- */
app.get("/api/transactions/:accountId", authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.params;
    const limit = Number(req.query.limit || 50);
    if (MONGO_URI) {
      const txs = await Transaction.find({ accountId }).sort({ createdAt: -1 }).limit(limit).exec();
      return res.json({ accountId, transactions: txs });
    } else {
      const txs = memoryStore.txs.filter(t => t.accountId === accountId).slice(0, limit);
      return res.json({ accountId, transactions: txs });
    }
  } catch (err) {
    console.error("transactions error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/transactions", authMiddleware, async (req, res) => {
  try {
    const { accountId, type, tokenId, amount, status = "PENDING", transactionId, metadata } = req.body;
    const tx = { accountId, type, tokenId, amount, status, transactionId, metadata, createdAt: new Date() };
    if (MONGO_URI) {
      const created = await Transaction.create(tx);
      return res.json({ success: true, tx: created });
    } else {
      memoryStore.txs.unshift(tx);
      return res.json({ success: true, tx });
    }
  } catch (err) {
    console.error("transactions create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ---------- HTS / Hedera endpoints (operator-dependent) ---------- */

/**
 * Create token (server operator used as treasury/admin/supply if provided in env)
 * POST /api/token/create
 * body: { name, symbol, decimals, initialSupply, treasuryAccountId? }
 */
app.post("/api/token/create", authMiddleware, async (req, res) => {
  try {
    if (!hederaClient) return res.status(500).json({ error: "Hedera client not configured on server" });

    const { name, symbol, decimals = 0, initialSupply = 0, treasuryAccountId } = req.body;
    if (!name || !symbol) return res.status(400).json({ error: "Missing name or symbol" });

    const treasury = treasuryAccountId ? AccountId.fromString(treasuryAccountId) : AccountId.fromString(HEDERA_OPERATOR_ID);
    const adminKey = PrivateKey.fromString(HEDERA_OPERATOR_KEY).publicKey;
    const supplyKey = PrivateKey.fromString(HEDERA_OPERATOR_KEY).publicKey;

    const tokenCreate = new TokenCreateTransaction()
      .setTokenName(name)
      .setTokenSymbol(symbol)
      .setDecimals(Number(decimals))
      .setInitialSupply(BigInt(initialSupply))
      .setTreasuryAccountId(treasury)
      .setTokenType(TokenType.FungibleCommon)
      .setSupplyType(TokenSupplyType.Infinite)
      .setAdminKey(adminKey)
      .setSupplyKey(supplyKey);

    const txResponse = await tokenCreate.execute(hederaClient);
    const receipt = await txResponse.getReceipt(hederaClient);
    const tokenId = receipt.tokenId?.toString();
    return res.json({ success: true, tokenId, status: receipt.status.toString() });
  } catch (err) {
    console.error("token create error:", err);
    return res.status(500).json({ error: "Token creation failed", details: err.message });
  }
});

/**
 * Associate token to an account (requires account private key to sign)
 * POST /api/token/associate
 * body: { accountId, accountPrivateKey, tokenId }
 */
app.post("/api/token/associate", authMiddleware, async (req, res) => {
  try {
    if (!hederaClient) return res.status(500).json({ error: "Hedera client not configured" });
    const { accountId, accountPrivateKey, tokenId } = req.body;
    if (!accountId || !accountPrivateKey || !tokenId) return res.status(400).json({ error: "Missing fields" });

    const acctKey = PrivateKey.fromString(accountPrivateKey);
    const acctId = AccountId.fromString(accountId);

    const assocTx = await new TokenAssociateTransaction()
      .setAccountId(acctId)
      .setTokenIds([tokenId])
      .freezeWith(hederaClient)
      .sign(acctKey);

    const resp = await assocTx.execute(hederaClient);
    const receipt = await resp.getReceipt(hederaClient);
    return res.json({ success: true, tokenId, status: receipt.status.toString() });
  } catch (err) {
    console.error("token associate error:", err);
    return res.status(500).json({ error: "Association failed", details: err.message });
  }
});

/**
 * Mint tokens (server must have supply key)
 * POST /api/token/mint { tokenId, amount }
 */
app.post("/api/token/mint", authMiddleware, async (req, res) => {
  try {
    if (!hederaClient) return res.status(500).json({ error: "Hedera client not configured" });
    const { tokenId, amount } = req.body;
    if (!tokenId || amount == null) return res.status(400).json({ error: "Missing tokenId or amount" });

    const mintTx = new TokenMintTransaction()
      .setTokenId(tokenId)
      .setAmount(BigInt(amount));

    const response = await mintTx.execute(hederaClient);
    const receipt = await response.getReceipt(hederaClient);
    return res.json({ success: true, tokenId, status: receipt.status.toString() });
  } catch (err) {
    console.error("token mint error:", err);
    return res.status(500).json({ error: "Mint failed", details: err.message });
  }
});

/**
 * Token transfer (server-side signing optional)
 * POST /api/token/transfer
 * body: { tokenId, fromAccountId, fromPrivateKey?, toAccountId, amount }
 */
app.post("/api/token/transfer", authMiddleware, async (req, res) => {
  try {
    if (!hederaClient) return res.status(500).json({ error: "Hedera client not configured" });
    const { tokenId, fromAccountId, fromPrivateKey, toAccountId, amount } = req.body;
    if (!tokenId || !fromAccountId || !toAccountId || amount == null) return res.status(400).json({ error: "Missing fields" });

    const transferTx = new TransferTransaction()
      .addTokenTransfer(tokenId, AccountId.fromString(fromAccountId), -BigInt(amount))
      .addTokenTransfer(tokenId, AccountId.fromString(toAccountId), BigInt(amount))
      .setTransactionMemo("ArthurDex token transfer");

    if (fromPrivateKey) {
      const senderKey = PrivateKey.fromString(fromPrivateKey);
      const signed = await transferTx.freezeWith(hederaClient).sign(senderKey);
      const resp = await signed.execute(hederaClient);
      const receipt = await resp.getReceipt(hederaClient);
      // store tx in DB
      const txDoc = { accountId: fromAccountId, type: "TRANSFER", tokenId, amount, status: receipt.status.toString(), transactionId: resp.transactionId.toString() };
      if (MONGO_URI) await Transaction.create(txDoc); else memoryStore.txs.unshift(txDoc);
      return res.json({ success: true, transactionId: resp.transactionId.toString(), status: receipt.status.toString() });
    } else {
      return res.status(400).json({ error: "fromPrivateKey required for server-side transfer. Use client-side signing for non-custodial flows." });
    }
  } catch (err) {
    console.error("token transfer error:", err);
    return res.status(500).json({ error: "Transfer failed", details: err.message });
  }
});

/**
 * Token info
 * GET /api/token/info/:tokenId
 */
app.get("/api/token/info/:tokenId", authMiddleware, async (req, res) => {
  try {
    if (!hederaClient) return res.status(500).json({ error: "Hedera client not configured" });
    const tokenId = req.params.tokenId;
    if (!tokenId) return res.status(400).json({ error: "Missing tokenId" });
    const info = await new TokenInfoQuery().setTokenId(tokenId).execute(hederaClient);
    return res.json({ tokenId, info });
  } catch (err) {
    console.error("token info error:", err);
    return res.status(500).json({ error: "Failed to fetch token info", details: err.message });
  }
});

/**
 * Account balance via Hedera SDK (AccountBalanceQuery)
 * GET /api/account/balance/:accountId
 * - requires auth middleware (we use token to protect)
 */
app.get("/api/account/balance/:accountId", authMiddleware, async (req, res) => {
  try {
    const accountId = req.params.accountId;
    if (!accountId) return res.status(400).json({ error: "Missing accountId" });
    if (!hederaClient) return res.status(500).json({ error: "Hedera client not configured" });

    const balance = await new AccountBalanceQuery().setAccountId(AccountId.fromString(accountId)).execute(hederaClient);

    // convert token UInt to string map
    const tokensObj = {};
    for (const [k, v] of balance.tokens) {
      tokensObj[k.toString()] = v.toString();
    }

    return res.json({
      hbar: Number(balance.hbars.toString()),
      tokens: tokensObj
    });
  } catch (err) {
    console.error("account balance error:", err);
    return res.status(500).json({ error: "Failed to fetch balance", details: err.message });
  }
});

/* ---------- Price (CoinGecko) endpoints & updater ---------- */

/**
 * GET /api/prices
 * returns cached prices from DB (fallback: fetch on demand)
 */
app.get("/api/prices", async (req, res) => {
  try {
    if (MONGO_URI) {
      const docs = await Price.find({}).exec();
      return res.json(docs);
    } else {
      // simple live fetch fallback
      const r = await fetchCoinGecko();
      if (!r.ok) return res.status(502).json({ error: "Coingecko fetch failed" });
      return res.json(r.data);
    }
  } catch (err) {
    console.error("prices error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

async function fetchCoinGecko() {
  try {
    // coin ids CSV, vs_currency=usd, include 24h change
    const ids = encodeURIComponent(COINGECKO_IDS);
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) return { ok: false, status: r.status, message: await r.text() };
    const j = await r.json();
    // transform
    const out = Object.entries(j).map(([coinId, d]) => ({ coinId, usd: d.usd, change_24h: d.usd_24h_change || 0, updatedAt: new Date() }));
    return { ok: true, data: out };
  } catch (err) {
    console.error("fetchCoinGecko error:", err);
    return { ok:false, error: err };
  }
}

async function priceUpdaterOnce() {
  try {
    const r = await fetchCoinGecko();
    if (!r.ok || !r.data) return;
    if (MONGO_URI) {
      for (const p of r.data) {
        await Price.findOneAndUpdate({ coinId: p.coinId }, { ...p, updatedAt: new Date() }, { upsert: true });
      }
    } else {
      // memory fallback: write to memoryStore
      memoryStore.prices = r.data;
    }
    console.log("Prices updated:", r.data.map(p => `${p.coinId}@${p.usd}`).join(", "));
  } catch (err) {
    console.error("priceUpdaterOnce error:", err);
  }
}

/* ---------- Start & background tasks ---------- */
process.on("unhandledRejection", (r, p) => console.error("UnhandledRejection:", r, p));
process.on("uncaughtException", (e) => console.error("UncaughtException:", e));

async function startServer() {
  try {
    await mongoConnect(); // attempt connect (will warn if MONGO_URI empty)
    // initial price fetch
    await priceUpdaterOnce();
    // schedule periodic price updates
    setInterval(priceUpdaterOnce, PRICE_UPDATE_INTERVAL_MS);

    app.listen(PORT, () => {
      console.log(`ArthurDex backend listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
