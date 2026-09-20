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

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const urls = Array.from(new Set([
    `${env.apiUrl}${path}`,
    `http://192.168.0.232:3000${path}`,
    `http://localhost:3000${path}`,
  ]));
  let lastError: any = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Network request failed.');
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
  const url = `${env.azureEndpoint}openai/deployments/gpt-5.6-luna/chat/completions?api-version=${env.azureApiVersion}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': env.azureApiKey },
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
    id: `custom-${Date.now()}`,
    name: parsed.name || query,
    series: parsed.series || 'Custom',
    role: parsed.role || 'Hero',
    shortDescription: parsed.shortDescription || '',
    description: parsed.description || '',
    category: 'custom',
    personality: parsed.personality || ['Witty', 'Emotional'],
    roleplayRules: parsed.roleplayRules || '',
    greeting: parsed.greeting || 'Greetings.',
    starters: parsed.starters || ['Hello!'],
    avatarUrl: 'https://static.zerochan.net/Furina.full.4024209.jpg',
    coverUrl: 'https://static.zerochan.net/Furina.full.4024209.jpg',
    accent: parsed.accent || '#FFFFFF',
    isOnline: true,
    isCustom: true,
  };
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

  const url = `${env.azureEndpoint}openai/deployments/${encodeURIComponent(targetModel)}/chat/completions?api-version=${env.azureApiVersion}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.azureApiKey,
    },
    body: JSON.stringify({
      messages: history,
      max_completion_tokens: 800,
    }),
  });
  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '...';
}

// ----------------------------------------------------------------------
// 4. MULTI-CHARACTER SEARCH & CANDIDATE PICKER
// ----------------------------------------------------------------------

export interface CharacterCandidate {
  name: string;
  series: string;
  role: string;
  personality: string[];
  description: string;
  shortDescription?: string;
  greeting: string;
  avatarUrl: string;
  coverUrl: string;
}

export async function searchMultiCharacters(
  query: string,
  language?: string,
  token?: string | null
): Promise<CharacterCandidate[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await apiFetch('/characters/search-multi', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, language }),
  });
  const data = await parseResponse<{ candidates: CharacterCandidate[] }>(res);
  return data.candidates || [];
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
// ----------------------------------------------------------------------

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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

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
    console.warn('Failed to fetch recommendations:', err);
    return [];
  }
}

// ----------------------------------------------------------------------
// 6b. DYNAMIC AI & INTERNET RIVAL ENCOUNTERS
// ----------------------------------------------------------------------

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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

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
    console.warn('Failed to fetch dynamic rivals:', err);
    return [];
  }
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
): Promise<string | null> {
  if (!name) return null;
  try {
    const params = new URLSearchParams({
      name,
      series: series || '',
      ...(force ? { force: 'true' } : {}),
    });
    const res = await apiFetch(`/api/character-image?${params.toString()}`);
    if (res.ok) {
      const data = await parseResponse<{ imageUrl?: string }>(res);
      return data?.imageUrl || null;
    }
  } catch (err) {
    console.warn(`Failed to fetch dynamic image for ${name}:`, err);
  }
  return null;
}

