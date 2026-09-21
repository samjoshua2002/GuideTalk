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

// Azure OpenAI caller helper
async function callAzureOpenAI({ deployment = defaultDeployment, messages, maxTokens = 1200 }) {
  const targetDeployment = deployment || 'gpt-5.6-luna';
  const azureUrl = `${endpoint}/openai/deployments/${encodeURIComponent(targetDeployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

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
    throw new Error(`AI model error (${response.status}): ${errorDetails}`);
  }

  const text = result?.choices?.[0]?.message?.content?.trim() ?? '';
  return text;
}

// Real Character Image Search from Web (Google / Bing / Zerochan / DuckDuckGo / Anime CDNs)
// Blocklist of URL patterns that are never real character portraits
const IMAGE_BLOCKLIST = ['.svg', 'amazon', 'imdb', 'icon', 'logo', 'lyrics', 'chord', 'guitar', 'tab', 'song', 'music', 'sheet', 'spotify', 'soundcloud', 'deezer', 'genius.com', 'azlyrics', 'metrolyrics'];

function isValidCharacterImage(url) {
  if (!url || !url.startsWith('http')) return false;
  const lower = url.toLowerCase();
  if (!lower.match(/\.(?:jpg|jpeg|png|webp)/i)) return false;
  return !IMAGE_BLOCKLIST.some((bad) => lower.includes(bad));
}

async function fetchCharacterImage(name, series = '', force = false) {
  const cleanName = (name || '').trim();
  const cleanSeries = (series || '').trim();

  // 1. Jikan API FIRST — Official MyAnimeList HD images (most reliable for anime/game characters)
  try {
    const limit = force ? 5 : 1;
    const jikanUrl = `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(cleanName)}&limit=${limit}`;
    const res = await fetch(jikanUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const entries = data?.data || [];
      if (force && entries.length > 1) {
        const idx = Math.floor(Math.random() * entries.length);
        const img = entries[idx]?.images?.webp?.image_url || entries[idx]?.images?.jpg?.image_url;
        if (img && !img.includes('questionmark') && !img.includes('apple-touch-icon')) return img;
      }
      const img = entries[0]?.images?.webp?.image_url || entries[0]?.images?.jpg?.image_url;
      if (img && !img.includes('questionmark') && !img.includes('apple-touch-icon')) return img;
    }
  } catch {}

  // 2. Genshin Impact Fandom official card check (if Genshin)
  if (
    cleanSeries.toLowerCase().includes('genshin') ||
    ['furina', 'raiden', 'hu tao', 'zhongli', 'nahida', 'yelan', 'neuvillette', 'navia', 'clorinde', 'arlecchino', 'keqing', 'ganyu', 'ayaka'].some((k) =>
      cleanName.toLowerCase().includes(k)
    )
  ) {
    try {
      const charWord = cleanName.split(' ')[0];
      const fandomUrl =
        'https://genshin-impact.fandom.com/api.php?action=query&prop=pageimages&format=json&piprop=original&titles=' +
        encodeURIComponent(charWord);
      const res = await fetch(fandomUrl, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      const pages = data.query?.pages;
      for (const k in pages) {
        if (pages[k].original?.source) return pages[k].original.source;
      }
    } catch {}
  }

  // 3. Safebooru artwork (works for most anime/game characters, not just specific series)
  try {
    const tag = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const offset = force ? Math.floor(Math.random() * 50) : 0;
    const safeUrl =
      `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=10&pid=${offset}&tags=` +
      encodeURIComponent(tag + ' solo');
    const res = await fetch(safeUrl, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const pick = force ? data[Math.floor(Math.random() * data.length)] : data[0];
      return 'https://safebooru.org/images/' + pick.directory + '/' + pick.image;
    }
  } catch {}

  // 4. Bing Image Search with strict character-only filtering
  try {
    const q = cleanSeries
      ? `"${cleanName}" "${cleanSeries}" anime character official art`
      : `"${cleanName}" character official portrait`;
    const offset = force ? Math.floor(Math.random() * 30) : 0;
    const url = 'https://www.bing.com/images/search?q=' + encodeURIComponent(q) + '&form=HDRSC2&first=' + (1 + offset);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const matches = [...html.matchAll(/murl&quot;:&quot;(https?:[^\\&"]+)&quot;/g)];
    if (matches.length > 0) {
      const validMatches = [];
      for (const m of matches) {
        const decoded = decodeURIComponent(m[1]);
        if (isValidCharacterImage(decoded)) {
          validMatches.push(decoded);
        }
      }
      if (validMatches.length > 0) {
        if (force) {
          return validMatches[Math.floor(Math.random() * Math.min(validMatches.length, 10))];
        }
        return validMatches[0];
      }
    }
  } catch (err) {
    console.warn(`Web image search failed for ${cleanName}:`, err.message);
  }

  // 5. Wikipedia API (for famous characters, movies, games, comics)
  try {
    const wikiQuery = cleanSeries ? `${cleanName} (${cleanSeries})` : cleanName;
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(wikiQuery)}&prop=pageimages&format=json&pithumbsize=1000&redirects=1`;
    const res = await fetch(wikiUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      const pages = data?.query?.pages;
      if (pages) {
        for (const k in pages) {
          if (pages[k]?.thumbnail?.source) return pages[k].thumbnail.source;
        }
      }
    }
  } catch {}

  // Fallback to high-res thematic Unsplash visuals
  return null;
}

