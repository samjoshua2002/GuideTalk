<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=Orbitron&weight=700&size=40&duration=3000&pause=1000&color=A855F7&center=true&vCenter=true&repeat=false&width=600&height=80&lines=GuideTalk+%F0%9F%97%A3%EF%B8%8F" alt="GuideTalk" />

<p align="center">
  <b>AI-powered anime & game character companion app</b><br/>
  Chat with your favourite characters — in their own voice, powered by Azure OpenAI
</p>

<br/>

[![Expo](https://img.shields.io/badge/Expo-SDK%2051-000020?style=for-the-badge&logo=expo&logoColor=white)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.74-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Local-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://mongodb.com)
[![Azure OpenAI](https://img.shields.io/badge/Azure%20OpenAI-GPT-0089D6?style=for-the-badge&logo=microsoftazure&logoColor=white)](https://azure.microsoft.com/en-us/products/ai-services/openai-service)
[![License](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)](LICENSE)

</div>

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🤖 AI Character Chat
Chat with characters from Genshin Impact, anime, and more — each one responds in their own unique personality powered by Azure OpenAI.

</td>
<td width="50%">

### 🎙️ Voice Messages
Record and play back voice messages with smooth animated waveforms and full dark-mode support.

</td>
</tr>
<tr>
<td width="50%">

### 🔍 Dynamic Discovery Feed
Real-time image fetching from the internet — the feed always shows fresh, relevant character content based on your activity.

</td>
<td width="50%">

### 🎠 Spotlight Carousel
Netflix-style smoky blur backdrop with silky smooth manual swipe transitions.

</td>
</tr>
<tr>
<td width="50%">

### 🌗 Dark / Light Theme
Full theme support with high-contrast audio bubbles and adaptive UI across every screen.

</td>
<td width="50%">

### 🧭 Rival Encounters
Dynamically fetched rival/companion suggestions that update based on the character you're currently chatting with.

</td>
</tr>
</table>

---

## 🛠️ Tech Stack

| Layer | Technology |
|:---|:---|
| 📱 Mobile App | Expo SDK 51 + React Native |
| 🧭 Routing | Expo Router (file-based) |
| 🔤 Language | TypeScript |
| ⚙️ Backend | Node.js + Express (ESM modules) |
| 🗄️ Database | MongoDB |
| 🧠 AI | Azure OpenAI (GPT) |
| 🖼️ Image Fetching | Dynamic internet search with DiceBear fallback |
| 🎞️ Animation | React Native Reanimated + Animated API |

---

## 🚀 Getting Started

### Prerequisites

Before you begin, make sure you have the following:

- **Node.js** `>= 18` → [nodejs.org](https://nodejs.org)
- **MongoDB** running locally → [Install guide](https://www.mongodb.com/docs/manual/installation/) or use [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
- **Azure OpenAI** resource with a GPT deployment → [Azure Portal](https://portal.azure.com)
- **Expo Go** app on your phone (iOS / Android)

---

### 1️⃣ Clone the repo

```bash
git clone https://github.com/samjoshua2002/GuideTalk.git
cd GuideTalk
```

### 2️⃣ Install dependencies

```bash
# Frontend
npm install

# Backend
cd server && npm install && cd ..
```

### 3️⃣ Set up environment variables

**Frontend** — copy the template and fill in your values:

```bash
cp .env.example .env
```

```env
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_AZURE_OPENAI_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com/
EXPO_PUBLIC_AZURE_OPENAI_API_VERSION=2025-01-01-preview
EXPO_PUBLIC_AZURE_OPENAI_DEPLOYMENT=YOUR_DEPLOYMENT_NAME
EXPO_PUBLIC_AZURE_OPENAI_API_KEY=YOUR_API_KEY
```

**Backend** — copy the template and fill in your values:

```bash
cp server/.env.example server/.env
```

```env
AZURE_OPENAI_API_KEY=YOUR_API_KEY
AZURE_OPENAI_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=YOUR_DEPLOYMENT_NAME
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DATABASE=guildtalk
PORT=3000
```

### 4️⃣ Start MongoDB

```bash
# macOS (Homebrew)
brew services start mongodb-community

# Linux
sudo systemctl start mongod
```

### 5️⃣ Start the backend

```bash
node server/index.mjs
# Server runs at http://localhost:3000
```

### 6️⃣ Start the app

```bash
npx expo start
```

> Scan the QR code with **Expo Go** on your phone, or press `a` for Android emulator / `i` for iOS simulator.

---

## 📁 Project Structure

```
GuideTalk/
├── 📱 app/                     # Expo Router screens
│   ├── (tabs)/
│   │   ├── index.tsx           # Home — Discover & Spotlight
│   │   ├── chats.tsx           # Chat list
│   │   └── profile.tsx         # User profile
│   ├── chat/[id].tsx           # Character chat screen
│   ├── character/[id].tsx      # Character detail page
│   └── search.tsx              # Search screen
│
├── 🧩 src/
│   ├── components/             # Reusable UI components
│   │   ├── VoiceMessageBubble.tsx
│   │   ├── CharacterCard.tsx
│   │   └── LiquidGlassView.tsx
│   ├── data/                   # Character & rival data
│   ├── lib/                    # Services & utilities
│   │   ├── dynamicImageService.tsx   # Real-time image fetching
│   │   └── chatApi.ts                # AI chat integration
│   ├── theme/                  # Colors, typography
│   └── types/                  # TypeScript interfaces
│
├── ⚙️ server/
│   ├── index.mjs               # Express backend (AI + DB)
│   ├── .env.example
│   └── package.json
│
├── .env.example                # Frontend env template
├── app.json                    # Expo configuration
└── README.md
```

---

## 🔑 Environment Variables Reference

### Frontend (`.env`)

| Variable | Description |
|:---|:---|
| `EXPO_PUBLIC_API_URL` | URL of the backend server |
| `EXPO_PUBLIC_AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource endpoint |
| `EXPO_PUBLIC_AZURE_OPENAI_API_VERSION` | API version |
| `EXPO_PUBLIC_AZURE_OPENAI_DEPLOYMENT` | Model deployment name |
| `EXPO_PUBLIC_AZURE_OPENAI_API_KEY` | Azure OpenAI API key |

### Backend (`server/.env`)

| Variable | Description |
|:---|:---|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | Model deployment name |
| `MONGODB_URI` | MongoDB connection URI |
| `MONGODB_DATABASE` | Database name (default: `guildtalk`) |
| `PORT` | Backend port (default: `3000`) |
| `CORS_ORIGINS` | Allowed CORS origin |

---

## ⚠️ Security

> **Never commit your `.env` files.** They are gitignored by default.
>
> Do not share your `AZURE_OPENAI_API_KEY` or MongoDB credentials publicly.
> If they are ever accidentally exposed, rotate them immediately at [portal.azure.com](https://portal.azure.com).

---

## 📄 License

MIT — feel free to fork, build on, and contribute to this project!

<div align="center">
<br/>
Made with ❤️ by <a href="https://github.com/samjoshua2002">@samjoshua2002</a>
</div>
