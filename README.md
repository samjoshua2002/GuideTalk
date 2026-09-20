<![CDATA[# 🗣️ GuideTalk

**GuideTalk** is an AI-powered anime/game character companion app built with Expo & React Native. Chat with your favourite characters (Genshin Impact, Anime, etc.), explore a dynamic discover feed with real-time image fetching, and enjoy voice-enabled conversations — all wrapped in a sleek, dark-mode-first UI.

---

## ✨ Features

- 🤖 **AI Character Chat** — Powered by Azure OpenAI (GPT), characters respond in-character with unique personalities
- 🎙️ **Voice Messages** — Record and play back voice messages with animated waveforms
- 🔍 **Dynamic Discover Feed** — Real-time image fetching from the web for characters, anime, and game content
- 🎠 **Spotlight Carousel** — Smoky blur backdrop transitions with manual swipe support
- 🌗 **Dark / Light Theme** — Full theme support with high-contrast audio bubbles
- 🏠 **Explore Hall** — Browse characters by category with AI-powered recommendations
- 🧭 **Rival Encounters** — Dynamically fetched rival content based on current character context
- 📱 **Cross-platform** — iOS & Android via Expo

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Mobile App | Expo SDK 51, React Native |
| Routing | Expo Router (file-based) |
| Language | TypeScript |
| Backend | Node.js + Express (ESM) |
| Database | MongoDB |
| AI | Azure OpenAI (GPT-4 / custom deployments) |
| Image Fetching | Bing Image Search API (dynamic) |
| Animation | React Native Reanimated, `Animated` API |

---

## 📋 Prerequisites

Make sure you have the following installed before starting:

- **Node.js** `>= 18` — [nodejs.org](https://nodejs.org)
- **npm** `>= 9` (comes with Node.js)
- **Expo CLI** — installed automatically via `npx`
- **MongoDB** — [Install locally](https://www.mongodb.com/docs/manual/installation/) or use [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
- **Expo Go** app on your phone (iOS/Android) — OR an emulator/simulator

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/samjoshua2002/GuideTalk.git
cd GuideTalk
```

### 2. Install frontend dependencies

```bash
npm install
```

### 3. Install backend dependencies

```bash
cd server
npm install
cd ..
```

### 4. Configure environment variables

**Frontend** — copy and fill in your values:
```bash
cp .env.example .env
```

Edit `.env`:
```env
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_AZURE_OPENAI_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com/
EXPO_PUBLIC_AZURE_OPENAI_API_VERSION=2025-01-01-preview
EXPO_PUBLIC_AZURE_OPENAI_DEPLOYMENT=YOUR_DEPLOYMENT_NAME
EXPO_PUBLIC_AZURE_OPENAI_API_KEY=YOUR_API_KEY
```

**Backend** — copy and fill in your values:
```bash
cp server/.env.example server/.env
```

Edit `server/.env`:
```env
AZURE_OPENAI_API_KEY=YOUR_API_KEY
AZURE_OPENAI_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com/
AZURE_OPENAI_API_VERSION=2025-01-01-preview
AZURE_OPENAI_DEPLOYMENT=YOUR_DEPLOYMENT_NAME
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DATABASE=guildtalk
PORT=3000
CORS_ORIGINS=http://localhost:8081
```

### 5. Start MongoDB

```bash
# macOS (Homebrew)
brew services start mongodb-community

# Linux (systemd)
sudo systemctl start mongod

# Or use your MongoDB Atlas connection string in MONGODB_URI
```

### 6. Start the backend server

```bash
node server/index.mjs
```

The server will run at `http://localhost:3000`.

### 7. Start the Expo app

Open a **new terminal tab** and run:

```bash
npx expo start
```

Then:
- **Scan the QR code** with the Expo Go app on your phone, OR
- Press `a` to open on Android emulator, OR
- Press `i` to open on iOS simulator

---

## 📁 Project Structure

```
GuideTalk/
├── app/                    # Expo Router screens (file-based routing)
│   ├── (tabs)/             # Tab bar screens
│   │   ├── index.tsx       # Home / Discover feed
│   │   ├── explore.tsx     # Explore Hall
│   │   └── profile.tsx     # User profile
│   ├── chat/
│   │   └── [id].tsx        # Character chat screen
│   └── character/
│       └── [id].tsx        # Character detail page
├── src/
│   ├── components/         # Reusable UI components
│   ├── data/               # Static character data
│   ├── lib/                # Services (AI, image fetching, etc.)
│   ├── theme/              # Colors, typography, spacing
│   └── types/              # TypeScript interfaces
├── server/
│   ├── index.mjs           # Express backend (AI chat, DB)
│   ├── .env.example        # Backend env template
│   └── package.json
├── .env.example            # Frontend env template
├── app.json                # Expo configuration
└── package.json
```

---

## 🔑 Environment Variables Reference

### Frontend (`.env`)

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | URL of the backend server |
| `EXPO_PUBLIC_AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource endpoint |
| `EXPO_PUBLIC_AZURE_OPENAI_API_VERSION` | API version (e.g. `2025-01-01-preview`) |
| `EXPO_PUBLIC_AZURE_OPENAI_DEPLOYMENT` | Deployment/model name |
| `EXPO_PUBLIC_AZURE_OPENAI_API_KEY` | Your Azure OpenAI API key |

### Backend (`server/.env`)

| Variable | Description |
|---|---|
| `AZURE_OPENAI_API_KEY` | Your Azure OpenAI API key |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment/model name |
| `MONGODB_URI` | MongoDB connection URI |
| `MONGODB_DATABASE` | Database name |
| `PORT` | Port for the Express server (default: `3000`) |
| `CORS_ORIGINS` | Allowed CORS origin (e.g. `http://localhost:8081`) |

---

## ⚠️ Security Notice

- **Never commit your `.env` files** — they are gitignored by default.
- Do not share your `AZURE_OPENAI_API_KEY` or MongoDB credentials publicly.
- Rotate your keys if they are ever accidentally exposed.

---

## 📄 License

MIT — feel free to fork and build on top of this project!
]]>
