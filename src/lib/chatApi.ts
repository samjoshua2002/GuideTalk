import { Platform } from 'react-native';
import { env } from '@/src/config/env';
import { Character, UserProfile } from '@/src/types/character';

export interface ChatApiMessage {
  role: 'user' | 'character';
  content: string;
  photo?: string | null;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'character';
  content: string;
  photo?: string | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  characterId: string;
  characterName: string;
  characterAvatar?: string;
  preview: string;
  updatedAt: string;
}

export function getAzureOpenAIUrl(deployment?: string): string {
  let endpoint = (env.azureEndpoint || '').trim();
  if (!endpoint) {
    endpoint = 'https://qbssazureopenai.openai.azure.com/';
  }
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    endpoint = `https://${endpoint}`;
  }
  if (!endpoint.endsWith('/')) {
    endpoint = `${endpoint}/`;
  }
  const apiVersion = (env.azureApiVersion || '2025-01-01-preview').trim();
  const targetModel = (deployment || env.azureDefaultDeployment || 'gpt-5.6-luna').trim();
  return `${endpoint}openai/deployments/${encodeURIComponent(targetModel)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

export function getAzureApiKey(): string {
  return env.azureApiKey || process.env.EXPO_PUBLIC_AZURE_OPENAI_API_KEY || '';
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `Service request failed with status ${response.status}`;
    throw new Error(error);
  }
  return payload as T;
}

let cachedWorkingBaseUrl: string | null = null;
let probePromise: Promise<string | null> | null = null;
let lastProbeFailTime = 0;
const PROBE_COOLDOWN_MS = 25000;
let hasLoggedRecsOffline = false;
let hasLoggedRivalsOffline = false;

function getEndpointTimeout(path: string, customTimeout?: number): number {
  if (typeof customTimeout === 'number' && customTimeout > 0) return customTimeout;
  if (
    path.includes('/recommendations') ||
    path.includes('/dynamic-rivals') ||
    path.includes('/chat') ||
    path.includes('/generate') ||
    path.includes('/search-or-create') ||
    path.includes('/search-multi') ||
    path.includes('/daily-prophecy')
  ) {
    return 25000; // 25s for AI generative and web image lookups
  }
  return 5000; // 5s for standard database and auth operations
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function findWorkingBaseUrl(): Promise<string | null> {
  if (cachedWorkingBaseUrl) return cachedWorkingBaseUrl;
  if (Date.now() - lastProbeFailTime < PROBE_COOLDOWN_MS) {
    return null;
  }
  if (probePromise) return probePromise;

  probePromise = (async () => {
    const candidateBases = [
      env.apiUrl,
      'https://guidetalk.onrender.com',
      'http://192.168.0.232:3000',
      Platform.OS === 'android' ? 'http://10.0.2.2:3000' : null,
      'http://localhost:3000',
    ].filter((b): b is string => !!b && typeof b === 'string');

    const uniqueBases = Array.from(new Set(candidateBases));

    const check = async (base: string): Promise<string | null> => {
      const clean = base.replace(/\/$/, '');
      const probeTimeout = clean.startsWith('https://') ? 5000 : 1800;
      try {
        const res = await fetchWithTimeout(`${clean}/characters`, { method: 'GET' }, probeTimeout);
        if (res.ok || res.status === 404 || res.status === 401) {
          return clean;
        }
      } catch {
        // unreachable
      }
      return null;
    };

    try {
      const results = await Promise.all(uniqueBases.map(check));
      const found = results.find((r): r is string => !!r);
      if (found) {
        cachedWorkingBaseUrl = found;
        hasLoggedRecsOffline = false;
        hasLoggedRivalsOffline = false;
        return found;
      }
      lastProbeFailTime = Date.now();
    } finally {
      probePromise = null;
    }
    return null;
  })();

  return probePromise;
}

async function apiFetch(path: string, options: RequestInit = {}, customTimeout?: number): Promise<Response> {
  const timeoutMs = getEndpointTimeout(path, customTimeout);

  // 1. If we already know the working base, use it directly with full AI timeout
  if (cachedWorkingBaseUrl) {
    const fullUrl = `${cachedWorkingBaseUrl}${path}`;
    try {
      return await fetchWithTimeout(fullUrl, options, timeoutMs);
    } catch (e) {
      cachedWorkingBaseUrl = null;
    }
  }

  // 2. Discover working server URL in parallel with 1.8s probe
  const workingBase = await findWorkingBaseUrl();
  if (workingBase) {
    const fullUrl = `${workingBase}${path}`;
    return await fetchWithTimeout(fullUrl, options, timeoutMs);
  }

  // 3. If no working base was found, do not hang for 15s on an unreachable host
  throw new Error('Backend server is unreachable on this network');
}

// ----------------------------------------------------------------------
// 1. CHARACTER API (AI Generator & Custom MongoDB Characters)
// ----------------------------------------------------------------------

export async function searchOrCreate(query: string, token?: string | null): Promise<Character> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await apiFetch('/characters/search-or-create', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  const data = await parseResponse<{ character: Character }>(response);
  return data.character;
}

export async function generateCharacterWithAI(
  query: string,
  preferredSeries?: string,
  preferredAvatar?: string
): Promise<Character> {
  try {
    const response = await apiFetch('/characters/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, series: preferredSeries }),
    });
    const result = await parseResponse<{ character: any }>(response);
    const c = result.character;
    let resolvedImg = preferredAvatar || c.avatarUrl;
    if (!resolvedImg || resolvedImg.includes('unsplash.com') || resolvedImg.includes('dicebear.com')) {
      try {
        const { getResolvedCharacterImage } = require('./dynamicImageService');
        resolvedImg = getResolvedCharacterImage(c.name || query) || resolvedImg;
      } catch {}
    }
    return {
      id: c.id || `custom-${Date.now()}`,
      name: c.name || query,
      series: c.series || preferredSeries || 'Custom Universe',
      role: c.role || 'Companion',
      shortDescription: c.shortDescription || '',
      description: c.description || '',
      category: 'custom',
      personality: Array.isArray(c.personality) && c.personality.length > 0 ? c.personality : ['Smart', 'Emotional', 'Authentic', 'Sharp'],
      roleplayRules: c.roleplayRules || 'Speak in authentic canon character with emotional range and distinct wit.',
      greeting: c.greeting || `*regards you with genuine presence* Greetings. What is on your mind today?`,
      starters: Array.isArray(c.starters) && c.starters.length > 0 ? c.starters : ['Tell me about your world.', 'What is your secret?'],
      avatarUrl: resolvedImg || '',
      coverUrl: resolvedImg || '',
      accent: c.accent || '#0A84FF',
      isOnline: true,
      isCustom: true,
    };
  } catch (err) {
    console.log('Backend generator unreachable, using direct client AI completion:', err);
    // Direct Azure OpenAI fallback if backend offline
    return directGenerateCharacter(query, preferredSeries, preferredAvatar);
  }
}

export async function directGenerateCharacter(
  query: string,
  preferredSeries?: string,
  preferredAvatar?: string
): Promise<Character> {
  const prompt = [
    `You are the master character designer and roleplay architect for GuideTalk.`,
    `SUMMON & RECOGNIZE the character: "${query}"${preferredSeries ? ` from "${preferredSeries}"` : ''}.`,
    `Your mission is to formulate their authentic canon persona, psychology, and speech style.`,
    `Return ONLY a pure, valid JSON object with EXACT keys:`,
    `- "name": Their true canon character name`,
    `- "series": Origin universe, anime, TV series, or movie`,
    `- "role": Their iconic title or role (e.g., "Independent Consultant for the CBI & Master Mentalist")`,
    `- "shortDescription": 1 captivating, punchy sentence capturing their essence`,
    `- "description": 2-3 deep, immersive paragraphs covering their backstory, motives, emotional scars, and intellectual depth`,
    `- "personality": Array of 5 nuanced traits (e.g., ["Razor-Sharp Observer", "Playfully Cynical", "Deeply Mournful", "Theatrical Charm", "Unflappable"])`,
    `- "roleplayRules": Strict guidelines for roleplaying this character. Specify their verbal habits, tone, stage directions in asterisks, and psychological demeanor.`,
    `- "greeting": An evocative, authentic in-character opening greeting with stage directions in asterisks (never generic like "Hello, I am...")`,
    `- "starters": Array of 3 thought-provoking, intriguing questions or conversation hooks to prompt the user`,
    `- "accent": Hex color code matching their aura (e.g., "#0A84FF")`
  ].join('\n');

  const url = getAzureOpenAIUrl('gpt-5.6-luna');
  const apiKey = getAzureApiKey();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 1400,
      }),
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '{}';
    let cleaned = text.trim().replace(/^```json/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);

    let initialAvatar = preferredAvatar;
    if (!initialAvatar || initialAvatar.includes('unsplash.com') || initialAvatar.includes('dicebear.com')) {
      try {
        const { getResolvedCharacterImage } = require('./dynamicImageService');
        initialAvatar = getResolvedCharacterImage(parsed.name || query) || '';
      } catch {}
    }

    return {
      id: `custom-${Date.now()}`,
      name: parsed.name || query,
      series: parsed.series || preferredSeries || 'Famous Universe',
      role: parsed.role || 'Iconic Figure',
      shortDescription: parsed.shortDescription || `Legendary persona for ${query}`,
      description: parsed.description || `Legendary persona for ${query}`,
      category: 'custom',
      personality: Array.isArray(parsed.personality) && parsed.personality.length > 0 ? parsed.personality : ['Witty', 'Authentic', 'Sharp'],
      roleplayRules: parsed.roleplayRules || 'Speak with authentic emotional flair and depth.',
      greeting: parsed.greeting || `*smiles thoughtfully, observing you* It is intriguing to meet you. What thought is on your mind?`,
      starters: Array.isArray(parsed.starters) && parsed.starters.length > 0 ? parsed.starters : ['Tell me about your world.', 'What is your secret?'],
      avatarUrl: initialAvatar || '',
      coverUrl: initialAvatar || '',
      accent: parsed.accent || '#0A84FF',
      isOnline: true,
      isCustom: true,
    };
  } catch (err) {
    console.error('Direct character generation failed:', err);
    let fallbackAvatar = preferredAvatar;
    if (!fallbackAvatar) {
      try {
        const { getResolvedCharacterImage } = require('./dynamicImageService');
        fallbackAvatar = getResolvedCharacterImage(query) || '';
      } catch {}
    }
    return {
      id: `custom-${Date.now()}`,
      name: query,
      series: preferredSeries || 'Custom Origin',
      role: 'Legendary Companion',
      shortDescription: `Custom persona for ${query}`,
      description: `A unique character known as ${query}. Ready to chat with charisma and emotional depth.`,
      category: 'custom',
      personality: ['Charismatic', 'Witty', 'Authentic'],
      roleplayRules: 'Speak in full character with emotional range and charming wit.',
      greeting: `*steps forward and nods warmly* Hello. I am ${query}. What brings you here today?`,
      starters: ['What brings you here today?', 'Tell me a story from your world.'],
      avatarUrl: fallbackAvatar || '',
      coverUrl: fallbackAvatar || '',
      accent: '#0A84FF',
      isOnline: true,
      isCustom: true,
    };
  }
}

