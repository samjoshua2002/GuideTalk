# 📱 GuideTalk: App Features & Server Data Fetching Architecture

A comprehensive technical reference detailing **GuideTalk's** full-stack architecture, every app feature, client-server data flows, REST endpoints, caching layers, image scraping pipelines, and Over-the-Air (OTA) update mechanics.

---

## 📑 Table of Contents
1. [System Architecture Overview](#1-system-architecture-overview)
2. [Core App Features](#2-core-app-features)
   - [2.1 AI Character Companion Chat](#21-ai-character-companion-chat)
   - [2.2 Dynamic Image Engine & "Change Look" Cycling](#22-dynamic-image-engine--change-look-cycling)
   - [2.3 Dynamic Rivals Discovery](#23-dynamic-rivals-discovery)
   - [2.4 Intelligent Multi-Search & AI Character Auto-Creation](#24-intelligent-multi-search--ai-character-auto-creation)
   - [2.5 Spotlight Carousel & Discovery Feed](#25-spotlight-carousel--discovery-feed)
   - [2.6 Daily Character Prophecy](#26-daily-character-prophecy)
   - [2.7 Personalized Character Recommendations](#27-personalized-character-recommendations)
   - [2.8 Message Editing & Contextual Regeneration](#28-message-editing--contextual-regeneration)
   - [2.9 Authentication & Guest Mode](#29-authentication--guest-mode)
   - [2.10 In-App Updates, EAS OTA & Direct APK Installation](#210-in-app-updates-eas-ota--direct-apk-installation)
3. [How the Client Fetches From the Server](#3-how-the-client-fetches-from-the-server)
   - [3.1 Dynamic Base URL Resolution (`findWorkingBaseUrl`)](#31-dynamic-base-url-resolution-findworkingbaseurl)
   - [3.2 The Dynamic Image Fetch Pipeline](#32-the-dynamic-image-fetch-pipeline)
   - [3.3 Chat Request Lifecycle](#33-chat-request-lifecycle)
   - [3.4 Character Discovery & Search Fetch Flow](#34-character-discovery--search-fetch-flow)
   - [3.5 Rivals & Recommendations Fetch Flow](#35-rivals--recommendations-fetch-flow)
   - [3.6 In-App APK Update Check & Download Flow](#36-in-app-apk-update-check--download-flow)
4. [Complete Server API Reference (`server/index.mjs`)](#4-complete-server-api-reference-serverindexmjs)
5. [Database Architecture & Data Models (MongoDB)](#5-database-architecture--data-models-mongodb)
6. [Caching Layers & Offline Resilience](#6-caching-layers--offline-resilience)
7. [Security & Authentication Specs](#7-security--authentication-specs)

---

## 1. System Architecture Overview

GuideTalk is split into two primary components communicating over secure HTTP/JSON:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT: React Native / Expo                     │
│  - Expo Router (File-based navigation)                                 │
│  - dynamicImageService (Memory Cache + SecureStore + Event Broadcast)  │
│  - chatApi.ts (Dynamic Base URL Probing, Timeout Racing)               │
│  - Theme & Auth Contexts (Guest ID + JWT Bearer Tokens)                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / REST (JSON)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        SERVER: Node.js (Render)                        │
│  - Custom HTTP Router (Native `http.createServer`, CORS enabled)       │
│  - Scrypt Password Hashing + HMAC-SHA256 Token Auth                    │
│  - Multi-tiered In-Memory Caches + Image Search Scrapers               │
└───────────────┬───────────────────────────────┬────────────────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────────┐ ┌──────────────────────────────────────┐
│       MongoDB Atlas          │ │         Azure OpenAI API             │
│  - users                     │ │  - Deployment: gpt-5.6-luna / custom │
│  - characters                │ │  - Character personality generation  │
│  - conversations             │ │  - Streaming & buffered chat         │
│  - messages                  │ │  - Rivals, prophecies & recs         │
│  - character_rivals          │ └──────────────────────────────────────┘
│  - character_images          │
└──────────────────────────────┘
```

---

## 2. Core App Features

### 2.1 AI Character Companion Chat
- **What it is:** Real-time conversational AI where characters stay strictly in canon, adhering to distinct speech patterns, emotional temperaments, honorifics, backstories, and relationship dynamics.
- **Server Communication:** The client dispatches conversational context via `POST /chat`. The server builds a high-fidelity system prompt with character directives and passes conversation history into Azure OpenAI.

### 2.2 Dynamic Image Engine & "Change Look" Cycling
- **What it is:** High-definition character portraits are scraped, filtered, and served dynamically. If a user dislikes an avatar or wants an alternate costume, tapping **"Change Look"** cycles through pre-cached candidate images with zero delay.
- **Server Communication:** Handled via `GET/POST /api/character-image`. The server queries Jikan (MyAnimeList), Safebooru, Bing, Genshin Fandom, and Wikipedia, validates image MIME types and dimensions, checks blocklists, and returns both a primary image and an array of `candidates`.

### 2.3 Dynamic Rivals Discovery
- **What it is:** When chatting with any character (e.g., *Raiden Shogun*), the app dynamically reveals their greatest rivals or canon foils (e.g., *Yae Miko*, *Kazuha*, *Scaramouche*). Tapping a rival lets users transition instantly into a duel or chat with that adversary.
- **Server Communication:** Client requests `POST /characters/dynamic-rivals`. The server checks MongoDB cache `character_rivals`, and if absent, generates lore-accurate rivals via Azure OpenAI.

### 2.4 Intelligent Multi-Search & AI Character Auto-Creation
- **What it is:** Users can search for any anime, video game, movie, or fictional character. If a character is not part of the local registry, GuideTalk uses Azure OpenAI to auto-generate full lore, quotes, personality tags, greeting lines, and searches the web for matching artwork in seconds.
- **Server Communication:** Handled via `POST /characters/search-multi` and `POST /characters/search-or-create`.

### 2.5 Spotlight Carousel & Discovery Feed
- **What it is:** A Netflix-style hero banner featuring character highlights with glassmorphic cards, fluid horizontal scrolling, and category filters (Waifus, Husbandos, Rivals, Trending, Pop Culture).
- **Client Execution:** Reads local registries combined with user-created characters fetched from `GET /characters`. Images are resolved dynamically through the image pipeline.

### 2.6 Daily Character Prophecy
- **What it is:** A daily horoscope and fortune reading delivered by an anime character. It changes every 24 hours at midnight.
- **Seed & Generation:** Uses a deterministic daily seed algorithm (Murmur3 prime mixing over Year-Month-Day) to guarantee identical readings across devices for the same day, with an Azure OpenAI generator fallback via `POST /characters/daily-prophecy`.

### 2.7 Personalized Character Recommendations
- **What it is:** Recommendations generated based on characters the user spends the most time with, analyzing conversation tags, anime franchises, and dialogue themes.
- **Server Communication:** Dispatches `POST /characters/recommendations` with an array of recently active character IDs.

### 2.8 Message Editing & Contextual Regeneration
- **What it is:** Users can tap any previous message, edit their statement, and the AI character will re-branch the conversation, deleting obsolete future turns and generating a new response.
- **Server Communication:** Client sends `PUT /conversations/:conversationId/messages/:messageId` with the new text. The server trims the database history to that checkpoint, stores the new user input, and immediately streams a fresh response from Azure OpenAI.

### 2.9 Authentication & Guest Mode
- **What it is:** Full support for guest users (persisted via unique `deviceId` generated on device install) with seamless upgrades to authenticated cloud accounts (username + password) to sync chats across devices.
- **Server Communication:** Endpoints `/auth/register`, `/auth/login`, `/auth/me`, `/auth/profile`.

### 2.10 In-App Updates, EAS OTA & Direct APK Installation
- **What it is:** 
  1. **Over-The-Air (OTA) Updates:** Powered by EAS Update (`expo-updates`). JavaScript, UI, styles, and asset modifications update silently in the background on app start without needing a new APK.
  2. **Direct APK Update Downloader:** The Profile tab contains a **"Check for Updates"** button. If a new native build is released on Render/GitHub, the app fetches `/app/version`, displays a download modal with real-time percentage progress, saves the APK via `expo-file-system`, and triggers the native Android Package Installer (`android.intent.action.VIEW`).

---

## 3. How the Client Fetches From the Server

### 3.1 Dynamic Base URL Resolution (`findWorkingBaseUrl`)
Mobile testing frequently switches between physical devices on Wi-Fi, Android emulators, and cloud production. `src/lib/chatApi.ts` implements a self-healing URL discovery strategy:

```typescript
// Candidate list probed concurrently:
const candidateBases = [
  env.apiUrl,                        // From .env (e.g., https://guidetalk.onrender.com)
  'https://guidetalk.onrender.com',  // Fallback production
  'http://192.168.0.232:3000',       // Local LAN IP for physical device testing
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : null, // Android emulator loopback
  'http://localhost:3000',           // Web/iOS simulator loopback
];
```

**Workflow:**
1. Checks in-memory cached working URL.
2. If absent, executes a fast probe against candidate URLs (`GET /characters` with 1.8s–5s timeout).
3. Whichever server responds first (status 200, 401, or 404) is locked into `cachedWorkingBaseUrl`.
4. If all probes fail, enters a 25-second cooldown before retrying to prevent network starvation.

---

### 3.2 The Dynamic Image Fetch Pipeline

When an avatar or banner renders on screen, `useDynamicCharacterImage` in `src/lib/dynamicImageService.tsx` triggers the following lifecycle:

```
[Component Mounts (Card / Chat Avatar)]
                   │
                   ▼
       Is image in memory cache?
             ├────────► YES ──► Render immediately
             ▼ NO
     Is image in SecureStore?
             ├────────► YES ──► Hydrate memory cache & broadcast to listeners
             ▼ NO
    Deduplicate in `pendingFetches`
                   │
                   ▼
  Call Server: POST /api/character-image { name, series, force }
                   │
                   ├──► 1. Jikan API (Official MyAnimeList HD images)
                   ├──► 2. Genshin Fandom API (For HoYoverse characters)
                   ├──► 3. Safebooru (High-res anime art tags)
                   ├──► 4. Bing Image Scraper (MIME & blocklist filtered)
                   └──► 5. Wikipedia PageImages API (Thumbnails up to 1000px)
                   │
                   ▼
         Return { imageUrl, candidates }
                   │
                   ├──► Save to MongoDB `character_images` collection
                   ├──► Save to Client `candidatesCache` for instant "Change Look"
                   ├──► Persist to SecureStore (`guildtalk_dynamic_character_images_v1`)
                   └──► Broadcast to `listeners` -> All screens update avatar
```

#### The "Change Look" Instant Cycle
When the user taps the 🔄 **"Change Look"** button in `app/chat/[id].tsx`:
1. `cycleCharacterImage(character)` checks if `candidatesCache` contains more than 1 image URL.
2. If cached candidates exist, it randomly selects a different candidate URL **instantly (0ms latency)** without touching the network!
3. It updates `memoryImageCache` and broadcasts the update to all active screens.
4. If no candidates exist locally, it executes a background server fetch with `{ force: true }`.

---

### 3.3 Chat Request Lifecycle

```
User types text & taps Send (or records Voice Note)
                   │
                   ▼
App optimistic UI: Message appended locally in React state
                   │
                   ▼
Client checks conversationId. If none exists:
  POST /conversations { characterId, characterName, deviceId }
                   │
                   ▼
Client calls: POST /chat
Payload:
{
  conversationId: "...",
  characterId: "furina",
  message: "Hello Lady Furina!",
  history: [ ...previous 10 messages ],
  character: { name, series, personality, greeting, ... },
  deviceId: "...",
  userProfile: { displayName, persona }
}
                   │
                   ▼
Server prepares system prompt:
- Enforces character tone, vocabulary, limits knowledge to canon universe.
- Embeds user's persona/name.
                   │
                   ▼
Server streams / awaits Azure OpenAI:
- Deployment: gpt-5.6-luna (or configured model)
- Temperature: 0.85
                   │
                   ▼
Server persists both User Message & Assistant Message to MongoDB `messages`
Server updates MongoDB `conversations` with last preview & timestamp
                   │
                   ▼
Client receives { reply: "...", conversationId: "..." }
App updates conversation state & triggers subtle haptic feedback
```

---

### 3.4 Character Discovery & Search Fetch Flow

1. **Local Search:** Queries `characterRegistry.ts` (instant client-side filter by name, series, tags).
2. **Server Search (`POST /characters/search-multi`):**
   - Scans MongoDB custom characters created by users.
   - If fewer than desired results are found and query has $\ge 3$ characters, triggers Azure OpenAI to invent/retrieve matching anime characters matching the search keyword.
3. **Auto-Generation (`POST /characters/search-or-create`):**
   - If a user searches for an obscure character not in any database, the server generates a fully structured character JSON including `tagline`, `description`, `personality`, `greeting`, `category`, and initiates an image scrape.

---

### 3.5 Rivals & Recommendations Fetch Flow

#### Rivals Flow (`POST /characters/dynamic-rivals`)
- **Client Cache:** In-memory map `rivalsCache` in `chatApi.ts`.
- **Server Cache:** MongoDB collection `character_rivals` indexed by character name.
- **AI Generation:** If not cached, Azure OpenAI is queried with:
  > *"Who are the top 3-5 biggest rivals, archenemies, or dramatic foils of {name} from {series}? Return structured JSON with rival name, series, relationship description, and clash quote."*
- **Resolution:** For each generated rival, the server triggers `fetchCharacterImage` in parallel so all rival cards have high-resolution portraits.

#### Recommendations Flow (`POST /characters/recommendations`)
- Client passes `recentCharacterIds` (e.g. `["furina", "raiden", "hu_tao"]`).
- Server finds overlapping series or similar character archetypes.
- Response includes recommended character cards with match rationale (e.g., *"Because you like haughty archons from Fontaine"*).

---

### 3.6 In-App APK Update Check & Download Flow

```
User taps "Check for Updates" on Profile tab
                   │
                   ▼
Client calls: GET /app/version
                   │
                   ▼
Server returns:
{
  latestVersion: "1.0.1",
  latestVersionCode: 2,
  apkUrl: "https://expo.dev/accounts/samjoshua2002/projects/guildtalk/builds/...",
  releaseNotes: "Fix wrong images & instant Change Look cycling",
  publishedAt: "2026-09-21T10:35:00Z"
}
                   │
                   ▼
Client compares:
  info.latestVersionCode > currentCode || info.latestVersion !== currentVer
       ├────────► NO  ──► Shows "You're on the latest version! 🎉"
       ▼ YES
Show Update Modal with Release Notes & "Download & Install" button
                   │
                   ▼
User taps "Download & Install":
1. Creates download task via `expo-file-system`:
   `FileSystem.File.createDownloadTask(apkUrl, destFile, { onProgress })`
2. Updates progress bar smoothly (0% -> 100%)
3. Obtains Android content URI:
   `await FileSystem.getContentUriAsync(downloadedFile.uri)`
4. Fires Intent to system installer:
   `IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data, flags: 1, type: 'application/vnd.android.package-archive' })`
```

---

## 4. Complete Server API Reference (`server/index.mjs`)

| Endpoint | Method | Auth Required | Request Body / Params | Description |
|---|---|---|---|---|
| `/auth/register` | `POST` | No | `{ username, password, displayName }` | Registers user with scrypt salt/hash; returns token & user profile. |
| `/auth/login` | `POST` | No | `{ username, password }` | Authenticates user; returns HMAC session token. |
| `/auth/me` | `GET` | Bearer Token | Headers: `Authorization: Bearer <token>` | Returns current authenticated user record. |
| `/auth/profile` | `PUT` | Bearer Token | `{ displayName, avatar, persona }` | Updates user's personal display name, avatar, or persona lore. |
| `/api/character-image` | `GET/POST` | No | `{ name, series, force }` | Multi-source image search (Jikan, Safebooru, Bing, Wiki). Returns primary URL & candidate pool. |
| `/characters/generate` | `POST` | No | `{ prompt, series }` | Generates a character from a creative text description using Azure OpenAI. |
| `/characters/search-multi` | `POST` | No | `{ query }` | Multi-character search combining local DB and AI discovery. |
| `/characters/search-or-create` | `POST` | No | `{ query }` | Searches for character; generates and saves to DB if non-existent. |
| `/characters/recommendations` | `POST` | No | `{ recentCharacterIds }` | Generates personalized character recommendations based on chat history. |
| `/characters/daily-prophecy` | `POST` | No | `{ characterId, characterName, series }` | Generates today's daily lore prophecy for a character. |
| `/characters/dynamic-rivals` | `POST` | No | `{ characterId, characterName, series }` | Fetches or AI-generates canonical rivals with portraits. |
| `/characters` | `GET` | Optional Token | Query: `?userId=...` | Retrieves all custom characters created by the user. |
| `/characters` | `POST` | Optional Token | Character object | Saves a custom character to the MongoDB collection. |
| `/characters/:id` | `GET` | Optional Token | URL Param: `id` | Fetches custom character details by MongoDB `_id`. |
| `/characters/:id` | `DELETE` | Optional Token | URL Param: `id` | Deletes a custom character created by the user. |
| `/conversations` | `GET` | Optional Token | Query: `?deviceId=...` | Lists active conversations for the user or device. |
| `/conversations` | `POST` | Optional Token | `{ characterId, characterName, characterAvatar, deviceId }` | Initializes a new conversation session. |
| `/conversations/:id` | `GET` | Optional Token | URL Param: `id` | Fetches all stored messages for a specific conversation. |
| `/conversations/:id` | `DELETE` | Optional Token | URL Param: `id` | Deletes a conversation and its entire message history. |
| `/conversations/:id/messages` | `DELETE` | Optional Token | URL Param: `id` | Clears all messages in a conversation while keeping session alive. |
| `/conversations/:id/messages/:msgId` | `PUT` | Optional Token | `{ newContent }` | Edits a message, deletes subsequent turns, and regenerates AI response. |
| `/chat` | `POST` | Optional Token | `{ conversationId, characterId, message, history, character, deviceId }` | Main AI chat completion endpoint. Connects to Azure OpenAI. |
| `/app/version` | `GET` | No | None | Returns latest APK build version, versionCode, download URL, and release notes. |

---

## 5. Database Architecture & Data Models (MongoDB)

All persistent collections reside in the `guildtalk` MongoDB database:

### 1. `users`
- `_id`: `ObjectId`
- `username`: `string` (Unique index)
- `displayName`: `string`
- `salt`: `string` (16-byte hex)
- `hash`: `string` (Scrypt 64-byte hex)
- `avatar`: `string`
- `persona`: `string` (Custom background for roleplaying)
- `createdAt`: `Date`

### 2. `characters`
- `_id`: `ObjectId`
- `userId`: `string` (Index)
- `name`: `string`
- `series`: `string`
- `tagline`: `string`
- `description`: `string`
- `personality`: `string`
- `greeting`: `string`
- `avatarUrl`: `string`
- `coverUrl`: `string`
- `category`: `string`
- `createdAt`: `Date`

### 3. `conversations`
- `_id`: `ObjectId`
- `userId`: `string | null` (Index)
- `deviceId`: `string` (Index)
- `characterId`: `string`
- `characterName`: `string`
- `characterAvatar`: `string`
- `preview`: `string` (Snippet of latest message)
- `updatedAt`: `Date` (Index)

### 4. `messages`
- `_id`: `ObjectId`
- `conversationId`: `string` (Index)
- `role`: `'user' | 'character'`
- `content`: `string`
- `photo`: `string | null`
- `createdAt`: `Date` (Index)

### 5. `character_rivals`
- `key`: `string` (Normalized `name:::series`)
- `rivals`: `Array<{ name, series, relationship, quote, avatarUrl }>`
- `updatedAt`: `Date`

### 6. `character_images`
- `key`: `string` (Normalized `name:::series`, Unique index)
- `imageUrl`: `string`
- `candidates`: `string[]`
- `updatedAt`: `Date`

---

## 6. Caching Layers & Offline Resilience

GuideTalk utilizes a **4-tier caching architecture** to deliver instant response times:

```
┌────────────────────────────────────────────────────────┐
│ Tier 1: Client In-Memory Cache (0ms)                   │
│ - `memoryImageCache` (Key -> URL)                      │
│ - `candidatesCache` (Key -> URL[]) for instant cycling │
│ - `rivalsCache` & `characterCache`                     │
├────────────────────────────────────────────────────────┤
│ Tier 2: Persistent Storage (Client Offline)            │
│ - `SecureStore`: `guildtalk_dynamic_character_images`  │
│ - `AsyncStorage`: Recent chats, theme, haptics config  │
├────────────────────────────────────────────────────────┤
│ Tier 3: Server In-Memory Maps (1-5ms)                  │
│ - `recommendationCache` (Map)                          │
│ - `dynamicRivalCache` (Map)                            │
│ - `characterImageCache` (Map)                          │
├────────────────────────────────────────────────────────┤
│ Tier 4: MongoDB Persistent Atlas Collections           │
│ - `character_images` (Collection)                      │
│ - `character_rivals` (Collection)                      │
└────────────────────────────────────────────────────────┘
```

---

## 7. Security & Authentication Specs

1. **Password Security:** Passwords are never stored in plaintext. They are salted using `crypto.randomBytes(16)` and hashed using Node's cryptographic primitive `crypto.scryptSync(password, salt, 64)`. Comparisons use `crypto.timingSafeEqual` to prevent timing attacks.
2. **Session Tokens:** Stateless signed tokens generated via HMAC-SHA256:
   $$\text{Signature} = \text{HMAC-SHA256}(\text{userId} + ":" + \text{timestamp}, \text{SECRET\_KEY})$$
   Serialized as Base64URL string `userId:timestamp:signature`.
3. **Network Timeouts & AbortSignals:** All client fetches execute through `fetchWithTimeout` with strict `AbortController` timeouts (5 seconds for standard database operations, 25 seconds for generative AI endpoints) ensuring UI components never hang indefinitely on unstable mobile connections.
4. **Scraping Blocklist Sanitization:** Server image scrapers enforce a strict blocklist rejecting non-image extensions, music chords, lyrics, logos, and shopping thumbnails (`.svg`, `genius.com`, `guitar`, `lyrics`, `tab`, `icon`, `amazon`, `spotify`).
