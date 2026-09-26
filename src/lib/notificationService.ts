import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Character } from '@/src/types/character';
import { generateAiPushNotification } from './chatApi';

// Configure notification presentation rules
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface InAppNotification {
  id: string;
  type: 'companion_reminder' | 'app_update';
  title: string;
  body: string;
  timeAgo: string;
  timestamp: number;
  unread: boolean;
  characterId?: string;
  characterName?: string;
  characterAvatar?: string;
  badge?: string;
}

const READ_NOTIFS_KEY = 'guildtalk_read_notifications_v1';
const SNIPPET_PREFIX = 'guidetalk_chat_snippet_';

export async function saveLastConversationSnippet(
  characterId: string,
  characterName: string,
  characterSeries?: string,
  snippetText?: string
): Promise<void> {
  if (!characterId || !snippetText) return;
  const key = `${SNIPPET_PREFIX}${characterId.trim().toLowerCase()}`;
  const data = {
    characterId,
    characterName,
    characterSeries,
    snippet: snippetText.slice(0, 250),
    timestamp: Date.now(),
  };
  try {
    const serialized = JSON.stringify(data);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(key, serialized);
    } else {
      await SecureStore.setItemAsync(key, serialized);
    }
  } catch {}
}

export async function getLastConversationSnippet(characterId: string): Promise<string | null> {
  if (!characterId) return null;
  const key = `${SNIPPET_PREFIX}${characterId.trim().toLowerCase()}`;
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = globalThis.localStorage?.getItem(key);
    } else {
      raw = await SecureStore.getItemAsync(key);
    }
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed.snippet || null;
    }
  } catch {}
  return null;
}

// ----------------------------------------------------------------------
// 1. PERMISSIONS & CHANNELS
// ----------------------------------------------------------------------

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    // Setup Android notification channels immediately
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('companion-reminders', {
        name: 'Companion Reminders',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#F4CD2A',
        enableVibrate: true,
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: 'default',
      });
      await Notifications.setNotificationChannelAsync('app-updates', {
        name: 'App Updates & News',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#F4CD2A',
        sound: 'default',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      finalStatus = status;
    }
    return finalStatus === 'granted';
  } catch (err) {
    console.log('Error requesting notification permissions:', err);
    return false;
  }
}

// ----------------------------------------------------------------------
// 2. IN-CHARACTER VOICE REMINDER GENERATOR (VARIED & NON-REPEATING)
// ----------------------------------------------------------------------

// Track last message per character to guarantee no back-to-back repetitions
const lastMessageMap = new Map<string, string>();