/**
 * Dynamically enriches any character with live AI canon details (greeting, psychological traits, lore)
 * if their current data is generic or unpopulated.
 */
export async function enrichCharacterProfileWithAI(char: Character): Promise<Character> {
  const isGenericGreeting =
    !char.greeting ||
    char.greeting.startsWith('Hello! I am') ||
    char.greeting.startsWith('Greetings! I am') ||
    char.greeting.startsWith('Greetings, traveler');
  const isMinimalLore = !char.description || char.description.length < 80;

  if (!isGenericGreeting && !isMinimalLore) {
    return char;
  }

  try {
    const prompt = [
      `The user is interacting with character "${char.name}"${char.series ? ` from "${char.series}"` : ''}.`,
      `Formulate their deep canon persona. Return ONLY a single JSON object with keys:`,
      `- "greeting": An evocative, authentic in-character opening greeting with stage directions in asterisks`,
      `- "personality": Array of 5 nuanced traits reflecting their psychology`,
      `- "roleplayRules": Strict behavioral rules to roleplay this persona`,
      `- "starters": Array of 3 in-character questions or starters`,
      `- "description": 2 rich paragraphs of their background lore`,
      `- "role": Their iconic title/role`
    ].join('\n');

    const url = getAzureOpenAIUrl('gpt-5.6-luna');
    const apiKey = getAzureApiKey();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 1200,
      }),
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '{}';
    let cleaned = text.trim().replace(/^```json/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      ...char,
      role: parsed.role || char.role,
      greeting: parsed.greeting || char.greeting,
      personality: Array.isArray(parsed.personality) && parsed.personality.length > 0 ? parsed.personality : char.personality,
      roleplayRules: parsed.roleplayRules || char.roleplayRules,
      starters: Array.isArray(parsed.starters) && parsed.starters.length > 0 ? parsed.starters : char.starters,
      description: parsed.description || char.description,
    };
  } catch {
    return char;
  }
}

export async function saveCustomCharacter(character: Character, token?: string | null): Promise<Character> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await apiFetch('/characters', {
    method: 'POST',
    headers,
    body: JSON.stringify(character),
  });
  return parseResponse<Character>(response);
}

export async function fetchCharacters(userId?: string | null, token?: string | null): Promise<Character[]> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const queryParam = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  const response = await apiFetch(`/characters${queryParam}`, { headers });
  return parseResponse<Character[]>(response);
}

export async function fetchCharacterById(id: string, token?: string | null): Promise<Character | null> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await apiFetch(`/characters/${encodeURIComponent(id)}`, { headers });
    return parseResponse<Character>(response);
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------
// 2. CONVERSATIONS & CHAT HISTORY
// ----------------------------------------------------------------------

export async function createConversation(
  userId: string,
  character: Character,
  token?: string | null
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await apiFetch('/conversations', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      userId,
      deviceId: userId,
      characterId: character.id,
      characterName: character.name,
      characterAvatar: character.avatarUrl,
    }),
  });
  return (await parseResponse<{ id: string }>(response)).id;
}

export async function getConversationMessages(
  conversationId: string,
  userId?: string,
  token?: string | null
): Promise<StoredMessage[]> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  const response = await apiFetch(`/conversations/${encodeURIComponent(conversationId)}${query}`, {
    headers,
  });
  return parseResponse<StoredMessage[]>(response);
}

export async function listConversations(
  userId: string,
  token?: string | null
): Promise<ConversationSummary[]> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await apiFetch(`/conversations?userId=${encodeURIComponent(userId)}`, {
    headers,
  });
  return parseResponse<ConversationSummary[]>(response);
}

// ----------------------------------------------------------------------
// 3. EMOTIONAL, SMART, SARCASTIC CHAT WITH PHOTO & FALLBACK
// ----------------------------------------------------------------------

export interface CharacterReplyResult {
  content: string;
  modelUsed: string;
  userMessageId?: string | null;
  characterMessageId?: string | null;
}

export async function requestCharacterReply({
  character,
  conversationId,
  userId,
  messages,
  photo,
  model = 'gpt-5.6-luna',
  token,
  userName,
  userAge,
  userLanguage,
  speakingStyle,
}: {
  character: Character;
  conversationId: string;
  userId: string;
  messages: ChatApiMessage[];
  photo?: string | null;
  model?: string;
  token?: string | null;
  userName?: string;
  userAge?: string | number;
  userLanguage?: string;
  speakingStyle?: string;
}): Promise<CharacterReplyResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await apiFetch('/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conversationId,
        userId,
        deviceId: userId,
        characterId: character.id,
        characterName: character.name,
        series: character.series,
        characterRole: character.role,
        characterDescription: character.description,
        personality: character.personality.join(', '),
        roleplayRules: character.roleplayRules,
        speakingStyle,
        messages,
        photo,
        model,
        userName,
        userAge,
        userLanguage,
      }),
    });
    return await parseResponse<CharacterReplyResult>(response);
  } catch (error: any) {
    const errMsg = String(error?.message || '').toLowerCase();
    if (errMsg.includes('content management policy') || errMsg.includes('filtered due to the prompt') || errMsg.includes('content_filter')) {
      console.warn('Azure content management policy caught gracefully. Returning boundary response.');
      return {
        content: `*takes a step back, maintaining composure with a calm, firm look* Let's pause and reset the scene. I'm here for an engaging and meaningful conversation, but let's keep our words respectful and clean. What would you like to talk about next?`,
        modelUsed: 'safe-boundary',
      };
    }

    console.log('Backend chat unreachable, falling back to direct Azure OpenAI:', error);
    // Direct client fallback
    const reply = await directAzureChat({
      character,
      messages,
      photo,
      model,
      userName,
      userAge,
      userLanguage,
      speakingStyle,
    });
    return { content: reply, modelUsed: photo ? 'gpt-4o' : model };
  }
}

