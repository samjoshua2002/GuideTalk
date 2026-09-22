import { Platform } from 'react-native';
import { env } from '@/src/config/env';
import { Character } from '@/src/types/character';

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

export async function generateCharacterWithAI(query: string): Promise<Character> {
  try {
    const response = await apiFetch('/characters/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const result = await parseResponse<{ character: any }>(response);
    const c = result.character;
    return {
      id: `custom-${Date.now()}`,
      name: c.name || query,
      series: c.series || 'Custom Universe',
      role: c.role || 'Companion',
      shortDescription: c.shortDescription || '',
      description: c.description || '',
      category: 'custom',
      personality: Array.isArray(c.personality) ? c.personality : ['Smart', 'Emotional', 'Sarcastic'],
      roleplayRules: c.roleplayRules || '',
      greeting: c.greeting || 'Greetings, traveler.',
      starters: Array.isArray(c.starters) ? c.starters : ['Hello!', 'Tell me about yourself.'],
      avatarUrl: c.avatarUrl || 'https://static.zerochan.net/Furina.full.4024209.jpg',
      coverUrl: c.avatarUrl || 'https://static.zerochan.net/Furina.full.4024209.jpg',
      accent: c.accent || '#FFFFFF',
      isOnline: true,
      isCustom: true,
    };
  } catch (err) {
    console.log('Backend generator unreachable, using direct client AI completion:', err);
    // Direct Azure OpenAI fallback if backend offline
    return directGenerateCharacter(query);
  }
}

async function directGenerateCharacter(query: string): Promise<Character> {
  const prompt = `Recognize the character "${query}". Return a single JSON object with keys: name, series, role, shortDescription, description, personality (array), roleplayRules, greeting, starters (array of 3 strings), accent (hex).`;
  const url = getAzureOpenAIUrl('gpt-5.6-luna');
  const apiKey = getAzureApiKey();
  try {
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
    const initialAvatar =
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80';
    return {
      id: `custom-${Date.now()}`,
      name: parsed.name || query,
      series: parsed.series || 'Custom Origin',
      role: parsed.role || 'Companion',
      shortDescription: parsed.shortDescription || `Legendary persona for ${query}`,
      description: parsed.description || `Legendary persona for ${query}`,
      category: 'custom',
      personality: Array.isArray(parsed.personality) ? parsed.personality : ['Witty', 'Emotional'],
      roleplayRules: parsed.roleplayRules || 'Speak with authentic emotional flair and depth.',
      greeting: parsed.greeting || `Greetings! I am ${parsed.name || query}.`,
      starters: Array.isArray(parsed.starters) && parsed.starters.length > 0 ? parsed.starters : ['Tell me about your world.', 'What is your secret?'],
      avatarUrl: initialAvatar,
      coverUrl: initialAvatar,
      accent: parsed.accent || '#FFFFFF',
      isOnline: true,
      isCustom: true,
    };
  } catch (err) {
    console.error('Direct character generation failed:', err);
    const fallbackAvatar =
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&auto=format&fit=crop&q=80';
    return {
      id: `custom-${Date.now()}`,
      name: query,
      series: 'Custom Origin',
      role: 'Legendary Companion',
      shortDescription: `Custom persona for ${query}`,
      description: `A unique character known as ${query}. Ready to chat with charisma and emotional depth.`,
      category: 'custom',
      personality: ['Charismatic', 'Witty', 'Authentic'],
      roleplayRules: 'Speak in full character with emotional range and charming wit.',
      greeting: `Greetings! I am ${query}. It is wonderful to meet you.`,
      starters: ['What brings you here today?', 'Tell me a story from your world.'],
      avatarUrl: fallbackAvatar,
      coverUrl: fallbackAvatar,
      accent: '#FFFFFF',
      isOnline: true,
      isCustom: true,
    };
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
}): Promise<{ content: string; modelUsed: string }> {
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
    return parseResponse<{ content: string; modelUsed: string }>(response);
  } catch (error) {
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
      console.warn(`Direct Azure OpenAI returned status ${response.status}`);
      return `*smiles warmly* I hear you, but my connection wavered for a second. Let's keep talking!`;
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || '...';
  } catch (err) {
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

        const defaultAvatars = [
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&q=80',
          'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500&q=80',
          'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=500&q=80',
        ];

        return parsed.slice(0, 3).map((c: any, idx: number) => ({
          id: `candidate-${Date.now()}-${idx}`,
          name: c.name || cleanQ,
          series: c.series || 'Famous Universe',
          role: c.role || 'Companion',
          shortDescription: c.shortDescription || '',
          description: c.shortDescription || '',
          personality: Array.isArray(c.personality) ? c.personality : ['Smart', 'Charismatic'],
          roleplayRules: 'Speak in-character with genuine charm, emotion, and wit.',
          greeting: c.greeting || `Hello! I am ${c.name || cleanQ}.`,
          starters: ['Tell me about your world.', 'What is your greatest adventure?'],
          avatarUrl: defaultAvatars[idx % defaultAvatars.length],
          coverUrl: defaultAvatars[idx % defaultAvatars.length],
          accent: '#FFFFFF',
          isCustom: true,
        }));
      }
    } catch (e) {
      console.log('Direct Azure candidate search failed, using instant persona:', e);
    }
  }

  // Guaranteed instant persona so the user is never stuck
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
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&q=80',
      coverUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&q=80',
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
  return parseResponse<{ messages: StoredMessage[]; newReply: string }>(res);
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