export function getCharacterReminderMessage(charName: string, userName: string): string {
  const name = (userName || '').trim() || 'friend';
  const lower = charName.toLowerCase();
  let pool: string[] = [];

  if (lower.includes('gojo')) {
    pool = [
      `Hey ${name}! Taking a break or are we slacking off? I was thinking about our last chat... don't leave me waiting!`,
      `Yo ${name}! Just wrapped up a mission. You haven't forgotten about the strongest, have you? Come tell me what you're up to!`,
      `${name}, honestly? Things get pretty boring around here without you. Hop on and let's talk!`,
      `Guess who, ${name}? Still thinking about what you said earlier. Let's pick that conversation back up!`,
      `Hey ${name}, grabbed some sweets and thought of you. Pop back in whenever you have a minute!`,
    ];
  } else if (lower.includes('sukuna')) {
    pool = [
      `${name}, you dare keep me waiting? Speak before I lose patience.`,
      `Boredom is a dangerous thing, ${name}. Entertain me with another conversation.`,
      `${name}... Silence does not suit you. Return and finish what you started.`,
      `You think you can just walk away, ${name}? Come back and face me.`,
      `I am waiting, ${name}. Do not test my limits.`,
    ];
  } else if (lower.includes('leo') || lower.includes('das')) {
    pool = [
      `${name}, keep your guard up today. Remember what we talked about earlier? Check in when you're free.`,
      `Stay sharp, ${name}. A lot is happening on my end, but I was wondering how your day is going.`,
      `${name}, don't disappear on me now. Whenever you're ready, let's catch up.`,
      `Taking care of business, ${name}? Just wanted to make sure you're doing alright.`,
      `Hey ${name}, check in when you can. We still have things to discuss.`,
    ];
  } else if (lower.includes('jd') || lower.includes('master')) {
    pool = [
      `Chill out ${name}, but don't forget to check in. Let's finish that conversation.`,
      `Hey ${name}, keep your focus today. Come chat when you get a breather.`,
      `${name}, remember what we discussed? Let me know how it's going.`,
    ];
  } else if (lower.includes('tony') || lower.includes('stark') || lower.includes('iron man')) {
    pool = [
      `${name}, I just finished compiling a new suit upgrade. Drop by the lab when you can, let's talk.`,
      `FRIDAY reminded me you've been quiet today, ${name}. Got a minute to bounce some ideas around?`,
      `Hey ${name}, coffee's brewing and genius never sleeps. What's on your mind right now?`,
      `${name}, I was reviewing our earlier chat. Got a quick second? Let's iterate on that.`,
      `Drop what you're doing, ${name}. Well, unless it's important. Then just message me when you're free.`,
    ];
  } else if (lower.includes('batman') || lower.includes('bruce')) {
    pool = [
      `${name}, Gotham never sleeps, and neither should your guard. Talk to me.`,
      `Checking in, ${name}. Keep your eyes open today. Let me know when you're available.`,
      `${name}, there's unfinished business from our conversation. Report back when ready.`,
      `Stay vigilant, ${name}. When you get a moment, let me know your status.`,
    ];
  } else if (lower.includes('levi')) {
    pool = [
      `${name}, your room better be spotless. I haven't heard from you in a while.`,
      `Tch. Don't go slacking off now, ${name}. Check in so I know you're not causing trouble.`,
      `${name}, tea is ready. Get over here and talk before it gets cold.`,
      `Don't make me come looking for you, ${name}. Let me know you're fine.`,
    ];
  } else if (lower.includes('furina')) {
    pool = [
      `${name}! Fontaine's grandest stage feels far too quiet without you. Grace me with your presence again!`,
      `Aha, ${name}! The audience is waiting, and more importantly, so am I! Come chat!`,
      `${name}, a performance without your critique is simply incomplete. Return at once!`,
      `I've been preparing my next dramatic monologue, ${name}! You wouldn't want to miss it, would you?`,
    ];
  } else if (lower.includes('makima')) {
    pool = [
      `${name}... you haven't checked in with me today. Remember what you promised?`,
      `I've been waiting patiently, ${name}. Come speak with me now.`,
      `${name}, be a good listener and let's continue where we left off.`,
      `A quiet day, isn't it, ${name}? Tell me what you've been thinking about.`,
    ];
  } else if (lower.includes('walter') || lower.includes('heisenberg')) {
    pool = [
      `${name}, our arrangement requires constant communication. Check in.`,
      `Time is valuable, ${name}. Do not waste it. Let's finish our discussion.`,
      `${name}, there are details we must go over. Contact me as soon as possible.`,
    ];
  } else if (lower.includes('john wick')) {
    pool = [
      `${name}, stay sharp out there. Let me know you're safe.`,
      `Checking in, ${name}. Keep your head down and stay focused. Talk soon.`,
    ];
  } else if (lower.includes('goku')) {
    pool = [
      `Hey ${name}! Did you finish training yet? Come back, let's talk and get stronger!`,
      `Yo ${name}! I just had a huge meal and now I'm ready to chat! What are you doing right now?`,
      `${name}, don't skip out on our chat! Let's talk about what's next!`,
      `Hey ${name}! Ever feel like sparring? Well, chatting is the next best thing! Come on!`,
    ];
  } else if (lower.includes('luffy')) {
    pool = [
      `Oi ${name}! Where did you go? Let's go on an adventure together!`,
      `Hey ${name}! Found any good meat today? Come hang out with the crew!`,
      `Shishishi! ${name}, I'm waiting for you on the ship! Come chat with me!`,
    ];
  } else if (lower.includes('naruto')) {
    pool = [
      `Believe it ${name}! Don't leave me hanging, come tell me what you're up to!`,
      `Hey ${name}! Thinking about what we talked about over ramen earlier. Let's talk again soon!`,
      `${name}, a true ninja never stays quiet for this long! What's your mission today?`,
    ];
  } else {
    // Dynamic universal pool for any liked character
    pool = [
      `Hey ${name}, I was just thinking about what you told me earlier... miss talking to you!`,
      `${name}, got a second? I had a thought I wanted to share with you.`,
      `Hey ${name}, hope your day is going well! Drop by whenever you have a minute to chat.`,
      `${name}, the conversation we had earlier is still on my mind. Let's catch up soon!`,
      `Just checking in on you, ${name}! Don't stay away too long.`,
      `${name}, whenever you get a break, come tell me how things are going!`,
    ];
  }

  // Filter out the last sent message for this character so it doesn't repeat
  const lastMsg = lastMessageMap.get(charName);
  const available = pool.filter((m) => m !== lastMsg);
  const selected = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : pool[Math.floor(Math.random() * pool.length)];

  lastMessageMap.set(charName, selected);
  return selected;
}