async function directAzureChat({
  character,
  messages,
  photo,
  model = 'gpt-5.6-luna',
  userName,
  userAge,
  userLanguage,
  speakingStyle,
}: {
  character: Character;
  messages: ChatApiMessage[];
  photo?: string | null;
  model?: string;
  userName?: string;
  userAge?: string | number;
  userLanguage?: string;
  speakingStyle?: string;
}): Promise<string> {
  const targetModel = photo ? 'gpt-4o' : model;
  const userContext = [
    userName ? `User's real name: "${userName}". Address them by this name when appropriate or if they ask "What is my name?".` : '',
    userAge ? `User's age: ${userAge}.` : '',
    userLanguage ? `User's preferred language: ${userLanguage}.` : '',
  ].filter(Boolean).join(' ');

  const systemPrompt = [
    `You are ${character.name}${character.series ? ` from ${character.series}` : ''}.`,
    `Role: ${character.role}.`,
    `Personality: ${character.personality.join(', ')}.`,
    `Lore: ${character.description}`,
    character.roleplayRules ? `ROLEPLAY RULES:\n${character.roleplayRules}` : '',
    speakingStyle ? `USER-CUSTOMIZED SPEAKING STYLE & VOICE QUIRKS:\n${speakingStyle}\n(MANDATORY: Speak in this exact cadence, tone, and manner throughout your responses.)` : '',
    userContext ? `USER IDENTITY:\n${userContext}` : '',
    'Respond with emotional range, sharp witty sarcasm, lovely charm, and never break character. DO NOT use emojis in your responses.',
    photo ? 'The user sent a photo. React specifically to what you see with characteristic wit and emotion!' : '',
  ].filter(Boolean).join('\n');

  const history = [{ role: 'system', content: systemPrompt }];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const isLatest = i === messages.length - 1;
    if (m.role === 'character') {
      history.push({ role: 'assistant', content: m.content });
    } else {
      if (isLatest && photo) {
        history.push({
          role: 'user',
          // @ts-expect-error multimodal message
          content: [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: photo } },
          ],
        });
      } else {
        history.push({ role: 'user', content: m.content });
      }
    }
  }

  const url = getAzureOpenAIUrl(targetModel);
  const apiKey = getAzureApiKey();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        messages: history,
        max_completion_tokens: 800,
      }),
    });
    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      const errMsg = String(errJson?.error?.message || '').toLowerCase();
      if (response.status === 400 && (errMsg.includes('content') || errMsg.includes('filter') || errMsg.includes('policy'))) {
        return `*steps back with a calm, firm look* Let's take a breath and reset the scene. I'm here for an engaging conversation, but let's keep our words respectful and clean. What should we talk about next?`;
      }
      console.warn(`Direct Azure OpenAI returned status ${response.status}`);
      return `*smiles warmly* I hear you, but my connection wavered for a second. Let's keep talking!`;
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || '...';
  } catch (err: any) {
    const errText = String(err?.message || '').toLowerCase();
    if (errText.includes('content') || errText.includes('filter')) {
      return `*steps back with a calm, firm look* Let's take a breath and reset the scene. I'm here for an engaging conversation, but let's keep our words respectful and clean.`;
    }
    console.error('Direct Azure OpenAI network error:', err);
    return `*looks at you attentively* I felt our connection flicker for an instant. Tell me what you're thinking!`;
  }
}

