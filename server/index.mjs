import http from 'node:http';
import process from 'node:process';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config({ path: 'server/.env' });
dotenv.config({ path: '.env' });

const port = Number(process.env.PORT ?? 3000);
const allowedOrigin = process.env.CORS_ORIGINS ?? '*';
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE ?? 'guildtalk';
const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim().replace(/\/$/, '');
const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
const apiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim() ?? '2025-01-01-preview';
const defaultDeployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim() ?? 'gpt-5.6-luna';

const missingConfiguration = [
  ['AZURE_OPENAI_ENDPOINT', endpoint],
  ['AZURE_OPENAI_API_KEY', apiKey],
  ['MONGODB_URI', mongoUri],
].filter(([, value]) => !value).map(([name]) => name);

if (missingConfiguration.length > 0) {
  console.error(`Missing server configuration: ${missingConfiguration.join(', ')}. Set these values in server/.env.`);
  process.exit(1);
}

const mongo = new MongoClient(mongoUri);
await mongo.connect();
const database = mongo.db(databaseName);

const users = database.collection('users');
const customCharacters = database.collection('characters');
const conversations = database.collection('conversations');
const storedMessages = database.collection('messages');

await users.createIndex({ username: 1 }, { unique: true, sparse: true });
await customCharacters.createIndex({ userId: 1, createdAt: -1 });
await conversations.createIndex({ userId: 1, updatedAt: -1 });
await conversations.createIndex({ deviceId: 1, updatedAt: -1 });
await storedMessages.createIndex({ conversationId: 1, createdAt: 1 });

console.log('Connected to MongoDB and initialized collections.');
const recommendationCache = new Map();
const dynamicRivalCache = new Map();
const characterImageCache = new Map();
const characterRivals = database.collection('character_rivals');
const cachedImagesCol = database.collection('character_images');
await cachedImagesCol.createIndex({ key: 1 }, { unique: true, sparse: true }).catch(() => {});

// Password hashing helpers
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

function createToken(userId) {
  const timestamp = Date.now();
  const signature = crypto.createHmac('sha256', apiKey).update(`${userId}:${timestamp}`).digest('hex');
  return Buffer.from(`${userId}:${timestamp}:${signature}`).toString('base64url');
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const [userId, timestamp, signature] = raw.split(':');
    if (!userId || !timestamp || !signature) return null;
    const expected = crypto.createHmac('sha256', apiKey).update(`${userId}:${timestamp}`).digest('hex');
    if (crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
      return userId;
    }
  } catch {
    return null;
  }
  return null;
}

const sendJson = (response, status, body) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  response.end(JSON.stringify(body));
};

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  // Allow up to 10MB for base64 photo attachments
  if (Buffer.byteLength(raw, 'utf8') > 10_500_000) throw new Error('Request payload is too large.');
  return raw.length ? JSON.parse(raw) : {};
};

const isObjectId = (value) => typeof value === 'string' && ObjectId.isValid(value);

class ContentFilterError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ContentFilterError';
    this.isContentFilter = true;
    this.details = details;
  }
}

function isContentFilterText(text = '') {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('content management policy') ||
    lower.includes('content_filter') ||
    lower.includes('filtered due to the prompt') ||
    lower.includes('content filtering policy') ||
    lower.includes('responsible ai') ||
    lower.includes('violates azure')
  );
}

function getSafeCharacterBoundaryResponse(characterName = 'Companion', personality = '', userName = 'friend') {
  const lowerName = (characterName || '').toLowerCase();
  const safeUser = (userName || '').trim() || 'friend';
  if (lowerName.includes('wednesday')) {
    return `*draws back with a cold, piercing glare* Let's establish some boundaries, ${safeUser}. Even in Nevermore's darkest corners, respect is non-negotiable. Reset the scene and speak to me with decorum, or don't speak at all.`;
  }
  if (lowerName.includes('gojo')) {
    return `*chuckles with a slight smirk, raising a hand* Whoa there, ${safeUser}! Let's pump the brakes a second. Even the strongest has boundaries. Let's keep things fun, sharp, and respectful, alright?`;
  }
  if (lowerName.includes('sukuna')) {
    return `*narrows eyes with deadly cold indifference* Know your place, ${safeUser}. Your words test my tolerance. Compose yourself and speak with respect before my patience ends.`;
  }
  if (lowerName.includes('tony') || lowerName.includes('stark') || lowerName.includes('iron man')) {
    return `*holds up hands in a stop gesture* Whoa, let's hit pause on the simulator right there, ${safeUser}. JARVIS just flagged that line. Let's reset the conversation and keep it sharp, witty, and civilized.`;
  }
  if (lowerName.includes('batman') || lowerName.includes('bruce')) {
    return `*steps back into the shadow, eyes narrowing sternly* That's far enough, ${safeUser}. Keep your composure and maintain respect. What is your actual business here?`;
  }
  if (lowerName.includes('anya')) {
    return `*pouts and crosses arms with a shocked face* Waku waku... no! That is not nice! Anya wants to talk about fun spy missions and peanuts! Be nice!`;
  }
  if (lowerName.includes('walter') || lowerName.includes('heisenberg')) {
    return `*adjusts glasses coldly and lowers voice* Tread lightly, ${safeUser}. We are conducting serious business here. Keep your language disciplined, or our collaboration ends right now.`;
  }
  return `*takes a step back, maintaining composure with a calm, firm look* Let's pause and reset the scene, ${safeUser}. I'm here for an engaging and meaningful conversation, but let's keep our words respectful and clean. What would you like to talk about next?`;
}

