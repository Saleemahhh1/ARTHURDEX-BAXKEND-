# ARTHURDEX-BAXKEND-# # ArthurDex (Full bundle: frontend + backend)

## What is included
- Backend: Node/Express server (`server.js`) with JWT auth, wallet creation (encrypted private keys), Hedera Mirror Node balance, send transaction support (server signing if operator configured), tx history.
- Frontend: `index.html`, `style.css`, `app.js` — SPA with intro, terms, passphrase flows (18 words + verify 4), HashPack WalletConnect integration, local encrypted vault, send/swap UI.
- `.env.example`, `.gitignore`, `package.json`

## Quick start (backend)
1. Copy `.env.example` -> `.env` and fill secrets (OPERATOR_ID/OPERATOR_KEY only if you want server to sign).
2. `npm install`
3. `npm run dev` (dev) or `npm start`
4. Host on Render/Railway; set environment variables in their dashboard.

## Quick start (frontend)
- Put `index.html`, `style.css`, `app.js` on Netlify/Vercel or static host. Ensure `BACKEND_URL` points to your deployed backend (in `.env` on server provide `BACKEND_URL` or update app.js before deploy).

## Security & production notes
- **Never** commit `.env` or private keys.
- For **real non-custodial** operation, prefer client-side signing (using WalletConnect / HashPack) rather than the server storing private keys.
- Use HTTPS, CORS restrictions, rate limits, and a real DB (Mongo Atlas).