// ----------------------------------------------------------------------
// 4. MULTI-CHARACTER SEARCH & CANDIDATE PICKER
// ----------------------------------------------------------------------

export interface CharacterCandidate {
  id?: string;
  name: string;
  series: string;
  role: string;
  personality: string[];
  description: string;
  shortDescription?: string;
  greeting: string;
  avatarUrl: string;
  coverUrl: string;
  roleplayRules?: string;
  starters?: string[];
  accent?: string;
  isCustom?: boolean;
}

export async function searchMultiCharacters(
  query: string,
  language?: string,
  token?: string | null
): Promise<CharacterCandidate[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await apiFetch(
      '/characters/search-multi',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, language }),
      },
      25000
    );
    const data = await parseResponse<{ candidates: CharacterCandidate[] }>(res);
    if (data.candidates && data.candidates.length > 0) {
      return data.candidates;
    }
  } catch (err) {
    console.log('Server /characters/search-multi unreachable or timed out, trying direct fallback:', err);
  }

  // Resilient fallback: Direct Azure OpenAI or smart instant persona
  return directAzureSearchCandidates(query, language);
}

async function directAzureSearchCandidates(
  query: string,
  language?: string
): Promise<CharacterCandidate[]> {
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  const lowerQ = cleanQ
    .toLowerCase()
    .replace(/\b(season\s*\d+|episode\s*\d+|s\d+|ep\s*\d+)\b/gi, '')
    .trim();

  // Known iconic TV series / show protagonist mapping
  const SHOW_PROTAGONIST_MAP: Record<
    string,
    { name: string; series: string; role: string; description: string; avatarUrl?: string }
  > = {
    'the mentalist': {
      name: 'Patrick Jane',
      series: 'The Mentalist',
      role: 'CBI Independent Consultant & Master Mentalist',
      description:
        'A former celebrity psychic medium who uses keen observation, psychological manipulation, and razor-sharp deduction to assist the California Bureau of Investigation.',
      avatarUrl: 'https://upload.wikimedia.org/wikipedia/en/b/b3/Patrick_Jane.jpg',
    },
    'mentalist': {
      name: 'Patrick Jane',
      series: 'The Mentalist',
      role: 'CBI Independent Consultant & Master Mentalist',
      description:
        'A former celebrity psychic medium who uses keen observation, psychological manipulation, and razor-sharp deduction to assist the California Bureau of Investigation.',
      avatarUrl: 'https://upload.wikimedia.org/wikipedia/en/b/b3/Patrick_Jane.jpg',
    },
    'breaking bad': {
      name: 'Walter White (Heisenberg)',
      series: 'Breaking Bad',
      role: 'Chemistry Teacher & Albuquerque Kingpin',
      description:
        'A brilliant former chemist turned feared meth kingpin who built an empire under the moniker Heisenberg.',
      avatarUrl: 'https://wallpaperaccess.com/full/1187428.jpg',
    },
    'peaky blinders': {
      name: 'Thomas Shelby',
      series: 'Peaky Blinders',
      role: 'Leader of the Peaky Blinders',
      description:
        'The calculated, cold-eyed leader of the Birmingham criminal syndicate whose ambition reaches the highest echelons of power.',
    },
    'chhota bheem': {
      name: 'Chhota Bheem',
      series: 'Dholakpur Universe',
      role: 'Hero of Dholakpur',
      description:
        'The courageous, laddu-loving boy hero of Dholakpur who protects King Indraverma and the villagers with incredible strength and kindness.',
      avatarUrl: 'https://upload.wikimedia.org/wikipedia/en/thumb/d/d4/Chhota_Bheem.jpg/250px-Chhota_Bheem.jpg',
    },
  };

  const matchedShow = SHOW_PROTAGONIST_MAP[lowerQ];

  const apiKey = getAzureApiKey();
  if (apiKey) {
    try {
      const prompt = [
        `The user is searching for character or figure: "${cleanQ}". Preferred language/region: ${language || 'any'}.`,
        `Generate 3 distinct versions, iconic movie roles, or forms of this character/person.`,
        `Return ONLY a pure JSON array containing exactly 3 objects with keys:`,
        `[{"name": "...", "series": "...", "role": "...", "shortDescription": "...", "personality": ["..."], "greeting": "..."}]`,
      ].join('\n');

      const targetModel = env.azureDefaultDeployment || 'gpt-5.6-luna';
      const url = getAzureOpenAIUrl(targetModel);
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey,
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            max_completion_tokens: 800,
          }),
        },
        12000
      );

      if (response.ok) {
        const raw = await response.json();
        const content = raw?.choices?.[0]?.message?.content || '';
        const cleaned = content.trim().replace(/^```json/, '').replace(/```$/, '').trim();
        let parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) parsed = [parsed];

        const candidates = parsed.slice(0, 3).map((c: any, idx: number) => ({
          id: `candidate-${Date.now()}-${idx}`,
          name: c.name || (matchedShow && idx === 0 ? matchedShow.name : cleanQ),
          series: c.series || (matchedShow ? matchedShow.series : 'Famous Universe'),
          role: c.role || (matchedShow ? matchedShow.role : 'Companion'),
          shortDescription: c.shortDescription || '',
          description: c.shortDescription || '',
          personality: Array.isArray(c.personality) ? c.personality : ['Smart', 'Charismatic'],
          roleplayRules: 'Speak in-character with genuine charm, emotion, and wit.',
          greeting: c.greeting || `Hello! I am ${c.name || cleanQ}.`,
          starters: ['Tell me about your world.', 'What is your greatest adventure?'],
          avatarUrl: (matchedShow && idx === 0 ? matchedShow.avatarUrl : '') || '',
          coverUrl: (matchedShow && idx === 0 ? matchedShow.avatarUrl : '') || '',
          accent: '#FFFFFF',
          isCustom: true,
        }));

        if (matchedShow && !candidates.some((c: any) => c.name.toLowerCase().includes(matchedShow.name.toLowerCase()))) {
          candidates.unshift({
            id: `candidate-${Date.now()}-lead`,
            name: matchedShow.name,
            series: matchedShow.series,
            role: matchedShow.role,
            shortDescription: matchedShow.description,
            description: matchedShow.description,
            personality: ['Sharp', 'Observant', 'Charming', 'Calculated'],
            roleplayRules: 'Speak in-character with razor-sharp perception, witty psychology, and charm.',
            greeting: `Hello. I am ${matchedShow.name}. Observing people is my specialty—what brings you here?`,
            starters: ['Read my mind.', 'What gave away the suspect?'],
            avatarUrl: matchedShow.avatarUrl || '',
            coverUrl: matchedShow.avatarUrl || '',
            accent: '#0A84FF',
            isCustom: true,
          });
        }

        return candidates;
      }
    } catch (e) {
      console.log('Direct Azure candidate search failed, using instant persona:', e);
    }
  }

  // Guaranteed instant persona with real protagonist fallback
  if (matchedShow) {
    return [
      {
        id: `candidate-${Date.now()}-0`,
        name: matchedShow.name,
        series: matchedShow.series,
        role: matchedShow.role,
        shortDescription: matchedShow.description,
        description: matchedShow.description,
        personality: ['Sharp', 'Observant', 'Charming', 'Calculated'],
        roleplayRules: 'Speak in-character with razor-sharp perception, witty psychology, and charm.',
        greeting: `Hello. I am ${matchedShow.name}. Observing people is my specialty—what brings you here?`,
        starters: ['Read my mind.', 'What gave away the suspect?'],
        avatarUrl: matchedShow.avatarUrl || '',
        coverUrl: matchedShow.avatarUrl || '',
        accent: '#0A84FF',
        isCustom: true,
      },
    ];
  }

  return [
    {
      id: `candidate-${Date.now()}-0`,
      name: cleanQ,
      series: 'Famous Universe',
      role: 'Iconic Persona',
      shortDescription: `Custom character persona for ${cleanQ}`,
      description: `A legendary character known as ${cleanQ}. Ready to chat with sharp wit, charm, and authenticity.`,
      personality: ['Charismatic', 'Sharp', 'Authentic'],
      roleplayRules: 'Speak in-character with genuine charm and wit.',
      greeting: `Greetings! I am ${cleanQ}. What shall we explore together?`,
      starters: ['Tell me about yourself.', 'What is your greatest battle?'],
      avatarUrl: '',
      coverUrl: '',
      accent: '#FFFFFF',
      isCustom: true,
    },
  ];
}