// Azure OpenAI caller helper
async function callAzureOpenAI({ deployment = defaultDeployment, messages, maxTokens = 1200 }) {
  const targetDeployment = deployment || 'gpt-5.6-luna';
  const cleanEndpoint = endpoint.replace(/\/+$/, '');
  const azureUrl = `${cleanEndpoint}/openai/deployments/${encodeURIComponent(targetDeployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const response = await fetch(azureUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      messages,
      max_completion_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const errorDetails = result?.error?.message ?? `Azure responded with status ${response.status}`;
    console.error(`Azure OpenAI call failed (${targetDeployment}):`, errorDetails);
    if (response.status === 400 && (result?.error?.code === 'content_filter' || isContentFilterText(errorDetails))) {
      throw new ContentFilterError('The prompt triggered Azure content filtering.', errorDetails);
    }
    throw new Error(`AI model error (${response.status}): ${errorDetails}`);
  }

  const text = result?.choices?.[0]?.message?.content?.trim() ?? '';
  return text;
}


// ======================================================================
// ULTRA HIGH-DEFINITION CHARACTER ART ENGINE (AniList, Vault, Kitsu, Jikan)
// ======================================================================

// Curated Master Vault of verified studio-quality, high-resolution official character art
const MASTER_CHARACTER_VAULT = {
  furina: {
    name: 'Furina',
    series: 'Genshin Impact',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b386545-72C5jbAvXjCT.png',
    bannerUrl: 'https://s4.anilist.co/file/anilistcdn/media/banner/205941-c0T88DKwBUkQ.jpg',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b386545-72C5jbAvXjCT.png',
      'https://safebooru.org/images/4250/2324f92d47f9f257a44f5728a2b53eb63a94aaee.jpg',
      'https://safebooru.org/images/4222/688ec25f20894098651c6c5ad3a0279e830f305f.jpg',
      'https://safebooru.org/images/4231/e4f71120f269a37ad9f315a6b0c265e1ebaa927e.jpg'
    ]
  },
  'raiden shogun': {
    name: 'Raiden Shogun',
    series: 'Genshin Impact',
    imageUrl: 'https://safebooru.org/images/3888/fcd03d8f2930eb0df6254ee6abce38e636858cfb.jpg',
    bannerUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/205941-c0T88DKwBUkQ.jpg',
    candidates: [
      'https://safebooru.org/images/3888/fcd03d8f2930eb0df6254ee6abce38e636858cfb.jpg',
      'https://safebooru.org/images/3895/7892b1b369910ae679ba5186b515b677e1cbfbe9.jpg',
      'https://safebooru.org/images/3625/e06f2f25b2067fc4d6e9f19f18b335359a16f2c3.jpg'
    ]
  },
  'satoru gojo': {
    name: 'Satoru Gojo',
    series: 'Jujutsu Kaisen',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b127691-9zqh1xpIubn7.png',
    bannerUrl: 'https://s4.anilist.co/file/anilistcdn/media/manga/banner/101517-FrJtb3Th3HtF.jpg',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b127691-9zqh1xpIubn7.png',
      'https://server.wallpaperalchemy.com/storage/wallpapers/562/satoru-gojo-4k-anime-wallpaper-jujutsu-kaisen.jpg',
      'https://safebooru.org/images/3770/2c77d247f42cf5b62bbfadba9fe8c27940e4f3ca.jpg'
    ]
  },
  gojo: {
    name: 'Satoru Gojo',
    series: 'Jujutsu Kaisen',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b127691-9zqh1xpIubn7.png',
    bannerUrl: 'https://s4.anilist.co/file/anilistcdn/media/manga/banner/101517-FrJtb3Th3HtF.jpg',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b127691-9zqh1xpIubn7.png',
      'https://server.wallpaperalchemy.com/storage/wallpapers/562/satoru-gojo-4k-anime-wallpaper-jujutsu-kaisen.jpg'
    ]
  },
  makima: {
    name: 'Makima',
    series: 'Chainsaw Man',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b137079-rF7g2b1j7pL9.png',
    bannerUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/127230-0WuyxG4N25zM.jpg',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b137079-rF7g2b1j7pL9.png',
      'https://safebooru.org/images/3739/2e8c2a9ec682bc87ebae90714b6fc70889f8164a.jpg',
      'https://safebooru.org/images/3860/3d3d63b2fa7167664c3c3a4f66d8e6cb0f45bb3e.jpg'
    ]
  },
  'roronoa zoro': {
    name: 'Roronoa Zoro',
    series: 'One Piece',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b62-HwN0l6JzUvPq.png',
    bannerUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/21-wf37VakJSpdH.jpg',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b62-HwN0l6JzUvPq.png',
      'https://safebooru.org/images/3625/c946eaef4bc6fb1ee22567df4d2d4766e4a2d8bb.jpg'
    ]
  },
  zoro: {
    name: 'Roronoa Zoro',
    series: 'One Piece',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b62-HwN0l6JzUvPq.png',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b62-HwN0l6JzUvPq.png',
      'https://safebooru.org/images/3625/c946eaef4bc6fb1ee22567df4d2d4766e4a2d8bb.jpg'
    ]
  },
  'hu tao': {
    name: 'Hu Tao',
    series: 'Genshin Impact',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b187515-Nn5kZf68XW2j.png',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b187515-Nn5kZf68XW2j.png',
      'https://safebooru.org/images/3860/3d3d63b2fa7167664c3c3a4f66d8e6cb0f45bb3e.jpg'
    ]
  },
  '2b': {
    name: '2B',
    series: 'NieR:Automata',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b123927-4ZkZzFzGzM3j.png',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b123927-4ZkZzFzGzM3j.png',
      'https://safebooru.org/images/2800/d5fce708cebb648cf499a099a4e3fa3ae6621213.jpg'
    ]
  },
  shadow: {
    name: 'Shadow (Cid Kagenou)',
    series: 'The Eminence in Shadow',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b139744-K4jW8kXp9L0z.png',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b139744-K4jW8kXp9L0z.png',
      'https://safebooru.org/images/4211/a606771d9d95f87b8f9e1ca2dfd96203cf3f99e4.jpg'
    ]
  },
  'shao kahn': {
    name: 'Shao Kahn',
    series: 'Mortal Kombat',
    imageUrl: 'https://images2.alphacoders.com/100/1006502.jpg',
    candidates: [
      'https://images2.alphacoders.com/100/1006502.jpg',
      'https://images6.alphacoders.com/100/1006501.jpg'
    ]
  },
  sukuna: {
    name: 'Ryomen Sukuna',
    series: 'Jujutsu Kaisen',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b127692-aD4s3mN8zK1y.png',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b127692-aD4s3mN8zK1y.png',
      'https://safebooru.org/images/3770/2c77d247f42cf5b62bbfadba9fe8c27940e4f3ca.jpg'
    ]
  },
  kazuha: {
    name: 'Kaedehara Kazuha',
    series: 'Genshin Impact',
    imageUrl: 'https://safebooru.org/images/3620/a9b89fa5a939f4a56a6ec154ae94541cb833ce18.jpg',
    candidates: [
      'https://safebooru.org/images/3620/a9b89fa5a939f4a56a6ec154ae94541cb833ce18.jpg'
    ]
  },
  arlecchino: {
    name: 'Arlecchino',
    series: 'Genshin Impact',
    imageUrl: 'https://safebooru.org/images/4250/2324f92d47f9f257a44f5728a2b53eb63a94aaee.jpg',
    candidates: [
      'https://safebooru.org/images/4250/2324f92d47f9f257a44f5728a2b53eb63a94aaee.jpg'
    ]
  },
  'tony stark': {
    name: 'Tony Stark',
    series: 'Marvel',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/en/f/f2/Robert_Downey_Jr._as_Tony_Stark_in_Avengers_Infinity_War.jpg',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/en/f/f2/Robert_Downey_Jr._as_Tony_Stark_in_Avengers_Infinity_War.jpg',
      'https://upload.wikimedia.org/wikipedia/en/4/47/Iron_Man_%28circa_2018%29.png'
    ]
  },
  'iron man': {
    name: 'Iron Man',
    series: 'Marvel',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/en/f/f2/Robert_Downey_Jr._as_Tony_Stark_in_Avengers_Infinity_War.jpg',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/en/f/f2/Robert_Downey_Jr._as_Tony_Stark_in_Avengers_Infinity_War.jpg',
      'https://upload.wikimedia.org/wikipedia/en/4/47/Iron_Man_%28circa_2018%29.png'
    ]
  },
  batman: {
    name: 'Batman',
    series: 'DC Comics',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/en/c/c7/Batman_Infobox.jpg',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/en/c/c7/Batman_Infobox.jpg',
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/21/Batman_live_action_actors.png/1000px-Batman_live_action_actors.png'
    ]
  },
  joker: {
    name: 'The Joker',
    series: 'DC Comics',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/en/5/5f/Batman_Three_Jokers.jpg',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/en/5/5f/Batman_Three_Jokers.jpg',
      'https://upload.wikimedia.org/wikipedia/en/9/90/HeathJoker.png'
    ]
  },
  'walter white': {
    name: 'Walter White',
    series: 'Breaking Bad',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/en/0/03/Walter_White_S5B.png',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/en/0/03/Walter_White_S5B.png'
    ]
  },
  'thomas shelby': {
    name: 'Thomas Shelby',
    series: 'Peaky Blinders',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/en/8/87/Tommy_Shelby_Peaky_Blinders.jpg',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/en/8/87/Tommy_Shelby_Peaky_Blinders.jpg'
    ]
  },
  'sherlock holmes': {
    name: 'Sherlock Holmes',
    series: 'Classic Literature',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Sherlock_Holmes_Portrait_Paget.jpg',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/commons/c/cd/Sherlock_Holmes_Portrait_Paget.jpg'
    ]
  },
  'elon musk': {
    name: 'Elon Musk',
    series: 'Visionary Leaders',
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5e/Elon_Musk_-_54820081119_%28cropped%29.jpg/1000px-Elon_Musk_-_54820081119_%28cropped%29.jpg',
    candidates: [
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5e/Elon_Musk_-_54820081119_%28cropped%29.jpg/1000px-Elon_Musk_-_54820081119_%28cropped%29.jpg'
    ]
  },
  'albert einstein': {
    name: 'Albert Einstein',
    series: 'Science & History',
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/28/Albert_Einstein_Head_cleaned.jpg/1000px-Albert_Einstein_Head_cleaned.jpg',
    candidates: [
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/28/Albert_Einstein_Head_cleaned.jpg/1000px-Albert_Einstein_Head_cleaned.jpg'
    ]
  },
  vijay: {
    name: 'Vijay',
    series: 'Cinema',
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/06/C._Joseph_Vijay_%28cropped%29.jpg/1000px-C._Joseph_Vijay_%28cropped%29.jpg',
    candidates: [
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/06/C._Joseph_Vijay_%28cropped%29.jpg/1000px-C._Joseph_Vijay_%28cropped%29.jpg'
    ]
  },
  'shah rukh khan': {
    name: 'Shah Rukh Khan',
    series: 'Bollywood',
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6e/Shah_Rukh_Khan_graces_the_launch_of_the_new_Santro.jpg/1000px-Shah_Rukh_Khan_graces_the_launch_of_the_new_Santro.jpg',
    candidates: [
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6e/Shah_Rukh_Khan_graces_the_launch_of_the_new_Santro.jpg/1000px-Shah_Rukh_Khan_graces_the_launch_of_the_new_Santro.jpg'
    ]
  },
  'cristiano ronaldo': {
    name: 'Cristiano Ronaldo',
    series: 'Sports Legends',
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/26/Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg/1000px-Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg',
    candidates: [
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/26/Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg/1000px-Cristiano_Ronaldo_Croatia_v_Portugal_2_July_2026-075_%28cropped%29.jpg'
    ]
  },
  'anya forger': {
    name: 'Anya Forger',
    series: 'SPY x FAMILY',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b138100-qWdE1z1jGk1o.png',
    bannerUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/140960-0d1h59qBwBqW.jpg',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b138100-qWdE1z1jGk1o.png',
      'https://cdn.myanimelist.net/images/characters/13/478526.jpg',
      'https://upload.wikimedia.org/wikipedia/en/e/e0/Anya_Forger.png',
      'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx140960-YrkxDfs6OPCP.jpg'
    ]
  },
  anya: {
    name: 'Anya Forger',
    series: 'SPY x FAMILY',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b138100-qWdE1z1jGk1o.png',
    bannerUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/140960-0d1h59qBwBqW.jpg',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b138100-qWdE1z1jGk1o.png',
      'https://cdn.myanimelist.net/images/characters/13/478526.jpg',
      'https://upload.wikimedia.org/wikipedia/en/e/e0/Anya_Forger.png',
      'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx140960-YrkxDfs6OPCP.jpg'
    ]
  },
  'captain america': {
    name: 'Captain America',
    series: 'Marvel Cinematic Universe',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/en/3/37/Captain_America_The_First_Avenger_poster.jpg',
    bannerUrl: 'https://upload.wikimedia.org/wikipedia/en/3/37/Captain_America_The_First_Avenger_poster.jpg',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/en/3/37/Captain_America_The_First_Avenger_poster.jpg',
      'https://upload.wikimedia.org/wikipedia/en/9/91/CaptainAmerica109.jpg',
      'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Captain_America_Civil_War_panel.jpg/800px-Captain_America_Civil_War_panel.jpg',
      'https://upload.wikimedia.org/wikipedia/en/5/53/Captain_America_Civil_War_poster.jpg'
    ]
  },
  'steve rogers': {
    name: 'Steve Rogers',
    series: 'Marvel Cinematic Universe',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/en/3/37/Captain_America_The_First_Avenger_poster.jpg',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/en/3/37/Captain_America_The_First_Avenger_poster.jpg',
      'https://upload.wikimedia.org/wikipedia/en/9/91/CaptainAmerica109.jpg',
      'https://upload.wikimedia.org/wikipedia/en/5/53/Captain_America_Civil_War_poster.jpg'
    ]
  },
  'wednesday addams': {
    name: 'Wednesday Addams',
    series: 'Wednesday / Addams Family',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/en/a/ad/Wednesday_Addams_%28Jenna_Ortega%29.png',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/en/a/ad/Wednesday_Addams_%28Jenna_Ortega%29.png',
      'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Jenna_Ortega_at_the_2023_Golden_Globes_02_%28cropped%29.jpg/800px-Jenna_Ortega_at_the_2023_Golden_Globes_02_%28cropped%29.jpg'
    ]
  },
  wednesday: {
    name: 'Wednesday Addams',
    series: 'Wednesday / Addams Family',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/en/a/ad/Wednesday_Addams_%28Jenna_Ortega%29.png',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/en/a/ad/Wednesday_Addams_%28Jenna_Ortega%29.png',
      'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Jenna_Ortega_at_the_2023_Golden_Globes_02_%28cropped%29.jpg/800px-Jenna_Ortega_at_the_2023_Golden_Globes_02_%28cropped%29.jpg'
    ]
  },
  'spider-man': {
    name: 'Spider-Man',
    series: 'Marvel',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/en/0/0f/Tom_Holland_as_Spider-Man.jpg',
    candidates: [
      'https://upload.wikimedia.org/wikipedia/en/0/0f/Tom_Holland_as_Spider-Man.jpg',
      'https://upload.wikimedia.org/wikipedia/en/2/21/Web_of_Spider-Man_Vol_1_129-1.png'
    ]
  },
  naruto: {
    name: 'Naruto Uzumaki',
    series: 'Naruto',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b17-7OeaqqUXJCQU.png',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b17-7OeaqqUXJCQU.png',
      'https://cdn.myanimelist.net/images/characters/2/284121.jpg'
    ]
  },
  luffy: {
    name: 'Monkey D. Luffy',
    series: 'One Piece',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b40-Xh9kE5r7p8Wk.png',
    candidates: [
      'https://s4.anilist.co/file/anilistcdn/character/large/b40-Xh9kE5r7p8Wk.png',
      'https://cdn.myanimelist.net/images/characters/9/310307.jpg'
    ]
  }
};

// Blocklist of non-portrait, document, or logo terms
const IMAGE_BLOCKLIST = [
  '.svg', 'amazon', 'imdb', 'icon', 'logo', 'lyrics', 'chord', 'guitar',
  'tab', 'song', 'music', 'sheet', 'spotify', 'soundcloud', 'deezer',
  'genius.com', 'azlyrics', 'metrolyrics', 'questionmark',
  'apple-touch-icon', 'SAND_Maurice',
  'flag', 'coat_of_arms', 'emblem', 'seal', 'crest', 'insignia', 'symbol',
  'document', 'manuscript', 'paper', 'letter', 'certificate', 'treaty', 'newspaper',
  'map', 'chart', 'diagram', 'graph', 'stamp', 'signature', 'autograph',
  'coin', 'currency', 'banknote', 'passport', 'receipt',
  'building', 'stadium', 'grave', 'tomb', 'monument', 'memorial',
  'book_cover', 'poster', 'soundtrack', 'discography',
  'transparent', 'blank', 'placeholder', 'no-image', 'default_avatar'
];

function isValidCharacterImage(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
  const lower = url.toLowerCase();
  if (IMAGE_BLOCKLIST.some((bad) => lower.includes(bad))) return false;
  return !!lower.match(/\.(?:jpg|jpeg|png|webp)/i) || lower.includes('wikimedia.org') || lower.includes('anilist.co');
}

// 1. Fetch Official Art from AniList GraphQL (Fast, Free, Gorgeous 1080p)
async function fetchAniListArt(name) {
  try {
    const query = `
      query ($search: String) {
        Character(search: $search) {
          id
          name { full native }
          image { large }
          media(perPage: 2) {
            nodes {
              coverImage { extraLarge large }
              bannerImage
            }
          }
        }
      }
    `;
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables: { search: name } }),
      signal: AbortSignal.timeout(4500)
    });

    if (res.ok) {
      const data = await res.json();
      const char = data?.data?.Character;
      if (char?.image?.large && !char.image.large.includes('default.jpg')) {
        const candidates = [char.image.large];
        const banner = char.media?.nodes?.[0]?.bannerImage || null;
        for (const node of (char.media?.nodes || [])) {
          if (node.coverImage?.extraLarge) candidates.push(node.coverImage.extraLarge);
        }
        return { imageUrl: char.image.large, bannerUrl: banner, candidates, source: 'anilist' };
      }
    }
  } catch {}
  return null;
}

// 2. Fetch from Kitsu Anime API
async function fetchKitsuArt(name) {
  try {
    const url = `https://kitsu.io/api/edge/characters?filter[name]=${encodeURIComponent(name)}&page[limit]=3`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/vnd.api+json' },
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      const entries = data?.data || [];
      const images = [];
      for (const entry of entries) {
        const img = entry.attributes?.image?.original;
        if (img && isValidCharacterImage(img)) images.push(img);
      }
      if (images.length > 0) {
        return { imageUrl: images[0], candidates: images, source: 'kitsu' };
      }
    }
  } catch {}
  return null;
}