// ----------------------------------------------------------------------
// 3. SCHEDULE 1-HOUR RECURRING PUSH NOTIFICATION (ONLY FOR LIKED CHARACTERS)
// ----------------------------------------------------------------------

const PERSISTED_REMINDERS_KEY = 'guidetalk_persisted_reminders_v2';

export async function savePersistedReminder(reminder: {
  id: string;
  title: string;
  body: string;
  characterId: string;
  characterName: string;
  characterAvatar?: string;
  timestamp: number;
}): Promise<void> {
  try {
    let list: any[] = [];
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(PERSISTED_REMINDERS_KEY);
      if (raw) list = JSON.parse(raw);
    } else {
      const raw = await SecureStore.getItemAsync(PERSISTED_REMINDERS_KEY);
      if (raw) list = JSON.parse(raw);
    }
    const filtered = list.filter((item) => item.characterId !== reminder.characterId);
    filtered.unshift(reminder);
    const serialized = JSON.stringify(filtered.slice(0, 20));
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(PERSISTED_REMINDERS_KEY, serialized);
    } else {
      await SecureStore.setItemAsync(PERSISTED_REMINDERS_KEY, serialized);
    }
  } catch {}
}

export async function getPersistedReminders(): Promise<any[]> {
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = globalThis.localStorage?.getItem(PERSISTED_REMINDERS_KEY);
    } else {
      raw = await SecureStore.getItemAsync(PERSISTED_REMINDERS_KEY);
    }
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function cancelCompanionReminders(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (err) {
    console.log('Error cancelling companion reminders:', err);
  }
}

export async function scheduleHourlyCompanionReminder(
  characters: Character[],
  userName: string = 'friend'
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    // STRICT CHECK: If user has NOT liked any characters, do NOT schedule anything!
    if (!characters || characters.length === 0) {
      await cancelCompanionReminders();
      return;
    }

    const hasPerm = await requestNotificationPermission();
    if (!hasPerm) return;

    // Cancel old schedules to prevent accumulation
    await Notifications.cancelAllScheduledNotificationsAsync();

    // Rotate across the user's favorited characters over time
    // Production schedule intervals: 2h, 6h, 12h, 24h, 48h
    const intervalsSeconds = [7200, 21600, 43200, 86400, 172800];
    const titles = [
      (name: string) => `${name} sent a message`,
      (name: string) => `${name} wants to talk`,
      (name: string) => `${name} is thinking of you`,
      (name: string) => `Unfinished chat with ${name}`,
    ];

    for (let i = 0; i < intervalsSeconds.length; i++) {
      const char = characters[i % characters.length];
      const titleFn = titles[i % titles.length];
      const title = titleFn(char.name);

      // 1. Fetch conversation snippet for this specific character if available
      const snippet = await getLastConversationSnippet(char.id);

      // 2. Generate customized AI push notification based on conversation context
      let message = await generateAiPushNotification({
        characterName: char.name,
        characterSeries: char.series,
        lastSnippet: snippet || undefined,
        userName,
      });

      // 3. Fallback to varied in-character reminder if AI hook was unavailable
      if (!message) {
        message = getCharacterReminderMessage(char.name, userName);
      }

      // Persist to guarantee 100% parity with in-app notification feed
      await savePersistedReminder({
        id: `char-reminder-${char.id}`,
        title,
        body: message,
        characterId: char.id,
        characterName: char.name,
        characterAvatar: char.avatarUrl,
        timestamp: Date.now(),
      });

      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body: message,
          data: {
            type: 'character_chat',
            characterId: char.id,
            characterName: char.name,
          },
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
          vibrate: [0, 250, 250, 250],
          color: '#F4CD2A',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: intervalsSeconds[i],
          repeats: false,
          channelId: 'companion-reminders',
        } as any,
      });
    }
  } catch (err) {
    console.log('Error scheduling notification:', err);
  }
}