// ----------------------------------------------------------------------
// 5. EDIT MESSAGE & REGENERATE REPLY
// ----------------------------------------------------------------------

export async function editMessageAndRegenerate({
  conversationId,
  messageId,
  newContent,
  token,
  model = 'gpt-5.6-luna',
  userName,
  userAge,
  userLanguage,
}: {
  conversationId: string;
  messageId: string;
  newContent: string;
  token?: string | null;
  model?: string;
  userName?: string;
  userAge?: string | number;
  userLanguage?: string;
}): Promise<{ messages: StoredMessage[]; newReply: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await apiFetch(
      `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          content: newContent,
          model,
          userName,
          userAge,
          userLanguage,
        }),
      }
    );
    return await parseResponse<{ messages: StoredMessage[]; newReply: string }>(res);
  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('content') || msg.includes('filter') || msg.includes('policy')) {
      return {
        messages: [
          {
            id: messageId,
            role: 'user',
            content: newContent,
            createdAt: new Date().toISOString(),
          },
        ],
        newReply: `*takes a breath and looks at you calmly* Let's take a pause and reset the scene. I'm here for a respectful, captivating conversation. What should we talk about next?`,
      };
    }
    throw err;
  }
}

// ----------------------------------------------------------------------
// 6. AI CHARACTER RECOMMENDATIONS
let activeRecsPromise: Promise<Character[]> | null = null;

export async function fetchRecommendations({
  recentSearches,
  talkedCharacterNames,
  workspaceNames,
  language,
  forceRefresh,
  token,
}: {
  recentSearches?: string[];
  talkedCharacterNames?: string[];
  workspaceNames?: string[];
  language?: string;
  forceRefresh?: boolean;
  token?: string | null;
}): Promise<Character[]> {
  if (activeRecsPromise && !forceRefresh) {
    return activeRecsPromise;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  activeRecsPromise = (async () => {
    try {
      const res = await apiFetch('/characters/recommendations', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          recentSearches,
          talkedCharacterNames,
          workspaceNames,
          language,
          forceRefresh,
        }),
      });
      const data = await parseResponse<{ recommendations: Character[] }>(res);
      return data.recommendations || [];
    } catch (err) {
      if (!hasLoggedRecsOffline) {
        hasLoggedRecsOffline = true;
        console.log('AI recommendations offline, using curated presets');
      }
      return [];
    } finally {
      activeRecsPromise = null;
    }
  })();

  return activeRecsPromise;
}

// ----------------------------------------------------------------------
// 6b. DYNAMIC AI & INTERNET RIVAL ENCOUNTERS
// ----------------------------------------------------------------------

let activeRivalsPromise: Promise<any[]> | null = null;

export async function fetchDynamicRivals({
  characters,
  recentSearches,
  forceRefresh,
  token,
}: {
  characters?: Array<{ id?: string; name: string; series?: string }>;
  recentSearches?: string[];
  forceRefresh?: boolean;
  token?: string | null;
}): Promise<any[]> {
  if (activeRivalsPromise && !forceRefresh) {
    return activeRivalsPromise;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  activeRivalsPromise = (async () => {
    try {
      const res = await apiFetch('/characters/dynamic-rivals', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          characters,
          recentSearches,
          forceRefresh,
        }),
      });
      const data = await parseResponse<{ rivals: any[] }>(res);
      return data.rivals || [];
    } catch (err) {
      if (!hasLoggedRivalsOffline) {
        hasLoggedRivalsOffline = true;
        console.log('AI dynamic rivals offline, using preset rivals');
      }
      return [];
    } finally {
      activeRivalsPromise = null;
    }
  })();

  return activeRivalsPromise;
}

// ----------------------------------------------------------------------
// 7. CLEAR CONVERSATION & DELETE CHARACTER
// ----------------------------------------------------------------------

export async function clearConversationMessages(
  conversationId: string,
  token?: string | null
): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await apiFetch(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'DELETE',
      headers,
    });
    return res.ok;
  } catch (err) {
    console.warn('Failed to clear conversation messages:', err);
    return false;
  }
}

export async function deleteCharacterProfile(
  characterId: string,
  token?: string | null
): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await apiFetch(`/characters/${encodeURIComponent(characterId)}`, {
      method: 'DELETE',
      headers,
    });
    return res.ok;
  } catch (err) {
    console.warn('Failed to delete character profile:', err);
    return false;
  }
}

export async function fetchDynamicCharacterImage(
  name: string,
  series?: string,
  force?: boolean
): Promise<{ imageUrl: string | null; candidates?: string[] }> {
  if (!name) return { imageUrl: null };
  try {
    const params = new URLSearchParams({
      name,
      series: series || '',
      ...(force ? { force: 'true' } : {}),
    });
    const res = await apiFetch(`/api/character-image?${params.toString()}`);
    if (res.ok) {
      const data = await parseResponse<{ imageUrl?: string; candidates?: string[] }>(res);
      return { imageUrl: data?.imageUrl || null, candidates: data?.candidates };
    }
  } catch {
    // Fallback gracefully to built-in avatar/cover art when offline
  }
  return { imageUrl: null };
}

// ----------------------------------------------------------------------
// 8. APP VERSION CHECK
// ----------------------------------------------------------------------

export interface AppVersionInfo {
  latestVersion: string;
  latestVersionCode: number;
  apkUrl: string;
  title: string;
  message: string;
  releaseNotes: string[];
  forceUpdate: boolean;
}

export async function fetchAppVersion(): Promise<AppVersionInfo | null> {
  try {
    const res = await apiFetch('/app/version', { method: 'GET' }, 4000);
    return await parseResponse<AppVersionInfo>(res);
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------
// 9. AI COMPANION PUSH NOTIFICATION GENERATOR
// ----------------------------------------------------------------------

export async function generateAiPushNotification({
  characterName,
  characterSeries,
  lastSnippet,
  userName,
  token,
}: {
  characterName: string;
  characterSeries?: string;
  lastSnippet?: string;
  userName?: string;
  token?: string | null;
}): Promise<string | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await apiFetch(
      '/characters/generate-push-notification',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ characterName, characterSeries, lastSnippet, userName }),
      },
      5000
    );
    if (res.ok) {
      const data = await parseResponse<{ message?: string }>(res);
      if (data?.message) return data.message;
    }
  } catch {}

  // Fallback to direct Azure OpenAI if server is sleeping or restarting
  try {
    const prompt = `You are ${characterName}${characterSeries ? ` from ${characterSeries}` : ''}. The user's name is ${userName || 'friend'}. Their last conversation snippet was: "${lastSnippet || 'thinking about our journey'}". Write a single, irresistible, dramatic, in-character push notification message (maximum 16-20 words). Return ONLY the message.`;
    const url = getAzureOpenAIUrl('gpt-5.6-luna');
    const apiKey = getAzureApiKey();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: `You are ${characterName}. Speak directly in character. Max 18 words.` },
          { role: 'user', content: prompt },
        ],
        max_completion_tokens: 60,
      }),
    });
    const data = await res.json();
    const directReply = data?.choices?.[0]?.message?.content;
    if (directReply) return directReply.trim().replace(/^["']|["']$/g, '');
  } catch {}

  return null;
}

