👌 Na shirya maka cikakken README.md wanda zaka saka a backend repository na ArthurDex.
Na rubuta shi domin ya zama bayyananne ga duk mai duba repo ɗinka (musamman su Netlify/Render judges idan hackathon project ne).


---

📘 ArthurDex Backend

ArthurDex backend is a next-generation DeFi service powered by Hedera Hashgraph (HTS), MongoDB, and CoinGecko integration.
It provides APIs for authentication, tokenized asset management, balance queries, and real-time crypto price updates.


---

🚀 Features

Express.js API with crash-proof setup

Hedera Token Service (HTS) support (create, mint, transfer, query balances)

MongoDB cache for persistent user storage

JWT authentication (login/register with hashed passwords via bcryptjs)

CoinGecko API integration for live price updates

CORS enabled for frontend (Netlify or any client app)

Rate limiting & logging for security (via express-rate-limit & morgan)



---

🛠️ Tech Stack

Node.js (>=18)

Express.js

Hedera SDK

MongoDB

CoinGecko API

Render (backend hosting)

Netlify (frontend hosting)



---

📂 Project Structure

arthurdex-backend/
├── server.js        # Main backend server
├── package.json     # Dependencies & scripts
├── README.md        # Documentation
├── .env             # Environment variables (not committed)
└── /node_modules    # Installed dependencies


---

⚙️ Setup Instructions

1. Clone repository

git clone https://github.com/YOUR_USERNAME/arthurdex-backend.git
cd arthurdex-backend

2. Install dependencies

npm install

3. Create .env file

Make a .env file in the root with the following content:

PORT=8080
JWT_SECRET=your_jwt_secret_key

# Hedera Testnet Operator
HEDERA_OPERATOR_ID=0.0.xxxxx
HEDERA_OPERATOR_KEY=302e...

# MongoDB Connection
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/arthurdex

# CoinGecko API (public, no key required)
COINGECKO_API=https://api.coingecko.com/api/v3


---

🌍 Deployment

Render (Backend)

1. Create new Web Service in Render.


2. Connect this repository.


3. Set environment variables (from .env).


4. Deploy.



Backend URL will look like:

https://arthurdex.onrender.com

Netlify (Frontend)

In your frontend .env file, set:

REACT_APP_API_BASE_URL=https://arthurdex.onrender.com/api


---

📡 API Endpoints

🔹 Health Check

GET /api/health

Response:

{ "status": "ok", "service": "ArthurDex Backend (HTS enabled)" }

🔹 Authentication

POST /api/auth/register → Register new user

POST /api/auth/login → Login user


🔹 Token Balance

GET /api/token/balance/:accountId
Authorization: Bearer <jwt_token>

🔹 Price Updates (CoinGecko)

GET /api/prices/:symbol


---

🛡️ Security

Passwords hashed with bcryptjs

JWT token-based authentication

Rate limiting enabled (200 requests / 15 minutes)

CORS open for frontend



---

📜 License

This project is licensed under the MIT License.


---

👉 Wannan README.md zaka iya saka shi a backend repo ɗinka.

Kana so in shirya maka README.md na frontend ma domin ya dace da wannan tsarin?