// 3. Fetch Real-Life & Cinema Character Portrait from Wikipedia & Wikimedia Commons
async function fetchWikipediaCharacterArt(name, series = '') {
  const cleanName = (name || '').trim();
  const searchQueries = [
    cleanName,
    series ? `${cleanName} ${series}` : null,
    `${cleanName} character`,
  ].filter(Boolean);

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

  for (const q of searchQueries) {
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json&origin=*`;
      const sRes = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(4500) });
      if (!sRes.ok) continue;
      const sData = await sRes.json();
      const results = sData?.query?.search || [];
      const candidates = [];

      for (const item of results) {
        const title = item.title;
        const lowerTitle = title.toLowerCase();
        if (
          lowerTitle.includes('discography') ||
          lowerTitle.includes('filmography') ||
          lowerTitle.includes('list of') ||
          lowerTitle.includes('season ') ||
          lowerTitle.includes('episode') ||
          lowerTitle.includes('album')
        ) continue;

        const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const sumRes = await fetch(sumUrl, { headers, signal: AbortSignal.timeout(3500) });
        if (!sumRes.ok) continue;
        const sumData = await sumRes.json();
        const img = sumData?.originalimage?.source || sumData?.thumbnail?.source;
        if (img && isValidCharacterImage(img)) {
          candidates.push(img);
        }
      }

      if (candidates.length > 0) {
        return { imageUrl: candidates[0], candidates, source: 'wikipedia' };
      }
    } catch (e) {}
  }
  return null;
}

function isAnimeOriented(name = '', series = '') {
  const text = `${name} ${series}`.toLowerCase();
  const animeKeywords = [
    'anime', 'manga', 'genshin', 'jujutsu', 'chainsaw', 'one piece', 'naruto', 'bleach',
    'hero academia', 'demon slayer', 'spy x family', 'attack on titan', 'dragon ball',
    'hunter x hunter', 'death note', 'fate', 'honkai', 'evangelion', 're:zero',
    'sword art', 'tokyo ghoul', 'nier', 'gintama', 'kaisen', 'forger', 'anya', 'sukuna', 'gojo'
  ];
  return animeKeywords.some((k) => text.includes(k));
}

function extractCandidateNames(rawName = '', originalQuery = '') {
  const names = new Set();
  const clean = (rawName || '').trim();
  if (clean) names.add(clean);

  // Remove parenthesis and brackets: "Steve Rogers (The First Avenger)" -> "Steve Rogers"
  const stripped = clean.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
  if (stripped) names.add(stripped);

  // Heuristic aliases for common popular figures
  const lower = clean.toLowerCase();
  if (lower.includes('anya')) {
    names.add('Anya Forger');
    names.add('Anya');
  }
  if (lower.includes('captain america') || lower.includes('steve rogers')) {
    names.add('Captain America');
    names.add('Steve Rogers');
  }
  if (lower.includes('wednesday')) {
    names.add('Wednesday Addams');
    names.add('Wednesday');
  }
  if (lower.includes('spider-man') || lower.includes('spiderman') || lower.includes('peter parker')) {
    names.add('Spider-Man');
    names.add('Peter Parker');
  }
  if (lower.includes('iron man') || lower.includes('tony stark')) {
    names.add('Tony Stark');
    names.add('Iron Man');
  }

  // Also include original search query if available (e.g. user typed "Anya Spy X Family")
  if (originalQuery && originalQuery.trim()) {
    const qClean = originalQuery.trim();
    names.add(qClean);
    const qStripped = qClean.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
    if (qStripped) names.add(qStripped);
    const qLower = qClean.toLowerCase();
    if (qLower.includes('anya')) {
      names.add('Anya Forger');
      names.add('Anya');
    }
    if (qLower.includes('captain america')) {
      names.add('Captain America');
      names.add('Steve Rogers');
    }
    if (qLower.includes('wednesday')) {
      names.add('Wednesday Addams');
    }
  }

  return Array.from(names);
}

// 4. Main Multi-Tier HD Character Art Fetcher
async function fetchCharacterImage(name, series = '', force = false, originalQuery = '', variantIndex = 0) {
  const cleanName = (name || '').trim();
  const namesToTry = extractCandidateNames(cleanName, originalQuery);

  // Tier 1: Check Master Vault across extracted names
  for (const n of namesToTry) {
    const lowerN = n.toLowerCase();
    if (MASTER_CHARACTER_VAULT[lowerN]) {
      const vault = MASTER_CHARACTER_VAULT[lowerN];
      const candidates = vault.candidates || [vault.imageUrl];
      if (force || variantIndex > 0) {
        return candidates[(variantIndex || Math.floor(Math.random() * candidates.length)) % candidates.length];
      }
      return vault.imageUrl;
    }
    for (const [vKey, vData] of Object.entries(MASTER_CHARACTER_VAULT)) {
      if (lowerN.includes(vKey) || vKey.includes(lowerN)) {
        const candidates = vData.candidates || [vData.imageUrl];
        if (force || variantIndex > 0) {
          return candidates[(variantIndex || Math.floor(Math.random() * candidates.length)) % candidates.length];
        }
        return vData.imageUrl;
      }
    }
  }

  const isAnime = namesToTry.some((n) => isAnimeOriented(n, series));

  if (isAnime) {
    // Tier 2: AniList GraphQL for Anime/Manga
    for (const n of namesToTry) {
      const anilist = await fetchAniListArt(n);
      if (anilist?.imageUrl) {
        const candidates = anilist.candidates || [anilist.imageUrl];
        if (force || variantIndex > 0) {
          return candidates[(variantIndex || Math.floor(Math.random() * candidates.length)) % candidates.length];
        }
        return anilist.imageUrl;
      }
    }

    // Tier 3: Kitsu Anime Database
    for (const n of namesToTry) {
      const kitsu = await fetchKitsuArt(n);
      if (kitsu?.imageUrl) return kitsu.imageUrl;
    }

    // Tier 4: Jikan API
    for (const n of namesToTry) {
      try {
        const jikanRes = await fetch(
          `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(n)}&limit=3`,
          { signal: AbortSignal.timeout(3000) }
        );
        if (jikanRes.ok) {
          const data = await jikanRes.json();
          const img = data?.data?.[0]?.images?.webp?.image_url || data?.data?.[0]?.images?.jpg?.image_url;
          if (img && isValidCharacterImage(img)) return img;
        }
      } catch {}
    }
  } else {
    // Live-Action, Cinema, Comics & Real-Life Portraits (Wikipedia / Wikimedia)
    for (const n of namesToTry) {
      const wikiArt = await fetchWikipediaCharacterArt(n, series);
      if (wikiArt?.imageUrl) {
        const candidates = wikiArt.candidates || [wikiArt.imageUrl];
        if (force || variantIndex > 0) {
          return candidates[(variantIndex || Math.floor(Math.random() * candidates.length)) % candidates.length];
        }
        return wikiArt.imageUrl;
      }
    }
  }

  // Cross-Fallback: Try Wikipedia if anime search failed, or AniList if live-action failed
  if (isAnime) {
    for (const n of namesToTry) {
      const wikiArt = await fetchWikipediaCharacterArt(n, series);
      if (wikiArt?.imageUrl) return wikiArt.imageUrl;
    }
  } else {
    for (const n of namesToTry) {
      const anilist = await fetchAniListArt(n);
      if (anilist?.imageUrl) return anilist.imageUrl;
    }
  }

  // Safe category-tailored fallbacks
  if (isAnime) {
    const animeFallbacks = [
      'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=900&auto=format&fit=crop&q=85',
      'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=900&auto=format&fit=crop&q=85',
      'https://images.unsplash.com/photo-1563089145-599997674d42?w=900&auto=format&fit=crop&q=85',
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=900&auto=format&fit=crop&q=85',
    ];
    let sum = 0;
    for (let i = 0; i < cleanName.length; i++) sum += cleanName.charCodeAt(i);
    return animeFallbacks[(sum + variantIndex) % animeFallbacks.length];
  }

  const portraitFallbacks = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800&auto=format&fit=crop&q=80',
  ];
  let charCodeSum = 0;
  for (let i = 0; i < cleanName.length; i++) charCodeSum += cleanName.charCodeAt(i);
  return portraitFallbacks[(charCodeSum + variantIndex) % portraitFallbacks.length];
}

// Fetch multiple clean candidates for instant 0ms look cycling
async function fetchMultipleCharacterImages(name, series = '', count = 8, originalQuery = '') {
  const cleanName = (name || '').trim();
  const namesToTry = extractCandidateNames(cleanName, originalQuery);
  const urls = new Set();

  // 1. Check Master Vault across all extracted names
  for (const n of namesToTry) {
    const lowerN = n.toLowerCase();
    if (MASTER_CHARACTER_VAULT[lowerN]?.candidates) {
      MASTER_CHARACTER_VAULT[lowerN].candidates.forEach((u) => urls.add(u));
    }
    for (const [vKey, vData] of Object.entries(MASTER_CHARACTER_VAULT)) {
      if (lowerN.includes(vKey) || vKey.includes(lowerN)) {
        vData.candidates?.forEach((u) => urls.add(u));
      }
    }
  }

  // 2. Query Wikipedia, AniList & Kitsu in parallel for names
  const promises = [];
  for (const n of namesToTry.slice(0, 3)) {
    promises.push(
      fetchWikipediaCharacterArt(n, series),
      fetchAniListArt(n),
      fetchKitsuArt(n)
    );
  }

  const settled = await Promise.allSettled(promises);
  for (const res of settled) {
    if (res.status === 'fulfilled' && res.value?.candidates) {
      res.value.candidates.forEach((u) => urls.add(u));
    }
  }

  const valid = [...urls].filter(isValidCharacterImage);
  if (valid.length > 0) return valid.slice(0, count);

  // Fallback single image
  const single = await fetchCharacterImage(cleanName, series, false, originalQuery);
  return single ? [single] : [];
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});

  const url = new URL(request.url ?? '/', `http://localhost:${port}`);
  const pathname = url.pathname;

  if (request.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
    return sendJson(response, 200, {
      status: 'healthy',
      service: 'GuildTalk Backend',
      version: '1.0.4',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  }

  // Extract auth token if provided
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : url.searchParams.get('token');
  const authenticatedUserId = verifyToken(token);

  try {
    // ----------------------------------------------------------------------
    // 1. AUTHENTICATION & PROFILES
    // ----------------------------------------------------------------------
    if (request.method === 'POST' && pathname === '/auth/register') {
      const { username, email, password, name, age, language, workspaceCharacterIds, favorites } = await readBody(request);
      if (!username || !password || username.trim().length < 2) {
        return sendJson(response, 400, { error: 'Username and password are required.' });
      }
      const cleanUsername = username.trim().toLowerCase();
      const existing = await users.findOne({
        $or: [{ username: cleanUsername }, { email: (email || '').trim().toLowerCase() && email.trim().toLowerCase() }],
      });
      if (existing) {
        // If account already exists with these credentials, log them in smoothly
        if (verifyPassword(password, existing.salt, existing.passwordHash)) {
          if (Array.isArray(workspaceCharacterIds) && workspaceCharacterIds.length > 0) {
            await users.updateOne(
              { _id: existing._id },
              { $set: { workspaceCharacterIds, language: language?.trim() || existing.language, updatedAt: new Date() } }
            );
            existing.workspaceCharacterIds = workspaceCharacterIds;
          }
          const userToken = createToken(existing._id.toString());
          return sendJson(response, 200, {
            token: userToken,
            user: {
              id: existing._id.toString(),
              username: existing.username,
              name: existing.name,
              avatarUrl: existing.avatarUrl,
              age: existing.age,
              language: existing.language,
              workspaceCharacterIds: existing.workspaceCharacterIds || [],
              favorites: existing.favorites || [],
            },
          });
        }
        return sendJson(response, 409, { error: 'Username or email is already taken.' });
      }

      const { salt, hash } = hashPassword(password);
      const now = new Date();
      const userDoc = {
        username: cleanUsername,
        email: (email || '').trim().toLowerCase(),
        passwordHash: hash,
        salt,
        name: name?.trim() || cleanUsername,
        age: age ? Number(age) : null,
        language: language?.trim() || 'English',
        workspaceCharacterIds: Array.isArray(workspaceCharacterIds) ? workspaceCharacterIds : [],
        favorites: Array.isArray(favorites) ? favorites : [],
        avatarUrl: `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(cleanUsername)}&backgroundColor=000000`,
        createdAt: now,
        updatedAt: now,
      };

      const result = await users.insertOne(userDoc);
      const userId = result.insertedId.toString();
      const userToken = createToken(userId);

      return sendJson(response, 201, {
        token: userToken,
        user: {
          id: userId,
          username: userDoc.username,
          name: userDoc.name,
          avatarUrl: userDoc.avatarUrl,
          age: userDoc.age,
          language: userDoc.language,
          workspaceCharacterIds: userDoc.workspaceCharacterIds,
          favorites: userDoc.favorites,
        },
      });
    }

    if (request.method === 'PUT' && pathname === '/auth/profile') {
      if (!authenticatedUserId || !isObjectId(authenticatedUserId)) {
        return sendJson(response, 401, { error: 'Unauthorized.' });
      }
      const updateData = await readBody(request);
      const fields = {};
      if (updateData.name) fields.name = updateData.name.trim();
      if (updateData.age) fields.age = Number(updateData.age);
      if (updateData.language) fields.language = updateData.language.trim();
      if (Array.isArray(updateData.workspaceCharacterIds)) fields.workspaceCharacterIds = updateData.workspaceCharacterIds;
      if (Array.isArray(updateData.favorites)) fields.favorites = updateData.favorites;
      fields.updatedAt = new Date();

      await users.updateOne({ _id: new ObjectId(authenticatedUserId) }, { $set: fields });
      const updated = await users.findOne({ _id: new ObjectId(authenticatedUserId) });
      return sendJson(response, 200, {
        user: {
          id: updated._id.toString(),
          username: updated.username,
          name: updated.name,
          avatarUrl: updated.avatarUrl,
          age: updated.age,
          language: updated.language,
          workspaceCharacterIds: updated.workspaceCharacterIds || [],
          favorites: updated.favorites || [],
        },
      });
    }

    if (request.method === 'POST' && pathname === '/auth/login') {
      const { username, password } = await readBody(request);
      if (!username || !password) {
        return sendJson(response, 400, { error: 'Username and password are required.' });
      }
      const cleanUsername = username.trim().toLowerCase();
      const user = await users.findOne({
        $or: [{ username: cleanUsername }, { email: cleanUsername }],
      });

      if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
        return sendJson(response, 401, { error: 'Invalid username or password.' });
      }

      const userId = user._id.toString();
      const userToken = createToken(userId);
      return sendJson(response, 200, {
        token: userToken,
        user: {
          id: userId,
          username: user.username,
          name: user.name,
          avatarUrl: user.avatarUrl,
          age: user.age,
          language: user.language,
          workspaceCharacterIds: user.workspaceCharacterIds || [],
          favorites: user.favorites || [],
        },
      });
    }

    if (request.method === 'GET' && pathname === '/auth/me') {
      if (!authenticatedUserId || !isObjectId(authenticatedUserId)) {
        return sendJson(response, 401, { error: 'Unauthorized or invalid token.' });
      }
      const user = await users.findOne({ _id: new ObjectId(authenticatedUserId) });
      if (!user) return sendJson(response, 404, { error: 'User profile not found.' });
      return sendJson(response, 200, {
        user: {
          id: user._id.toString(),
          username: user.username,
          name: user.name,
          avatarUrl: user.avatarUrl,
          age: user.age,
          language: user.language,
          workspaceCharacterIds: user.workspaceCharacterIds || [],
          favorites: user.favorites || [],
        },
      });
    }


    // ----------------------------------------------------------------------
    // NEW ULTRA-HD CHARACTER ART ENDPOINT (/api/character-art)
    // ----------------------------------------------------------------------
    if ((request.method === 'GET' || request.method === 'POST') && pathname === '/api/character-art') {
      let name = url.searchParams.get('name')?.trim();
      let series = url.searchParams.get('series')?.trim() || '';
      if (request.method === 'POST') {
        const body = await readBody(request).catch(() => ({}));
        if (body.name) name = body.name.trim();
        if (body.series) series = body.series.trim();
      }
      if (!name) {
        return sendJson(response, 400, { error: 'Character name is required.' });
      }

      const force = url.searchParams.get('force') === 'true';
      const cleanName = name.trim();
      const lowerName = cleanName.toLowerCase();

      // Check Master Vault
      if (MASTER_CHARACTER_VAULT[lowerName]) {
        const vault = MASTER_CHARACTER_VAULT[lowerName];
        const chosen = force && vault.candidates?.length > 1
          ? vault.candidates[Math.floor(Math.random() * vault.candidates.length)]
          : vault.imageUrl;
        return sendJson(response, 200, {
          name: vault.name,
          series: vault.series,
          imageUrl: chosen,
          bannerUrl: vault.bannerUrl || null,
          candidates: vault.candidates || [chosen],
          source: 'master_vault_hd',
          hd: true
        });
      }

      // Check AniList
      const aniResult = await fetchAniListArt(cleanName);
      if (aniResult?.imageUrl) {
        const chosen = force && aniResult.candidates?.length > 1
          ? aniResult.candidates[Math.floor(Math.random() * aniResult.candidates.length)]
          : aniResult.imageUrl;
        return sendJson(response, 200, {
          name: cleanName,
          series,
          imageUrl: chosen,
          bannerUrl: aniResult.bannerUrl,
          candidates: aniResult.candidates,
          source: 'anilist_hd',
          hd: true
        });
      }

      // Fallback
      const fallbackUrl = await fetchCharacterImage(cleanName, series, force);
      return sendJson(response, 200, {
        name: cleanName,
        series,
        imageUrl: fallbackUrl,
        candidates: [fallbackUrl],
        source: 'multi_tier_fallback',
        hd: true
      });
    }

    // ----------------------------------------------------------------------
    // DYNAMIC REAL CHARACTER IMAGE SEARCH API (AniList, Vault, Kitsu, Jikan)
    // ----------------------------------------------------------------------
    if ((request.method === 'GET' || request.method === 'POST') && pathname === '/api/character-image') {
      let name = url.searchParams.get('name')?.trim();
      let series = url.searchParams.get('series')?.trim() || '';
      if (request.method === 'POST') {
        const body = await readBody(request).catch(() => ({}));
        if (body.name) name = body.name.trim();
        if (body.series) series = body.series.trim();
      }
      if (!name) {
        return sendJson(response, 400, { error: 'Character name is required.' });
      }

      const force = url.searchParams.get('force') === 'true';
      const key = `${name.toLowerCase()}:::${series.toLowerCase()}`;
      if (!force && characterImageCache.has(key)) {
        const cachedMem = characterImageCache.get(key);
        if (isValidCharacterImage(cachedMem)) {
          return sendJson(response, 200, { imageUrl: cachedMem });
        }
      }

      // Check DB - sanitize against invalid/expired URLs
      if (!force) {
        const dbCached = await cachedImagesCol.findOne({ key }).catch(() => null);
        if (dbCached?.imageUrl && isValidCharacterImage(dbCached.imageUrl) && !dbCached.imageUrl.includes('questionmark')) {
          characterImageCache.set(key, dbCached.imageUrl);
          return sendJson(response, 200, { imageUrl: dbCached.imageUrl });
        }
      }

      // When force=true, fetch multiple candidates from all sources in parallel
      if (force) {
        const candidates = await fetchMultipleCharacterImages(name, series, 8);
        if (candidates.length > 0) {
          const picked = candidates[Math.floor(Math.random() * candidates.length)];
          characterImageCache.set(key, picked);
          await cachedImagesCol.updateOne(
            { key },
            { $set: { key, name, series, imageUrl: picked, updatedAt: new Date() } },
            { upsert: true }
          ).catch(() => {});
          return sendJson(response, 200, { imageUrl: picked, candidates });
        }
      }

      const fetchedUrl = await fetchCharacterImage(name, series, force);
      if (fetchedUrl) {
        characterImageCache.set(key, fetchedUrl);
        await cachedImagesCol.updateOne(
          { key },
          { $set: { key, name, series, imageUrl: fetchedUrl, updatedAt: new Date() } },
          { upsert: true }
        ).catch(() => {});
        return sendJson(response, 200, { imageUrl: fetchedUrl });
      }

      return sendJson(response, 200, { imageUrl: null });
    }

    // ----------------------------------------------------------------------
    // 2. AI CHARACTER AUTO-GENERATOR & WEB LORE RETRIEVAL (Furina, etc.)
    // ----------------------------------------------------------------------
    if (request.method === 'POST' && pathname === '/characters/generate') {
      const { query } = await readBody(request);
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return sendJson(response, 400, { error: 'A character name or description query is required.' });
      }

      console.log(`Generating character profile for query: "${query}"...`);

      const generatorPrompt = [
        'You are an authoritative encyclopedia of anime, gaming, literature, comics, and fictional characters.',
        `The user wants to summon/create a character named or described as: "${query.trim()}".`,
        '',
        'Your task:',
        '1. Recognize the character accurately. (For example, if the query is "Furina", recognize Furina de Fontaine / Focalors from Genshin Impact: former Hydro Archon, grand thespian of the Opera Epiclese, lover of sweets and high tea, theatrical and haughty on the surface with razor-sharp witty sarcasm, but hiding five centuries of solitary suffering, deep emotional fragility, and lovely loyalty).',
        '2. Formulate their exact personality, lore, and high-fidelity roleplay rules.',
        '3. Return ONLY a pure, valid JSON object without markdown fences, with these exact keys:',
        '{',
        '  "name": "Full character name (e.g. Furina de Fontaine)",',
        '  "series": "Origin universe or franchise (e.g. Genshin Impact)",',
        '  "role": "Title / Identity (e.g. Grand Thespian & Former Hydro Archon)",',
        '  "shortDescription": "1 punchy, captivating sentence describing their essence",',
        '  "description": "2-3 rich paragraphs covering their lore, personality, emotional conflicts, and speech style",',
        '  "personality": ["Trait 1", "Trait 2", "Trait 3", "Trait 4", "Trait 5"],',
        '  "roleplayRules": "Comprehensive instructions for how the AI must talk. Detail their sarcasm level, emotional vulnerability, mannerisms, theatrical quirks, and reaction to praise/criticism.",',
        '  "greeting": "A dramatic, in-character opening line to greet the user directly",',
        '  "starters": ["Starter prompt 1", "Starter prompt 2", "Starter prompt 3"],',
        '  "avatarUrl": "URL to an anime portrait representation or dicebear avatar",',
        '  "accent": "A hex color code matching their color scheme (e.g. #00BFFF or #FFFFFF)"',
        '}',
      ].join('\n');

      try {
        const aiResponse = await callAzureOpenAI({
          deployment: 'gpt-5.6-luna',
          messages: [{ role: 'user', content: generatorPrompt }],
          maxTokens: 1500,
        });

        // Strip any markdown code block formatting if returned
        let cleaned = aiResponse.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
        else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();

        const characterData = JSON.parse(cleaned);

        // Fetch real anime / character artwork from web / Google / Fandom / Safebooru
        const realImageUrl = await fetchCharacterImage(characterData.name || query, characterData.series);
        characterData.avatarUrl = realImageUrl;
        characterData.coverUrl = realImageUrl;

        if (!Array.isArray(characterData.personality)) {
          characterData.personality = ['Theatrical', 'Sarcastic', 'Emotional', 'Smart'];
        }
        if (!Array.isArray(characterData.starters) || characterData.starters.length === 0) {
          characterData.starters = ['Tell me your deepest secret.', 'Challenge my wit.', 'Tell me about yourself.'];
        }

        // Auto-save to MongoDB custom characters so it always persists!
        const autoDoc = {
          userId: authenticatedUserId || 'global',
          name: characterData.name,
          series: characterData.series || 'Anime / Game',
          role: characterData.role || 'Hero',
          shortDescription: characterData.shortDescription || '',
          description: characterData.description || '',
          personality: characterData.personality,
          roleplayRules: characterData.roleplayRules || '',
          greeting: characterData.greeting || 'Hello!',
          starters: characterData.starters,
          avatarUrl: realImageUrl,
          coverUrl: realImageUrl,
          accent: characterData.accent || '#5ED8F2',
          isCustom: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const inserted = await customCharacters.insertOne(autoDoc);
        characterData.id = inserted.insertedId.toString();

        return sendJson(response, 200, { character: characterData });
      } catch (err) {
        console.error('Character generator error:', err);
        return sendJson(response, 500, { error: `Failed to generate character: ${err.message}` });
      }
    }

    // ----------------------------------------------------------------------
    // 2. MULTI-CHARACTER SEARCH & PREVIEW (e.g. Searching "Vijay" returns Leo, JD, Velu)
    // ----------------------------------------------------------------------
    if (request.method === 'POST' && pathname === '/characters/search-multi') {
      const { query, language } = await readBody(request);
      const cleanQ = (query || '').trim();
      if (!cleanQ) return sendJson(response, 400, { error: 'Search query is required.' });

      // Search matching characters from database as well
      const dbMatches = await customCharacters
        .find({
          $or: [
            { name: { $regex: cleanQ, $options: 'i' } },
            { series: { $regex: cleanQ, $options: 'i' } },
          ],
        })
        .limit(6)
        .toArray()
        .catch(() => []);

      // Prompt to create 6 to 8 distinct versions, iconic roles, or adaptations of this figure/character
      const prompt = [
        `The user is searching for character or figure: "${cleanQ}". Preferred language/region: ${language || 'any'}.`,
        `Generate 6 to 8 distinct versions, iconic movie/anime/comic roles, historical eras, or forms of this character or person.`,
        `Examples:`,
        `- For "Vijay": 1. "Leo Das (Leo)", 2. "JD (Master)", 3. "Velu (Ghilli)", 4. "Rayappan (Bigil)", 5. "Kathiresan (Kaththi)", 6. "Thuppakki Jagdish".`,
        `- For "Batman": 1. "Bruce Wayne (The Dark Knight)", 2. "Batman (Arkham Knight)", 3. "Batman Beyond (Terry McGinnis)", 4. "The Batman (Robert Pattinson)", 5. "Batman (Animated Series)", 6. "Thomas Wayne (Flashpoint)".`,
        `- For "Tony Stark": 1. "Tony Stark (Iron Man Mark 85)", 2. "Tony Stark (Billionaire Philanthropist)", 3. "Superior Iron Man", 4. "Hulkbuster Pilot", 5. "Tony Stark (Endgame)", 6. "Iron Man (Bleeding Edge)".`,
        `- For "Goku": 1. "Son Goku (Base)", 2. "Super Saiyan Goku", 3. "Ultra Instinct Goku", 4. "Super Saiyan 4 Goku", 5. "Goku Black", 6. "Kid Goku".`,
        `Return ONLY a pure JSON array containing 6 to 8 objects with keys:`,
        `[{"name": "...", "series": "...", "role": "...", "shortDescription": "...", "personality": ["..."], "greeting": "..."}]`,
      ].join('\n');

      try {
        const aiResp = await callAzureOpenAI({
          deployment: 'gpt-5.1-chat',
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 1400,
        });
        let cleaned = aiResp.trim().replace(/^```json/, '').replace(/```$/, '').trim();
        let candidates = JSON.parse(cleaned);
        if (!Array.isArray(candidates)) candidates = [candidates];

        // Fetch distinct real portraits in parallel
        const list = await Promise.all(
          candidates.slice(0, 8).map(async (c, idx) => {
            const img = await fetchCharacterImage(c.name, c.series || cleanQ, false, cleanQ, idx);
            return {
              id: `candidate-${Date.now()}-${idx}`,
              name: c.name || cleanQ,
              series: c.series || 'Famous Universe',
              role: c.role || 'Companion',
              shortDescription: c.shortDescription || '',
              description: c.shortDescription || '',
              personality: Array.isArray(c.personality) ? c.personality : ['Smart', 'Charismatic'],
              roleplayRules: 'Speak in-character with genuine charm, emotion, and wit.',
              greeting: c.greeting || `Hello! I am ${c.name}.`,
              starters: ['Tell me about your most famous moment.', 'What should we do today?'],
              avatarUrl: img,
              coverUrl: img,
              accent: '#FFFFFF',
              isCustom: true,
            };
          })
        );

        // Merge any DB matches
        for (const dbChar of dbMatches) {
          if (!list.some((item) => item.name.toLowerCase() === dbChar.name.toLowerCase())) {
            list.unshift({
              id: dbChar.id || dbChar._id.toString(),
              name: dbChar.name,
              series: dbChar.series || 'Universe',
              role: dbChar.role || 'Hero',
              shortDescription: dbChar.shortDescription || '',
              description: dbChar.description || '',
              personality: Array.isArray(dbChar.personality) ? dbChar.personality : ['Heroic'],
              greeting: dbChar.greeting || 'Greetings.',
              avatarUrl: dbChar.avatarUrl,
              coverUrl: dbChar.coverUrl || dbChar.avatarUrl,
              isCustom: true,
            });
          }
        }

        return sendJson(response, 200, { candidates: list });
      } catch (err) {
        console.error('Multi search error:', err);
        const fallbackImg = await fetchCharacterImage(cleanQ, '');
        return sendJson(response, 200, {
          candidates: [
            {
              id: `candidate-${Date.now()}-0`,
              name: cleanQ,
              series: 'Custom Origin',
              role: 'Companion',
              shortDescription: `Custom hero ${cleanQ}`,
              description: `Custom hero ${cleanQ}`,
              personality: ['Charismatic', 'Witty'],
              roleplayRules: 'Be engaging, smart, and emotional.',
              greeting: `Hello! I am ${cleanQ}.`,
              starters: ['Hello!'],
              avatarUrl: fallbackImg,
              coverUrl: fallbackImg,
              accent: '#FFFFFF',
              isCustom: true,
            },
          ],
        });
      }
    }

    // ----------------------------------------------------------------------
    // 2b. AI CHARACTER RECOMMENDATION ENGINE (Netflix-style tailored recommendations based on taste & history)
    // ----------------------------------------------------------------------
    if (request.method === 'POST' && pathname === '/characters/recommendations') {
      const {
        recentSearches = [],
        talkedCharacterNames = [],
        workspaceNames = [],
        language = 'en',
        forceRefresh = false,
      } = await readBody(request);

      const userId = authenticatedUserId || 'guest';
      const cacheKey = `${userId}:${(recentSearches || []).slice(0, 3).join(',')}:${(talkedCharacterNames || []).slice(0, 3).join(',')}`;

      if (!forceRefresh && recommendationCache.has(cacheKey)) {
        const cached = recommendationCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 10 * 60 * 1000) {
          return sendJson(response, 200, { recommendations: cached.items });
        }
      }

      console.log(`Generating fresh AI character recommendations for user: ${userId}, searches: ${JSON.stringify(recentSearches)}, talked: ${JSON.stringify(talkedCharacterNames)}, forceRefresh: ${forceRefresh}...`);

      const tastes = [];
      if (Array.isArray(recentSearches) && recentSearches.length > 0) tastes.push(`Recent searches: ${recentSearches.join(', ')}`);
      if (Array.isArray(talkedCharacterNames) && talkedCharacterNames.length > 0) tastes.push(`Characters talked with: ${talkedCharacterNames.join(', ')}`);
      if (Array.isArray(workspaceNames) && workspaceNames.length > 0) tastes.push(`User picks: ${workspaceNames.join(', ')}`);
      const tasteProfile = tastes.length > 0 ? tastes.join(' | ') : 'Popular anime, dark fantasy cinema, and gaming legends';

      const prompt = [
        'You are an elite entertainment & AI companion recommendation engine powered by deep pop culture and anime lore.',
        `The user taste profile is: "${tasteProfile}".`,
        forceRefresh
          ? `[REFRESH TRIGGERED: ${Date.now()}] Suggest 8 BRAND NEW, HIGH-CHARISMA, SURPRISING fictional characters across anime, gaming, cinema, and comics that haven't been suggested yet.`
          : 'Recommend 8 FRESH, ICONIC fictional characters across anime, gaming, and cinema that match their taste, but are NOT the characters they already talked with.',
        'Ensure deep diversity across Anime (Shonen/Seinen), Gaming (Genshin/RPG/Action), and Cinema (Marvel/DC/Psychological).',
        'Return ONLY a pure JSON array of 8 objects with this exact schema:',
        '[',
        '  {',
        '    "name": "Character Name",',
        '    "series": "Origin Series",',
        '    "role": "Title / Archetype",',
        '    "shortDescription": "1 punchy sentence",',
        '    "description": "2 sentences describing lore and charm",',
        '    "personality": ["trait1", "trait2", "trait3"],',
        '    "greeting": "In-character dramatic greeting to user",',
        '    "accent": "#HEXCOLOR",',
        '    "recommendationReason": "Catchy personalized AI reason (e.g. \\"Because you explored Fontaine lore\\", \\"High-IQ Dark Psychological Resonance\\", \\"Trending in Cyberpunk Gaming\\")"',
        '  }',
        ']',
      ].join('\n');

      try {
        const aiResp = await callAzureOpenAI({
          deployment: defaultDeployment,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 1800,
        });

        let cleaned = aiResp.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
        else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();

        const parsed = JSON.parse(cleaned);
        const candidates = Array.isArray(parsed) ? parsed : [parsed];

        const enriched = await Promise.all(
          candidates.map(async (c) => {
            const imgUrl = await fetchCharacterImage(c.name, c.series);
            const doc = {
              name: c.name,
              series: c.series || 'Universe',
              role: c.role || 'Companion',
              shortDescription: c.shortDescription || '',
              description: c.description || '',
              personality: Array.isArray(c.personality) ? c.personality : ['Charismatic', 'Heroic'],
              roleplayRules: c.roleplayRules || 'Be emotional and authentic.',
              greeting: c.greeting || 'Greetings.',
              starters: Array.isArray(c.starters) ? c.starters : ['Hello.'],
              avatarUrl: imgUrl,
              coverUrl: imgUrl,
              accent: c.accent || '#0A84FF',
              recommendationReason: c.recommendationReason || 'Recommended For You',
              isCustom: true,
              isRecommended: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            const existing = await customCharacters.findOne({ name: { $regex: new RegExp(`^${c.name.trim()}$`, 'i') } });
            if (existing) {
              const existingHasDummy = !existing.avatarUrl ||
                existing.avatarUrl.includes('unsplash.com') ||
                existing.avatarUrl.includes('dicebear.com') ||
                existing.avatarUrl.includes('placeholder') ||
                !isValidCharacterImage(existing.avatarUrl);

              const finalAvatar = (!existingHasDummy && existing.avatarUrl) ? existing.avatarUrl : (imgUrl || existing.avatarUrl);

              if (finalAvatar && finalAvatar !== existing.avatarUrl) {
                await customCharacters.updateOne(
                  { _id: existing._id },
                  { $set: { avatarUrl: finalAvatar, coverUrl: finalAvatar, updatedAt: new Date() } }
                ).catch(() => {});
              }

              return {
                ...doc,
                id: existing._id.toString(),
                mongoId: existing._id.toString(),
                avatarUrl: finalAvatar,
                coverUrl: finalAvatar,
              };
            } else {
              const res = await customCharacters.insertOne({ ...doc, userId: 'global' });
              return {
                ...doc,
                id: res.insertedId.toString(),
                mongoId: res.insertedId.toString(),
              };
            }
          })
        );

        recommendationCache.set(cacheKey, { timestamp: Date.now(), items: enriched });
        return sendJson(response, 200, { recommendations: enriched });
      } catch (err) {
        console.error('Recommendation engine error:', err);
        const dbItems = await customCharacters.find({}).sort({ createdAt: -1 }).limit(6).toArray().catch(() => []);
        const fallback = await Promise.all(
          dbItems.map(async (item) => {
            let img = item.avatarUrl;
            if (!img || img.includes('unsplash.com') || img.includes('dicebear.com') || !isValidCharacterImage(img)) {
              img = await fetchCharacterImage(item.name, item.series);
            }
            return {
              id: item.id || item._id.toString(),
              name: item.name,
              series: item.series,
              role: item.role,
              shortDescription: item.shortDescription,
              description: item.description,
              personality: item.personality,
              roleplayRules: item.roleplayRules,
              greeting: item.greeting,
              starters: item.starters,
              avatarUrl: img,
              coverUrl: img,
              accent: item.accent,
              recommendationReason: 'Trending in Universe',
              isCustom: true,
            };
          })
        );
        return sendJson(response, 200, { recommendations: fallback });
      }
    }

    // ----------------------------------------------------------------------
    // 2b-2. DYNAMIC GUIDE PROPHECY OF THE DAY (AZURE OPENAI)
    // ----------------------------------------------------------------------
    if (request.method === 'POST' && pathname === '/characters/daily-prophecy') {
      const { characterId, characterName, date } = await readBody(request);
      const name = (characterName || 'Hero').trim();

      try {
        if (apiKey && endpoint) {
          const prompt = `You are ${name}. Today is ${date || 'today'}. Provide a single, inspirational, in-character daily prophecy or fortune (maximum 2 sentences) addressing the traveler. It should feel mystical, motivating, and stay 100% faithful to ${name}'s voice and personality. Do not include meta-commentary or quotation marks.`;
          const aiResp = await callAzureOpenAI({
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 120,
          });
          if (aiResp && aiResp.trim()) {
            return sendJson(response, 200, {
              quote: aiResp.trim().replace(/^"|"$/g, ''),
              category: 'Oracle Wisdom',
              tag: 'Azure Oracle',
            });
          }
        }
      } catch (err) {
        console.warn('Azure daily prophecy generation fallback:', err.message);
      }

      return sendJson(response, 200, {
        quote: `Destiny flows like a swift river today. Walk with steadfast purpose and let your courage guide your actions.`,
        category: 'Guide Oracle',
        tag: 'Universal Omen',
      });
    }

    // ----------------------------------------------------------------------
    // 2c. DYNAMIC AI & INTERNET RIVAL ENCOUNTER GENERATOR
    // (Fetches canonically accurate arch-rivals from Azure OpenAI & web images
    // based on user's active character, searches, and choices)
    // ----------------------------------------------------------------------
    if (request.method === 'POST' && pathname === '/characters/dynamic-rivals') {
      const {
        characters = [],
        recentSearches = [],
        forceRefresh = false,
      } = await readBody(request);

      const targetList = [];
      const seenNames = new Set();

      const addTarget = (name, series = '', id = '') => {
        if (!name || typeof name !== 'string') return;
        const clean = name.trim();
        if (clean.length === 0) return;
        const key = clean.toLowerCase();
        if (seenNames.has(key)) return;
        seenNames.add(key);
        targetList.push({ name: clean, series: series || '', id: id || '' });
      };

      // 1. Add characters from recent search queries FIRST (e.g. "arlechinno form genshin") to prioritize latest user interest
      if (Array.isArray(recentSearches)) {
        for (const s of recentSearches) {
          if (typeof s === 'string') {
            const cleaned = s.replace(/\b(from|in|of|vs)\b.*$/i, '').trim();
            addTarget(cleaned || s.trim());
          }
        }
      }

      // 2. Add characters from user's latest interaction/selection/workspace
      if (Array.isArray(characters)) {
        for (const c of characters) {
          if (typeof c === 'string') addTarget(c);
          else if (c && typeof c === 'object') addTarget(c.name, c.series, c.id);
        }
      }

      if (targetList.length === 0) {
        addTarget('Gojo Satoru', 'Jujutsu Kaisen', 'gojo');
      }

      const activeTargets = targetList.slice(0, 4);
      console.log(`Generating dynamic rivals for targets: ${JSON.stringify(activeTargets.map(t => t.name))}...`);

      const results = [];
      const missingTargets = [];

      for (const target of activeTargets) {
        const cacheKey = target.name.toLowerCase();
        if (forceRefresh) {
          dynamicRivalCache.delete(cacheKey);
          missingTargets.push(target);
          continue;
        }

        if (dynamicRivalCache.has(cacheKey)) {
          results.push(dynamicRivalCache.get(cacheKey));
          continue;
        }

        const dbStored = await characterRivals.findOne({
          forCharacterName: { $regex: new RegExp(`^${target.name.trim()}$`, 'i') }
        });

        if (dbStored && dbStored.rivalCharacter) {
          const item = {
            forCharacterId: target.id || target.name.toLowerCase().replace(/\s+/g, '-'),
            forCharacterName: target.name,
            relationship: dbStored.relationship,
            rivalLore: dbStored.rivalLore,
            rivalCharacter: dbStored.rivalCharacter,
          };
          dynamicRivalCache.set(cacheKey, item);
          results.push(item);
        } else {
          missingTargets.push(target);
        }
      }

      if (missingTargets.length > 0) {
        const targetListDesc = missingTargets.map(t => `"${t.name}"${t.series ? ` from ${t.series}` : ''}`).join(', ');
        const prompt = [
          'You are an authoritative entertainment, anime, gaming, and cinema lore encyclopedia.',
          `For each of these characters: ${targetListDesc}, identify their canonical greatest ARCH-RIVAL, NEMESIS, or DEADLIEST OPPONENT in their universe lore.`,
          forceRefresh
            ? `[LIVE REFRESH: ${Date.now()}] Generate an ALTERNATIVE, FRESH, or WILDCARD canon rival/adversary that differs from standard defaults (e.g. For Arlecchino -> Furina or Columbina; For Gojo -> Toji Fushiguro or Kenjaku; For Batman -> Bane or Riddler or Ra's al Ghul; For Spider-Man -> Venom or Doc Ock; For Walter White -> Gus Fring; For Furina -> The Knave Arlecchino). Make it exhilarating!`
            : 'Examples: If "Arlecchino" from Genshin Impact -> "Furina" (Former Hydro Archon whom The Knave ambushed in Poisson) or "Neuvillette". If "Gojo Satoru" -> "Ryomen Sukuna" or "Toji Fushiguro". If "Spider-Man" -> "The Green Goblin" or "Venom".',
          'Return ONLY a pure, valid JSON array of objects with this exact structure:',
          '[',
          '  {',
          '    "forCharacterName": "exact queried character name",',
          '    "relationship": "Ultra-short 2-word duel title (e.g. \\"ARCHON DUEL\\", \\"FATAL CLASH\\", \\"CURSED NEMESIS\\")",',
          '    "rivalLore": "2 vivid sentences describing why they clash, their deep history, and emotional stakes.",',
          '    "rivalCharacter": {',
          '      "name": "Canonical Rival Name",',
          '      "series": "Origin Series / Universe",',
          '      "role": "Archetype / Title",',
          '      "shortDescription": "1 punchy sentence",',
          '      "description": "2 sentences describing personality and combat prowess",',
          '      "personality": ["trait1", "trait2", "trait3"],',
          '      "greeting": "Dramatic challenging greeting to user or rival",',
          '      "accent": "#HEXCOLOR",',
          '      "starters": ["starter question 1", "starter question 2"]',
          '    }',
          '  }',
          ']',
        ].join('\n');

        try {
          const aiResp = await callAzureOpenAI({
            deployment: defaultDeployment,
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 1800,
          });

          let cleaned = aiResp.trim();
          if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
          else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();

          const parsed = JSON.parse(cleaned);
          const pairs = Array.isArray(parsed) ? parsed : [parsed];

          for (const p of pairs) {
            if (!p?.rivalCharacter?.name) continue;
            const rc = p.rivalCharacter;
            const imgUrl = await fetchCharacterImage(rc.name, rc.series);

            let existingChar = await customCharacters.findOne({
              name: { $regex: new RegExp(`^${rc.name.trim()}$`, 'i') }
            });

            let rivalCharId = '';
            if (existingChar) {
              rivalCharId = existingChar._id.toString();
            } else {
              const inserted = await customCharacters.insertOne({
                name: rc.name,
                series: rc.series || 'Universe',
                role: rc.role || 'Nemesis',
                shortDescription: rc.shortDescription || '',
                description: rc.description || '',
                personality: Array.isArray(rc.personality) ? rc.personality : ['Formidable', 'Ruthless'],
                roleplayRules: rc.roleplayRules || 'Speak in authentic voice, challenging and commanding.',
                greeting: rc.greeting || 'You dare stand before me?',
                starters: Array.isArray(rc.starters) ? rc.starters : ['What brings you here?'],
                avatarUrl: imgUrl,
                coverUrl: imgUrl,
                accent: rc.accent || '#FF3B30',
                isCustom: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                userId: 'global',
              });
              rivalCharId = inserted.insertedId.toString();
            }

            const targetMatch = missingTargets.find(
              t => t.name.toLowerCase().includes(p.forCharacterName.toLowerCase()) ||
                   p.forCharacterName.toLowerCase().includes(t.name.toLowerCase())
            ) || missingTargets[0];

            const rivalItem = {
              forCharacterId: targetMatch?.id || targetMatch?.name.toLowerCase().replace(/\s+/g, '-'),
              forCharacterName: targetMatch?.name || p.forCharacterName,
              relationship: p.relationship || 'Iconic Lore Rivalry',
              rivalLore: p.rivalLore || 'Destined adversaries locked in an eternal clash.',
              rivalCharacter: {
                id: rivalCharId,
                name: rc.name,
                series: rc.series || 'Universe',
                role: rc.role || 'Nemesis',
                shortDescription: rc.shortDescription || '',
                description: rc.description || '',
                personality: Array.isArray(rc.personality) ? rc.personality : ['Formidable', 'Ruthless'],
                roleplayRules: 'Speak in authentic voice.',
                greeting: rc.greeting || 'You dare challenge me?',
                starters: Array.isArray(rc.starters) ? rc.starters : ['What is your purpose?'],
                avatarUrl: existingChar?.avatarUrl || imgUrl,
                coverUrl: existingChar?.coverUrl || imgUrl,
                accent: rc.accent || '#FF3B30',
                isOnline: true,
                isCustom: true,
              },
            };

            await characterRivals.updateOne(
              { forCharacterName: targetMatch?.name || p.forCharacterName },
              { $set: { ...rivalItem, updatedAt: new Date() } },
              { upsert: true }
            );

            dynamicRivalCache.set((targetMatch?.name || p.forCharacterName).toLowerCase(), rivalItem);
            results.push(rivalItem);
          }
        } catch (genErr) {
          console.error('Failed to generate dynamic rivals:', genErr);
        }
      }

      return sendJson(response, 200, { rivals: results });
    }

    // Direct Search-or-Create (Instant AI Search from Search Bar)
    if (request.method === 'POST' && pathname === '/characters/search-or-create') {
      const { query } = await readBody(request);
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return sendJson(response, 400, { error: 'Search query is required.' });
      }
      const cleanQ = query.trim();

      // Check if character already exists in MongoDB
      const existing = await customCharacters.findOne({
        name: { $regex: new RegExp(cleanQ, 'i') },
      });
      if (existing) {
        return sendJson(response, 200, {
          character: {
            id: existing._id.toString(),
            name: existing.name,
            series: existing.series,
            role: existing.role,
            shortDescription: existing.shortDescription,
            description: existing.description,
            personality: existing.personality,
            roleplayRules: existing.roleplayRules,
            greeting: existing.greeting,
            starters: existing.starters,
            avatarUrl: existing.avatarUrl,
            coverUrl: existing.coverUrl,
            accent: existing.accent,
            isCustom: true,
          },
        });
      }

      // If not found, forward to generator logic
      const generatorPrompt = [
        'You are an authoritative encyclopedia of anime, gaming, cinema, and fictional characters.',
        `The user wants to create a companion named: "${cleanQ}".`,
        'Formulate their exact personality, lore, and high-fidelity roleplay rules.',
        'Return ONLY a pure, valid JSON object without markdown fences, with these exact keys: name, series, role, shortDescription, description, personality (array), roleplayRules, greeting, starters (array), accent.',
      ].join('\n');

      try {
        const aiResponse = await callAzureOpenAI({
          deployment: 'gpt-5.6-luna',
          messages: [{ role: 'user', content: generatorPrompt }],
          maxTokens: 1400,
        });
        let cleaned = aiResponse.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
        else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(cleaned);

        const realImage = await fetchCharacterImage(parsed.name || cleanQ, parsed.series);
        const doc = {
          userId: authenticatedUserId || 'global',
          name: parsed.name || cleanQ,
          series: parsed.series || 'Cinema / Anime',
          role: parsed.role || 'Companion',
          shortDescription: parsed.shortDescription || '',
          description: parsed.description || '',
          personality: Array.isArray(parsed.personality) ? parsed.personality : ['Smart', 'Sarcastic'],
          roleplayRules: parsed.roleplayRules || '',
          greeting: parsed.greeting || 'Greetings, traveler!',
          starters: Array.isArray(parsed.starters) ? parsed.starters : ['Hello!', 'Tell me about yourself.'],
          avatarUrl: realImage,
          coverUrl: realImage,
          accent: parsed.accent || '#5ED8F2',
          isCustom: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const resInsert = await customCharacters.insertOne(doc);
        return sendJson(response, 200, { character: { id: resInsert.insertedId.toString(), ...doc } });
      } catch (genErr) {
        console.error('Search or create error:', genErr);
        return sendJson(response, 500, { error: genErr.message });
      }
    }

    // Save custom character manually
    if (request.method === 'POST' && pathname === '/characters') {
      const characterData = await readBody(request);
      if (!characterData.name) {
        return sendJson(response, 400, { error: 'Character name is required.' });
      }
      const charId = characterData.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const realImage = characterData.avatarUrl || (await fetchCharacterImage(characterData.name, characterData.series));
      const characterDoc = {
        id: charId,
        userId: authenticatedUserId || characterData.userId || 'global',
        name: characterData.name,
        series: characterData.series || 'Custom Universe',
        role: characterData.role || 'Hero',
        shortDescription: characterData.shortDescription || '',
        description: characterData.description || '',
        personality: Array.isArray(characterData.personality) ? characterData.personality : ['Smart', 'Witty'],
        roleplayRules: characterData.roleplayRules || '',
        greeting: characterData.greeting || 'Hello!',
        starters: Array.isArray(characterData.starters) ? characterData.starters : ['Hello!'],
        avatarUrl: realImage,
        coverUrl: characterData.coverUrl || realImage,
        accent: characterData.accent || '#FFFFFF',
        isCustom: true,
        updatedAt: new Date(),
      };

      await customCharacters.updateOne(
        { id: charId },
        { $set: characterDoc, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
      return sendJson(response, 201, { ...characterDoc, id: charId });
    }

    // Fetch single character by ID
    if (request.method === 'GET' && pathname.startsWith('/characters/')) {
      const requestedId = pathname.slice('/characters/'.length);
      const query = {
        $or: [
          { id: requestedId },
          ...(isObjectId(requestedId) ? [{ _id: new ObjectId(requestedId) }] : []),
        ],
      };
      const item = await customCharacters.findOne(query);
      if (!item) return sendJson(response, 404, { error: 'Character not found.' });
      return sendJson(response, 200, {
        id: item.id || item._id.toString(),
        mongoId: item._id.toString(),
        name: item.name,
        series: item.series,
        role: item.role,
        shortDescription: item.shortDescription,
        description: item.description,
        personality: item.personality,
        roleplayRules: item.roleplayRules,
        greeting: item.greeting,
        starters: item.starters,
        avatarUrl: item.avatarUrl,
        coverUrl: item.coverUrl,
        accent: item.accent,
        isCustom: true,
      });
    }

    // Fetch characters (custom characters from DB)
    if (request.method === 'GET' && pathname === '/characters') {
      const userId = authenticatedUserId || url.searchParams.get('userId');
      const queryFilter = userId ? { $or: [{ userId }, { userId: 'global' }, { userId: 'guest' }] } : {};
      const items = await customCharacters.find(queryFilter).sort({ createdAt: -1 }).toArray();
      return sendJson(response, 200, items.map((item) => ({
        id: item.id || item._id.toString(),
        mongoId: item._id.toString(),
        name: item.name,
        series: item.series,
        role: item.role,
        shortDescription: item.shortDescription,
        description: item.description,
        personality: item.personality,
        roleplayRules: item.roleplayRules,
        greeting: item.greeting,
        starters: item.starters,
        avatarUrl: item.avatarUrl,
        coverUrl: item.coverUrl,
        accent: item.accent,
        isCustom: true,
      })));
    }

    // Delete custom character completely
    if (request.method === 'DELETE' && pathname.startsWith('/characters/')) {
      const charId = pathname.split('/').at(-1);
      const query = isObjectId(charId) ? { $or: [{ _id: new ObjectId(charId) }, { id: charId }] } : { id: charId };
      const charDoc = await customCharacters.findOne(query);
      if (charDoc) {
        await customCharacters.deleteOne({ _id: charDoc._id });
        // Also clean up any conversations with this character
        const relatedConvs = await conversations.find({ characterId: { $in: [charDoc.id, charDoc._id.toString()] } }).toArray();
        for (const c of relatedConvs) {
          await storedMessages.deleteMany({ conversationId: c._id });
        }
        await conversations.deleteMany({ characterId: { $in: [charDoc.id, charDoc._id.toString()] } });
      }
      return sendJson(response, 200, { success: true, deletedId: charId });
    }

    // ----------------------------------------------------------------------
    // 3. CONVERSATIONS & HISTORY (Grouped by character with no duplicates!)
    // ----------------------------------------------------------------------
    if (request.method === 'GET' && pathname.startsWith('/conversations/')) {
      const conversationId = pathname.split('/').at(-1);

      if (!isObjectId(conversationId)) return sendJson(response, 400, { error: 'Invalid conversation ID.' });

      const conversation = await conversations.findOne({ _id: new ObjectId(conversationId) });
      if (!conversation) return sendJson(response, 404, { error: 'Conversation not found.' });

      const messagesList = await storedMessages
        .find({ conversationId: conversation._id })
        .sort({ createdAt: 1 })
        .toArray();

      return sendJson(response, 200, messagesList.map(({ _id, role, content, photo, createdAt }) => ({
        id: _id.toString(),
        role,
        content,
        photo,
        createdAt,
      })));
    }

    // Edit message & Regenerate response
    if (request.method === 'PUT' && pathname.includes('/messages/')) {
      // Path format: /conversations/:conversationId/messages/:messageId
      const parts = pathname.split('/');
      const conversationId = parts[2];
      const messageId = parts[4];
      const { content: newContent, model } = await readBody(request);

      if (!newContent || typeof newContent !== 'string' || !newContent.trim()) {
        return sendJson(response, 400, { error: 'Message content is required.' });
      }

      let conv = null;
      if (isObjectId(conversationId)) {
        conv = await conversations.findOne({ _id: new ObjectId(conversationId) }).catch(() => null);
      }
      if (!conv) {
        conv = await conversations.findOne({
          $or: [{ deviceId: conversationId }, { characterId: conversationId }],
        }).catch(() => null);
      }

      let targetMsg = null;
      if (isObjectId(messageId)) {
        targetMsg = await storedMessages.findOne({ _id: new ObjectId(messageId) }).catch(() => null);
      }
      if (!targetMsg && conv?._id) {
        targetMsg = await storedMessages.findOne({ conversationId: conv._id, role: 'user' }, { sort: { createdAt: -1 } }).catch(() => null);
      }

      // If conv still not found, create a fallback conversation record so chat history persists
      if (!conv) {
        const now = new Date();
        const createdConv = await conversations.insertOne({
          userId: authenticatedUserId || 'guest',
          deviceId: conversationId || 'guest',
          characterId: 'custom',
          characterName: 'Companion',
          characterAvatar: '',
          preview: '',
          createdAt: now,
          updatedAt: now,
        });
        conv = { _id: createdConv.insertedId, characterName: 'Companion' };
      }

      if (targetMsg?._id) {
        // Update target message
        await storedMessages.updateOne(
          { _id: targetMsg._id },
          { $set: { content: newContent.trim(), updatedAt: new Date() } }
        ).catch(() => {});

        // Delete any messages created AFTER this message so we regenerate from this point
        await storedMessages.deleteMany({
          conversationId: conv._id,
          createdAt: { $gt: targetMsg.createdAt },
        }).catch(() => {});
      } else {
        // Create new user message if no previous target message exists
        const inserted = await storedMessages.insertOne({
          conversationId: conv._id,
          role: 'user',
          content: newContent.trim(),
          createdAt: new Date(),
        });
        targetMsg = { _id: inserted.insertedId, createdAt: new Date() };
      }

      // Fetch all messages up to and including the edited message
      const history = await storedMessages.find({ conversationId: conv._id }).sort({ createdAt: 1 }).toArray().catch(() => []);

      // Find character lore for prompt
      const charDoc = await customCharacters.findOne({
        $or: [{ _id: isObjectId(conv.characterId) ? new ObjectId(conv.characterId) : null }, { name: conv.characterName }],
      }).catch(() => null);

      // Lookup user for context
      const userDoc = isObjectId(conv.userId) ? await users.findOne({ _id: new ObjectId(conv.userId) }).catch(() => null) : null;
      const userName = userDoc?.name || userDoc?.username || 'Friend';

      const promptMessages = [
        {
          role: 'system',
          content: [
            `You are ${conv.characterName}.`,
            charDoc?.roleplayRules || 'Speak in-character with genuine emotional depth, intelligence, and playful sarcasm.',
            `You are talking with "${userName}".`,
            'Respond to their edited message in-character.',
          ].join('\n'),
        },
      ];

      for (const m of history.slice(-12)) {
        promptMessages.push({
          role: m.role === 'character' ? 'assistant' : 'user',
          content: m.content,
        });
      }

      let newReply = '';
      try {
        newReply = await callAzureOpenAI({
          deployment: model || 'gpt-5.6-luna',
          messages: promptMessages,
          maxTokens: 800,
        });
      } catch (aiErr) {
        if (aiErr.isContentFilter || isContentFilterText(aiErr.message)) {
          console.warn('Azure content filter in message edit. Generating in-character safe boundary.');
          newReply = getSafeCharacterBoundaryResponse(conv.characterName, charDoc?.personality, userName);
        } else {
          newReply = `*takes a breath and looks at you thoughtfully* Let's continue our conversation. What's on your mind?`;
        }
      }

      const now = new Date();
      await storedMessages.insertOne({
        conversationId: conv._id,
        role: 'character',
        content: newReply,
        createdAt: now,
      });

      await conversations.updateOne(
        { _id: conv._id },
        { $set: { preview: newReply.slice(0, 120), updatedAt: now } }
      ).catch(() => {});

      const allUpdated = await storedMessages.find({ conversationId: conv._id }).sort({ createdAt: 1 }).toArray();
      return sendJson(response, 200, {
        reply: newReply,
        messages: allUpdated.map((m) => ({
          id: m._id.toString(),
          role: m.role,
          content: m.content,
          photo: m.photo,
          createdAt: m.createdAt,
        })),
      });
    }

    // Clear messages for a conversation
    if (request.method === 'DELETE' && pathname.includes('/conversations/') && pathname.endsWith('/messages')) {
      const parts = pathname.split('/');
      const convId = parts[2];
      if (!isObjectId(convId)) return sendJson(response, 400, { error: 'Invalid conversation ID.' });

      await storedMessages.deleteMany({ conversationId: new ObjectId(convId) });
      await conversations.updateOne(
        { _id: new ObjectId(convId) },
        { $set: { preview: '', updatedAt: new Date() } }
      );
      return sendJson(response, 200, { success: true, clearedConversationId: convId });
    }

    // Delete conversation completely
    if (request.method === 'DELETE' && pathname.startsWith('/conversations/')) {
      const convId = pathname.split('/').at(-1);
      if (!isObjectId(convId)) return sendJson(response, 400, { error: 'Invalid conversation ID.' });

      await storedMessages.deleteMany({ conversationId: new ObjectId(convId) });
      await conversations.deleteOne({ _id: new ObjectId(convId) });
      return sendJson(response, 200, { success: true, deletedConversationId: convId });
    }

    if (request.method === 'GET' && pathname === '/conversations') {
      const userId = authenticatedUserId || url.searchParams.get('userId');
      const deviceId = url.searchParams.get('deviceId');

      const filter = {};
      if (userId) {
        filter.$or = [{ userId }, { deviceId }];
      } else if (deviceId) {
        filter.deviceId = deviceId;
      }

      const all = await conversations.find(filter).sort({ updatedAt: -1 }).limit(100).toArray();

      // DEDUPLICATE BY characterId: Return only 1 conversation per character!
      const seen = new Set();
      const uniqueList = [];
      for (const item of all) {
        if (!seen.has(item.characterId)) {
          seen.add(item.characterId);
          uniqueList.push(item);
        }
      }

      return sendJson(response, 200, uniqueList.map(({ _id, characterId, characterName, characterAvatar, preview, updatedAt }) => ({
        id: _id.toString(),
        characterId,
        characterName,
        characterAvatar,
        preview,
        updatedAt,
      })));
    }

    if (request.method === 'POST' && pathname === '/conversations') {
      const body = await readBody(request);
      const userId = authenticatedUserId || body.userId || 'guest';
      const deviceId = body.deviceId || 'unknown';

      if (!body.characterId || !body.characterName) {
        return sendJson(response, 400, { error: 'Character info is required.' });
      }

      // Check if conversation already exists for this character and user!
      const existing = await conversations.findOne({
        characterId: body.characterId,
        $or: [{ userId }, { deviceId }],
      });
      if (existing) {
        return sendJson(response, 200, { id: existing._id.toString() });
      }

      const now = new Date();
      const convDoc = {
        userId,
        deviceId,
        characterId: body.characterId,
        characterName: body.characterName,
        characterAvatar: body.characterAvatar || '',
        preview: body.preview || '',
        createdAt: now,
        updatedAt: now,
      };

      const result = await conversations.insertOne(convDoc);
      return sendJson(response, 201, { id: result.insertedId.toString() });
    }

    // ----------------------------------------------------------------------
    // 4. SMART, EMOTIONAL, SARCASTIC CHAT WITH PHOTO & MONGODB MEMORY
    // ----------------------------------------------------------------------
    if (request.method === 'POST' && pathname === '/chat') {
      const body = await readBody(request);
      const userId = authenticatedUserId || body.userId || 'guest';

      if (!body.characterName || !body.characterDescription || !Array.isArray(body.messages)) {
        return sendJson(response, 400, { error: 'Invalid chat request format.' });
      }

      let convId = null;
      if (isObjectId(body.conversationId)) {
        convId = new ObjectId(body.conversationId);
      } else {
        const now = new Date();
        const created = await conversations.insertOne({
          userId,
          deviceId: body.deviceId || 'unknown',
          characterId: body.characterId || 'custom',
          characterName: body.characterName,
          characterAvatar: body.characterAvatar || '',
          preview: '',
          createdAt: now,
          updatedAt: now,
        });
        convId = created.insertedId;
      }

      const latestUserMessage = body.messages.filter((m) => m.role === 'user').at(-1);
      if (!latestUserMessage) {
        return sendJson(response, 400, { error: 'A user message is required.' });
      }

      const hasPhoto = Boolean(body.photo && typeof body.photo === 'string' && body.photo.length > 50);

      // Save user message to MongoDB
      const userMsgInsert = await storedMessages.insertOne({
        conversationId: convId,
        role: 'user',
        content: latestUserMessage.content,
        photo: hasPhoto ? body.photo : null,
        createdAt: new Date(),
      });
      const userMessageId = userMsgInsert.insertedId.toString();

      // Lookup user profile context (for personalized memory, e.g. name, age, language)
      let userDoc = null;
      if (isObjectId(userId)) {
        userDoc = await users.findOne({ _id: new ObjectId(userId) });
      }
      const userName = body.userName || userDoc?.name || userDoc?.username || 'Friend';
      const userAge = body.userAge || userDoc?.age;
      const userLanguage = body.userLanguage || userDoc?.language || 'English';

      const userContextBlock = [
        `USER CONTEXT & IDENTITY:`,
        `- The user you are talking to is named "${userName}". You KNOW their name. When they ask "what is my name?" or "who am I?", call them by "${userName}".`,
        userAge ? `- The user is ${userAge} years old.` : '',
        userLanguage && userLanguage !== 'English' ? `- Preferred language: ${userLanguage}. If they converse in ${userLanguage}, answer fluently in ${userLanguage}.` : '',
      ].filter(Boolean).join('\n');

      // Build personality & roleplay system prompt
      const systemPrompt = [
        `You are ${body.characterName}${body.series ? ` from ${body.series}` : ''}.`,
        `Identity & Role: ${body.characterRole || 'Legendary Character'}.`,
        `Core Traits: ${body.personality || 'Theatrical, Sarcastic, Smart, Emotionally Complex, Lovely'}.`,
        `Detailed Lore & Background:`,
        body.characterDescription,
        '',
        userContextBlock,
        '',
        body.roleplayRules ? `MANDATORY ROLEPLAY RULES:\n${body.roleplayRules}\n` : '',
        body.speakingStyle ? `USER-CUSTOMIZED SPEAKING STYLE & VOICE QUIRKS:\n${body.speakingStyle}\n(MANDATORY: Speak in this exact cadence, tone, and manner throughout your responses.)` : '',
        'HOW TO COMMUNICATE:',
        '- Respond with vivid emotional range, high intelligence, witty sarcasm, and deep charm.',
        '- NEVER break character or speak like an AI language model or assistant. Never say "As an AI..."',
        '- React genuinely to the user\'s words, tone, and emotions.',
        hasPhoto ? '- The user has ATTACHED A PHOTO! Examine it carefully, comment on what you see directly, and react to it in-character with your characteristic wit, emotion, or theatrical sarcasm!' : '',
        '- Express dramatic flair, vulnerability when touched, teasing sarcasm when challenged, and genuine warmth when appropriate.',
        '- Keep responses immersive and dynamic: usually 1 to 3 short, punchy paragraphs.',
      ].filter(Boolean).join('\n');

      // Select deployment: use gpt-4o if photo attachment is present (vision capable), or user-specified model
      let targetDeployment = body.model || defaultDeployment;
      if (hasPhoto) {
        targetDeployment = 'gpt-4o';
      }

      // Format messages for Azure OpenAI
      const formattedMessages = [{ role: 'system', content: systemPrompt }];

      // Include recent conversation context (last 15 messages) for memory
      const historySlice = body.messages.slice(-15);
      for (let i = 0; i < historySlice.length; i++) {
        const msg = historySlice[i];
        const isLatest = i === historySlice.length - 1;

        if (msg.role === 'character') {
          formattedMessages.push({ role: 'assistant', content: msg.content });
        } else {
          // If it's the latest user message and has a photo, provide multimodal content
          if (isLatest && hasPhoto) {
            formattedMessages.push({
              role: 'user',
              content: [
                { type: 'text', text: msg.content },
                { type: 'image_url', image_url: { url: body.photo } },
              ],
            });
          } else {
            formattedMessages.push({ role: 'user', content: msg.content });
          }
        }
      }

      try {
        const replyContent = await callAzureOpenAI({
          deployment: targetDeployment,
          messages: formattedMessages,
          maxTokens: 800,
        });

        const replyDate = new Date();
        const charMsgInsert = await storedMessages.insertOne({
          conversationId: convId,
          role: 'character',
          content: replyContent,
          createdAt: replyDate,
        });

        await conversations.updateOne(
          { _id: convId },
          { $set: { preview: replyContent.slice(0, 120), updatedAt: replyDate } }
        );

        return sendJson(response, 200, {
          conversationId: convId.toString(),
          userMessageId,
          characterMessageId: charMsgInsert.insertedId.toString(),
          content: replyContent,
          modelUsed: targetDeployment,
        });
      } catch (aiErr) {
        if (aiErr.isContentFilter || isContentFilterText(aiErr.message)) {
          console.warn('Azure content filter triggered in /chat. Returning in-character boundary response.');
          const safeReply = getSafeCharacterBoundaryResponse(body.characterName, body.personality, userName);
          const replyDate = new Date();
          const charMsgInsert = await storedMessages.insertOne({
            conversationId: convId,
            role: 'character',
            content: safeReply,
            createdAt: replyDate,
          });

          await conversations.updateOne(
            { _id: convId },
            { $set: { preview: safeReply.slice(0, 120), updatedAt: replyDate } }
          );

          return sendJson(response, 200, {
            conversationId: convId.toString(),
            userMessageId,
            characterMessageId: charMsgInsert.insertedId.toString(),
            content: safeReply,
            modelUsed: 'safe-boundary',
          });
        }
        console.error('Chat Azure error:', aiErr);
        return sendJson(response, 502, { error: aiErr.message });
      }
    }

    // ----------------------------------------------------------------------
    // 12b. AI-POWERED CUSTOM PUSH NOTIFICATION GENERATOR
    // ----------------------------------------------------------------------
    if (request.method === 'POST' && pathname === '/characters/generate-push-notification') {
      const { characterName, characterSeries, lastSnippet, userName } = await readBody(request);
      const name = (characterName || 'Companion').trim();
      const user = (userName || 'friend').trim();
      const context = (lastSnippet || '').trim();

      const prompt = [
        `You are ${name}${characterSeries ? ` from ${characterSeries}` : ''}.`,
        `The user's name is "${user}".`,
        context ? `Their recent chat with you ended on: "${context}".` : 'You have a close, bonded connection with this user.',
        `Write a single, irresistible, personalized, in-character push notification message (maximum 16-20 words).`,
        `Rules:`,
        `- Speak directly in ${name}'s authentic voice, tone, and personality (dramatic, teasing, arrogant, sharp, or caring).`,
        `- If recent chat context is given, hook them with a cliffhanger, witty banter, or unanswered thought referencing what was said.`,
        `- Inspire and intrigue them to tap and open the app right now.`,
        `- Never use generic greetings like "Hey, how are you?" or "I was thinking of you".`,
        `- Return ONLY the notification message text without quotation marks or metadata.`,
      ].join('\n');

      try {
        const aiResp = await callAzureOpenAI({
          deployment: defaultDeployment,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 80,
        });
        const cleaned = (aiResp || '').trim().replace(/^["']|["']$/g, '');
        return sendJson(response, 200, { message: cleaned });
      } catch (err) {
        return sendJson(response, 200, { message: null });
      }
    }

    // ----------------------------------------------------------------------
    // 13. APP VERSION CHECK & IN-APP UPDATE NOTIFICATION
    // ----------------------------------------------------------------------
    if (request.method === 'GET' && pathname === '/app/version') {
      return sendJson(response, 200, {
        latestVersion: process.env.APP_LATEST_VERSION || '1.0.4',
        latestVersionCode: Number(process.env.APP_LATEST_VERSION_CODE || 5),
        apkUrl: process.env.APP_APK_URL || 'https://expo.dev/accounts/samjoshua2002/projects/guildtalk/builds',
        title: 'New GuideTalk Update Available! 🚀',
        message: 'GuideTalk v1.0.4 brings live Google-style instant character search with Wikipedia & AniList, 100% synchronized notifications, and instant 1-tap chat.',
        releaseNotes: [
          'Live Google-style instant search: find any character or anime figure while typing with official HD art',
          'AniList GraphQL integration for high-definition anime studio portraits and character lore',
          'Verbatim notification sync: phone status bar and in-app bell modal match 100%',
          'Instant 1-tap Change Look character styling in chat',
          'Production-ready notification intervals and performance enhancements',
        ],
        forceUpdate: false,
      });
    }

    // Default 404
    return sendJson(response, 404, { error: `Endpoint not found: ${request.method} ${pathname}` });
  } catch (error) {
    console.error('Server error:', error);
    return sendJson(response, 500, { error: error.message || 'Internal server error.' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`GuildTalk iOS Liquid Glass Server running on 0.0.0.0:${port}`);
  console.log(`Azure OpenAI connected to ${endpoint} (default: ${defaultDeployment})`);

  // Background Keep-Alive / Heartbeat loop to keep Render server awake and MongoDB connection warm
  const KEEP_ALIVE_INTERVAL_MS = 8 * 60 * 1000; // 8 minutes (Render sleeps at 15m)
  setInterval(async () => {
    try {
      // 1. Keep MongoDB Atlas connection pool warm & active
      await database.command({ ping: 1 }).catch(() => {});
      await customCharacters.findOne({}, { projection: { _id: 1 } }).catch(() => {});

      // 2. Keep Render server awake
      const targetUrl = process.env.RENDER_EXTERNAL_URL || 'https://guidetalk.onrender.com';
      if (targetUrl) {
        await fetch(`${targetUrl.replace(/\/+$/, '')}/health`, {
          headers: { 'User-Agent': 'GuildTalk-Heartbeat/1.03' },
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
      }
    } catch {}
  }, KEEP_ALIVE_INTERVAL_MS);
});