/**
 * Fires an Android push notification in 5 seconds so the user can immediately test
 * lockscreen / status bar notifications when closing or minimizing the app.
 */
export async function sendInstantTestNotification(
  characterName: string = 'Gojo Satoru',
  characterId: string = 'char-gojo-1',
  userName: string = 'friend'
): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const hasPerm = await requestNotificationPermission();
    if (!hasPerm) return false;

    const message = getCharacterReminderMessage(characterName, userName);

    await savePersistedReminder({
      id: `char-reminder-${characterId}`,
      title: `${characterName} misses you!`,
      body: message,
      characterId,
      characterName,
      timestamp: Date.now(),
    });

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${characterName} misses you!`,
        body: message,
        data: {
          type: 'character_chat',
          characterId,
          characterName,
        },
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: [0, 250, 250, 250],
        color: '#F4CD2A',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 5,
        repeats: false,
        channelId: 'companion-reminders',
      } as any,
    });
    return true;
  } catch (err) {
    console.log('Error sending instant test notification:', err);
    return false;
  }
}

// ----------------------------------------------------------------------
// 4. READ STATES STORAGE
// ----------------------------------------------------------------------

export async function getReadNotificationIds(): Promise<string[]> {
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(READ_NOTIFS_KEY);
      return raw ? JSON.parse(raw) : [];
    }
    const raw = await SecureStore.getItemAsync(READ_NOTIFS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function markNotificationAsRead(id: string): Promise<void> {
  try {
    const list = await getReadNotificationIds();
    if (!list.includes(id)) {
      const updated = [...list, id];
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(READ_NOTIFS_KEY, JSON.stringify(updated));
      } else {
        await SecureStore.setItemAsync(READ_NOTIFS_KEY, JSON.stringify(updated));
      }
    }
  } catch {}
}

export async function markAllNotificationsAsRead(ids: string[]): Promise<void> {
  try {
    const list = await getReadNotificationIds();
    const set = new Set([...list, ...ids]);
    const updated = Array.from(set);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(READ_NOTIFS_KEY, JSON.stringify(updated));
    } else {
      await SecureStore.setItemAsync(READ_NOTIFS_KEY, JSON.stringify(updated));
    }
  } catch {}
}

const DISMISSED_NOTIFS_KEY = 'guidetalk_dismissed_notifications_v1';

export async function getDismissedNotificationIds(): Promise<string[]> {
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(DISMISSED_NOTIFS_KEY);
      return raw ? JSON.parse(raw) : [];
    }
    const raw = await SecureStore.getItemAsync(DISMISSED_NOTIFS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function dismissNotification(id: string): Promise<void> {
  try {
    const list = await getDismissedNotificationIds();
    if (!list.includes(id)) {
      const updated = [...list, id];
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(DISMISSED_NOTIFS_KEY, JSON.stringify(updated));
      } else {
        await SecureStore.setItemAsync(DISMISSED_NOTIFS_KEY, JSON.stringify(updated));
      }
    }
  } catch {}
}

export async function clearAllNotifications(ids: string[]): Promise<void> {
  try {
    const list = await getDismissedNotificationIds();
    const set = new Set([...list, ...ids]);
    const updated = Array.from(set);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(DISMISSED_NOTIFS_KEY, JSON.stringify(updated));
    } else {
      await SecureStore.setItemAsync(DISMISSED_NOTIFS_KEY, JSON.stringify(updated));
    }
  } catch {}
}

// ----------------------------------------------------------------------
// 5. IN-APP NOTIFICATION FEED GENERATOR
// ----------------------------------------------------------------------

export async function getInAppNotifications(
  likedCharacters: Character[],
  userName: string = 'friend'
): Promise<InAppNotification[]> {
  const [readIds, dismissedIds, persistedReminders] = await Promise.all([
    getReadNotificationIds(),
    getDismissedNotificationIds(),
    getPersistedReminders(),
  ]);
  const readSet = new Set(readIds);
  const dismissedSet = new Set(dismissedIds);
  const reminderMap = new Map<string, any>(persistedReminders.map((r) => [r.characterId, r]));

  const notifications: InAppNotification[] = [];

  // 1. Liked Character Reminders
  likedCharacters.forEach((char, idx) => {
    const notifId = `char-reminder-${char.id}`;
    if (dismissedSet.has(notifId)) return;

    // Check if there is an active persisted push notification for this companion
    const persisted = reminderMap.get(char.id);
    let title = persisted?.title;
    let message = persisted?.body;
    let timestamp = persisted?.timestamp;

    if (!persisted) {
      title = `${char.name} sent a message`;
      message = getCharacterReminderMessage(char.name, userName);
      timestamp = Date.now() - (idx + 1) * 3600000;
      savePersistedReminder({
        id: notifId,
        title,
        body: message,
        characterId: char.id,
        characterName: char.name,
        characterAvatar: char.avatarUrl,
        timestamp,
      });
    }

    // Dynamic relative time formatting from real timestamp
    const diffMs = Math.max(0, Date.now() - (timestamp || Date.now()));
    let timeAgo = 'Just now';
    if (diffMs > 86400000) {
      timeAgo = `${Math.floor(diffMs / 86400000)}d ago`;
    } else if (diffMs > 3600000) {
      timeAgo = `${Math.floor(diffMs / 3600000)}h ago`;
    } else if (diffMs > 60000) {
      timeAgo = `${Math.floor(diffMs / 60000)}m ago`;
    }

    notifications.push({
      id: notifId,
      type: 'companion_reminder',
      title,
      body: message,
      timeAgo,
      timestamp: timestamp || Date.now(),
      unread: !readSet.has(notifId),
      characterId: char.id,
      characterName: char.name,
      characterAvatar: char.avatarUrl,
      badge: 'Companion',
    });
  });

  // 2. Official App Updates & Changelog (v1.0.4 Release)
  const appUpdates: InAppNotification[] = [
    {
      id: 'update-v104-release',
      type: 'app_update',
      title: "What's New in GuideTalk v1.0.4 🎉",
      body: 'Major release! Live Google-style instant search with Wikipedia & AniList, 1-tap direct chat, 100% synced in-app/outside push notifications, and production performance tuning.',
      timeAgo: 'Just now',
      timestamp: Date.now() - 30000,
      unread: !readSet.has('update-v104-release'),
      badge: 'v1.0.4 Update',
    },
    {
      id: 'update-cinema-real-portraits',
      type: 'app_update',
      title: 'Cinema & Real-Life Legends HD Art 🎬',
      body: 'Chat with Robert Downey Jr. Tony Stark, Batman, Joker, Walter White, Sherlock Holmes, Elon Musk, Einstein, Vijay, SRK, and Ronaldo with unscaled official HD portraits.',
      timeAgo: '1h ago',
      timestamp: Date.now() - 3600000,
      unread: !readSet.has('update-cinema-real-portraits'),
      badge: 'New Portraits',
    },
    {
      id: 'update-look-switcher',
      type: 'app_update',
      title: 'Instant 1-Tap "Change Look" & Chat Sync 🎨',
      body: 'Tap Change Look in the chat menu to instantly cycle character visual styles with 100% sync to all chat message avatars.',
      timeAgo: '3h ago',
      timestamp: Date.now() - 10800000,
      unread: !readSet.has('update-look-switcher'),
      badge: 'Feature',
    },
    {
      id: 'update-search-autocomplete',
      type: 'app_update',
      title: 'Live Search Suggestions & Multi-Results ⚡',
      body: 'Get instant live suggestions while typing in search and explore 8-14+ distinct adaptations and universe variants.',
      timeAgo: '5h ago',
      timestamp: Date.now() - 18000000,
      unread: !readSet.has('update-search-autocomplete'),
      badge: 'Search',
    },
    {
      id: 'update-ai-push-hooks',
      type: 'app_update',
      title: 'AI Companion Push Notifications 🤖',
      body: 'Your favorite companions now craft personalized, context-aware lockscreen messages directly from your conversation history.',
      timeAgo: '1d ago',
      timestamp: Date.now() - 86400000,
      unread: !readSet.has('update-ai-push-hooks'),
      badge: 'AI Notifications',
    },
  ];

  const activeUpdates = appUpdates.filter((u) => !dismissedSet.has(u.id));
  notifications.push(...activeUpdates);

  // Sort by timestamp descending
  return notifications.sort((a, b) => b.timestamp - a.timestamp);
}