// Fetch multiple candidate images at once for "Change Look" cycling
async function fetchMultipleCharacterImages(name, series = '', count = 6) {
  const cleanName = (name || '').trim();
  const cleanSeries = (series || '').trim();
  const urls = new Set();

  // Run all sources in parallel for speed
  const fetchers = [];

  // Jikan (up to 5 results)
  fetchers.push((async () => {
    try {
      const res = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(cleanName)}&limit=5`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        for (const entry of (data?.data || [])) {
          const img = entry?.images?.webp?.image_url || entry?.images?.jpg?.image_url;
          if (img && !img.includes('questionmark') && !img.includes('apple-touch-icon')) urls.add(img);
        }
      }
    } catch {}
  })());

  // Safebooru (random page)
  fetchers.push((async () => {
    try {
      const tag = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const offset = Math.floor(Math.random() * 20);
      const res = await fetch(
        `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=10&pid=${offset}&tags=${encodeURIComponent(tag + ' solo')}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          urls.add('https://safebooru.org/images/' + item.directory + '/' + item.image);
        }
      }
    } catch {}
  })());

  // Bing with strict filtering
  fetchers.push((async () => {
    try {
      const q = cleanSeries
        ? `"${cleanName}" "${cleanSeries}" anime character official art`
        : `"${cleanName}" character official portrait`;
      const res = await fetch('https://www.bing.com/images/search?q=' + encodeURIComponent(q) + '&form=HDRSC2&first=1', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(8000),
      });
      const html = await res.text();
      const matches = [...html.matchAll(/murl&quot;:&quot;(https?:[^\\&"]+)&quot;/g)];
      for (const m of matches) {
        const decoded = decodeURIComponent(m[1]);
        if (isValidCharacterImage(decoded)) urls.add(decoded);
      }
    } catch {}
  })());

  await Promise.allSettled(fetchers);
  return [...urls].slice(0, count);
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});

  const url = new URL(request.url ?? '/', `http://localhost:${port}`);
  const pathname = url.pathname;

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
    // DYNAMIC REAL CHARACTER IMAGE SEARCH API (Jikan, Wikipedia, Bing, Booru)
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
        return sendJson(response, 200, { imageUrl: characterImageCache.get(key) });
      }

      // Check DB
      if (!force) {
        const dbCached = await cachedImagesCol.findOne({ key }).catch(() => null);
        if (dbCached?.imageUrl && !dbCached.imageUrl.includes('SAND_Maurice') && !dbCached.imageUrl.includes('questionmark')) {
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

      // Prompt to create 3 distinct versions, iconic roles, or adaptations of this figure/character
      const prompt = [
        `The user is searching for character or figure: "${cleanQ}". Preferred language/region: ${language || 'any'}.`,
        `Generate 3 distinct versions, iconic movie roles, or forms of this character/person.`,
        `Examples:`,
        `- For "Vijay": 1. "Leo Das (Leo)" (Lokesh Cinematic Universe cafe owner & deadly gangster), 2. "JD (Master)" (cool irreverent college professor), 3. "Velu (Ghilli)" (passionate kabaddi champion hero).`,
        `- For "Spider-Man": 1. "Peter Parker (Spider-Man)", 2. "Miles Morales", 3. "Spider-Man 2099".`,
        `- For "Goku": 1. "Son Goku (Base / Martial Artist)", 2. "Super Saiyan Goku", 3. "Ultra Instinct Goku".`,
        `Return ONLY a pure JSON array containing exactly 3 objects with keys:`,
        `[{"name": "...", "series": "...", "role": "...", "shortDescription": "...", "personality": ["..."], "greeting": "..."}]`,
      ].join('\n');

      try {
        const aiResp = await callAzureOpenAI({
          deployment: 'gpt-5.1-chat',
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 800,
        });
        let cleaned = aiResp.trim().replace(/^```json/, '').replace(/```$/, '').trim();
        let candidates = JSON.parse(cleaned);
        if (!Array.isArray(candidates)) candidates = [candidates];

        // Fetch distinct real portraits in parallel
        const list = await Promise.all(
          candidates.slice(0, 3).map(async (c, idx) => {
            const searchQuery = `${c.name} ${c.series || ''}`;
            const img = await fetchCharacterImage(searchQuery, c.series);
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
              return {
                ...doc,
                id: existing._id.toString(),
                mongoId: existing._id.toString(),
                avatarUrl: existing.avatarUrl || imgUrl,
                coverUrl: existing.coverUrl || imgUrl,
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
        const dbItems = await customCharacters.find({}).sort({ createdAt: -1 }).limit(5).toArray();
        const fallback = dbItems.map((item) => ({
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
          avatarUrl: item.avatarUrl,
          coverUrl: item.coverUrl,
          accent: item.accent,
          recommendationReason: 'Trending in Universe',
          isCustom: true,
        }));
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
      const { content: newContent } = await readBody(request);

      if (!isObjectId(conversationId) || !isObjectId(messageId) || !newContent?.trim()) {
        return sendJson(response, 400, { error: 'Invalid parameters or content.' });
      }

      const conv = await conversations.findOne({ _id: new ObjectId(conversationId) });
      if (!conv) return sendJson(response, 404, { error: 'Conversation not found.' });

      const targetMsg = await storedMessages.findOne({ _id: new ObjectId(messageId) });
      if (!targetMsg) return sendJson(response, 404, { error: 'Message not found.' });

      // Update target message
      await storedMessages.updateOne(
        { _id: new ObjectId(messageId) },
        { $set: { content: newContent.trim(), updatedAt: new Date() } }
      );

      // Delete any messages created AFTER this message so we regenerate from this point
      await storedMessages.deleteMany({
        conversationId: conv._id,
        createdAt: { $gt: targetMsg.createdAt },
      });

      // Fetch all messages up to and including the edited message
      const history = await storedMessages.find({ conversationId: conv._id }).sort({ createdAt: 1 }).toArray();

      // Find character lore for prompt
      const charDoc = await customCharacters.findOne({
        $or: [{ _id: isObjectId(conv.characterId) ? new ObjectId(conv.characterId) : null }, { name: conv.characterName }],
      });

      // Lookup user for context
      const userDoc = isObjectId(conv.userId) ? await users.findOne({ _id: new ObjectId(conv.userId) }) : null;
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

      const newReply = await callAzureOpenAI({
        deployment: 'gpt-5.6-luna',
        messages: promptMessages,
        maxTokens: 800,
      });

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
      );

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
      await storedMessages.insertOne({
        conversationId: convId,
        role: 'user',
        content: latestUserMessage.content,
        photo: hasPhoto ? body.photo : null,
        createdAt: new Date(),
      });

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
        await storedMessages.insertOne({
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
          content: replyContent,
          modelUsed: targetDeployment,
        });
      } catch (aiErr) {
        console.error('Chat Azure error:', aiErr);
        return sendJson(response, 502, { error: aiErr.message });
      }
    }

    // ----------------------------------------------------------------------
    // 13. APP VERSION CHECK & IN-APP UPDATE NOTIFICATION
    // ----------------------------------------------------------------------
    if (request.method === 'GET' && pathname === '/app/version') {
      return sendJson(response, 200, {
        latestVersion: process.env.APP_LATEST_VERSION || '1.0.1',
        latestVersionCode: Number(process.env.APP_LATEST_VERSION_CODE || 2),
        apkUrl: process.env.APP_APK_URL || 'https://expo.dev/accounts/samjoshua2002/projects/guildtalk/builds',
        title: 'New GuideTalk Update Available! 🚀',
        message: 'GuideTalk v1.0.1 is here with hourly companion push reminders, live character check-ins, geometric origami app icon, and global cloud sync.',
        releaseNotes: [
          'Hourly push check-ins from your favorite companions with your real name',
          'New in-app Notification Center in Discover tab',
          'Vibrant new geometric cat app icon',
          'Global cloud sync with MongoDB Atlas on Render',
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
});