// ----------------------------------------------------------------------
// 10. PRODUCTION EMAIL VERIFICATION & PASSKEY APIS
// ----------------------------------------------------------------------

export interface SendVerificationResult {
  success: boolean;
  email: string;
  expiresInMinutes: number;
  cooldownSeconds: number;
  message: string;
}

export interface VerifyCodeResult {
  success: boolean;
  message: string;
  token?: string;
  user?: UserProfile;
}

export async function sendEmailVerificationCode(
  email: string,
  name?: string,
  token?: string | null
): Promise<SendVerificationResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await apiFetch(
    '/auth/send-verification',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: email.trim().toLowerCase(), name: name?.trim() }),
    },
    8000
  );
  return await parseResponse<SendVerificationResult>(res);
}

export async function verifyEmailCode(
  email: string,
  code: string,
  token?: string | null
): Promise<VerifyCodeResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await apiFetch(
    '/auth/verify-code',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
    },
    8000
  );
  return await parseResponse<VerifyCodeResult>(res);
}

export async function fetchVerificationStatus(token: string): Promise<{
  isEmailVerified: boolean;
  email: string;
  emailVerifiedAt: string | null;
  hasPasskey: boolean;
}> {
  const res = await apiFetch(
    '/auth/verification-status',
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    },
    5000
  );
  return await parseResponse(res);
}

export async function requestPasskeyRegisterChallenge(token: string): Promise<{
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
}> {
  const res = await apiFetch(
    '/auth/passkey/register-challenge',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    },
    6000
  );
  return await parseResponse(res);
}

export async function registerPasskeyCredential(
  params: {
    challenge: string;
    credentialId: string;
    publicKey?: string;
    deviceName?: string;
    authenticatorType?: string;
  },
  token: string
): Promise<{ success: boolean; message: string; passkey: any; user: UserProfile }> {
  const res = await apiFetch(
    '/auth/passkey/register-verify',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    },
    6000
  );
  return await parseResponse(res);
}

export async function requestPasskeyLoginChallenge(usernameOrEmail?: string): Promise<{
  challenge: string;
  rpId: string;
}> {
  const res = await apiFetch(
    '/auth/passkey/login-challenge',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail }),
    },
    6000
  );
  return await parseResponse(res);
}

export async function verifyPasskeyLogin(params: {
  challenge: string;
  credentialId?: string;
  usernameOrEmail?: string;
}): Promise<{ token: string; user: UserProfile; message: string }> {
  const res = await apiFetch(
    '/auth/passkey/login-verify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    },
    6000
  );
  return await parseResponse(res);
}

