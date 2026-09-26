<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=Orbitron&weight=700&size=40&duration=3000&pause=1000&color=A855F7&center=true&vCenter=true&repeat=false&width=600&height=80&lines=GuideTalk+%F0%9F%97%A3%EF%B8%8F" alt="GuideTalk" />

<p align="center">
  <b>AI-powered anime & game character companion app</b><br/>
  Chat with your favourite characters — in their own voice, powered by Azure OpenAI
</p>

<br/>

[![Expo](https://img.shields.io/badge/Expo-SDK%2057-000020?style=for-the-badge&logo=expo&logoColor=white)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.86-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://mongodb.com)
[![Azure OpenAI](https://img.shields.io/badge/Azure%20OpenAI-Luna%20%26%20Chat-0089D6?style=for-the-badge&logo=microsoftazure&logoColor=white)](https://azure.microsoft.com/en-us/products/ai-services/openai-service)
[![Version](https://img.shields.io/badge/Release-v1.0.4-green?style=for-the-badge)](https://github.com/samjoshua2002/GuideTalk)

<br/>

> 📖 **Comprehensive Developer Documentation:** For architecture deep-dives, sequence diagrams, MongoDB schemas, and complete API endpoint specifications, see [**DOCUMENTATION.md**](DOCUMENTATION.md).

</div>

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🤖 AI Character Chat
Chat with characters from anime, cinema, and history — each one responds in their authentic voice powered by Azure OpenAI with resilient safety fallback.

</td>
<td width="50%">

### 🔍 Google-Style Instant Search
Instant live character search as you type! Merges local character cache, Wikipedia Knowledge Graph, and AniList GraphQL with 1-tap direct chat.

</td>
</tr>
<tr>
<td width="50%">

### 🎭 Studio Vault & "Change Look"
Cycle character appearances (comic, cinema, anime) with real-time sync across all message bubble avatars.

</td>
<td width="50%">

### 🔔 Synchronized Companion Reminders
100% parity between phone system shade push notifications and in-app bell modal notifications.

</td>
</tr>
<tr>
<td width="50%">

### 🎙️ Waveform Voice Messages & TTS
Record voice messages with animated decibel waveforms (`expo-audio`), transcribe voice input, and listen with custom character TTS.

</td>
<td width="50%">

### 🎠 Spotlight Carousel & Rivals
Silky-smooth Netflix-style glass carousel and dynamic canonical rivals with conflict prompts.

</td>
</tr>
</table>

---

## 🛠️ Tech Stack

| Layer | Technology |
|:---|:---|
| 📱 Mobile App | Expo SDK 57 + React Native 0.86 |
| 🧭 Routing | Expo Router v4 (Typed Routes) |
| 🔤 Language | TypeScript 6.0 |
| ⚙️ Backend | Node.js (ESM microservice on Render) |
| 🗄️ Database | MongoDB Atlas |
| 🧠 AI Engine | Azure OpenAI (`gpt-5.6-luna` / `gpt-5.1-chat`) |
| 🌐 Knowledge Base | Wikipedia REST & AniList Public GraphQL |
| 🔔 Notifications | Expo Notifications with persistent synchronization |

---

## 📦 Packages & Versions

### 📱 Frontend Core

| Package | Version | Purpose |
|:---|:---:|:---|
| `expo` | `^57.0.0` | Core Expo SDK |
| `react` | `19.2.3` | UI library |
| `react-native` | `0.86.3` | Cross-platform native runtime |
| `react-dom` | `19.2.3` | Web support |
| `react-native-web` | `^0.21.2` | React Native → Web bridge |
| `typescript` | `~5.7.2` | Static typing |

### 🧭 Expo Modules

| Package | Version | Purpose |
|:---|:---:|:---|
| `expo-router` | `~57.0.22` | File-based navigation |
| `expo-blur` | `~57.0.3` | Blur/glass effects |
| `expo-audio` | `~57.0.5` | Audio recording & playback |
| `expo-speech` | `^57.0.3` | Text-to-speech |
| `expo-speech-recognition` | `^57.1.0` | Voice input |
| `expo-image` | `~57.0.5` | Optimised image rendering |
| `expo-image-picker` | `~57.0.19` | Camera / gallery picker |
| `expo-linear-gradient` | `~57.0.2` | Gradient backgrounds |
| `expo-haptics` | `~57.0.3` | Tactile feedback |
| `expo-secure-store` | `~57.0.4` | Encrypted local storage |
| `expo-constants` | `~57.0.19` | App config & env access |
| `expo-font` | `~57.0.4` | Custom font loading |
| `expo-linking` | `~57.0.10` | Deep linking |
| `expo-status-bar` | `~57.0.1` | Status bar control |
| `expo-asset` | `~57.0.18` | Asset management |
| `@expo/vector-icons` | `^15.0.2` | Icon library |

### 🧱 React Navigation & Layout

| Package | Version | Purpose |
|:---|:---:|:---|
| `@react-navigation/native` | `^7.0.14` | Navigation container |
| `react-native-screens` | `~4.26.0` | Native screen optimisation |
| `react-native-safe-area-context` | `~5.7.0` | Safe area insets |

### ⚙️ Backend (server/)

| Package | Version | Purpose |
|:---|:---:|:---|
| `mongodb` | `^7.6.0` | MongoDB Node.js driver |
| `dotenv` | `^16.4.7` | Environment variable loader |
| Node.js | `>= 18` | Runtime (ESM modules) |

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
