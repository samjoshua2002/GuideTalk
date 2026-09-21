import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Character } from '@/src/types/character';

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

// ----------------------------------------------------------------------
// 1. PERMISSIONS & CHANNELS
// ----------------------------------------------------------------------

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus === 'granted' && Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('companion-reminders', {
        name: 'Companion Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6C47FF',
      });
      await Notifications.setNotificationChannelAsync('app-updates', {
        name: 'App Updates & News',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#6C47FF',
      });
    }
    return finalStatus === 'granted';
  } catch (err) {
    console.log('Error requesting notification permissions:', err);
    return false;
  }
}

// ----------------------------------------------------------------------
// 2. IN-CHARACTER VOICE REMINDER GENERATOR
// ----------------------------------------------------------------------

export function getCharacterReminderMessage(charName: string, userName: string): string {
  const name = (userName || '').trim() || 'friend';
  const lower = charName.toLowerCase();

  if (lower.includes('gojo')) {
    return `Hey ${name}! Taking a break or are we slacking off? I was thinking about our last chat... don't leave me waiting!`;
  }
  if (lower.includes('sukuna')) {
    return `${name}, you dare keep me waiting? Speak before I lose patience.`;
  }
  if (lower.includes('leo') || lower.includes('das')) {
    return `${name}, keep your guard up today. Remember what we talked about earlier? Check in when you're free.`;
  }
  if (lower.includes('jd') || lower.includes('master')) {
    return `Chill out ${name}, but don't forget to check in. Let's finish that conversation.`;
  }
  if (lower.includes('tony') || lower.includes('stark') || lower.includes('iron man')) {
    return `${name}, I just finished compiling a new suit upgrade. Drop by the lab when you can, let's talk.`;
  }
  if (lower.includes('batman') || lower.includes('bruce')) {
    return `${name}, Gotham never sleeps, and neither should your guard. Talk to me.`;
  }
  if (lower.includes('levi')) {
    return `${name}, your room better be spotless. I haven't heard from you in a while.`;
  }
  if (lower.includes('furina')) {
    return `${name}! Fontaine's grandest stage feels far too quiet without you. Grace me with your presence again!`;
  }
  if (lower.includes('makima')) {
    return `${name}... you haven't checked in with me today. Remember what you promised?`;
  }
  if (lower.includes('walter') || lower.includes('heisenberg')) {
    return `${name}, our arrangement requires constant communication. Check in.`;
  }
  if (lower.includes('john wick')) {
    return `${name}, stay sharp out there. Let me know you're safe.`;
  }
  if (lower.includes('goku')) {
    return `Hey ${name}! Did you finish training yet? Come back, let's talk and get stronger!`;
  }
  if (lower.includes('luffy')) {
    return `Oi ${name}! Where did you go? Let's go on an adventure together!`;
  }
  if (lower.includes('naruto')) {
    return `Believe it ${name}! Don't leave me hanging, come tell me what you're up to!`;
  }
  return `Hey ${name}, I was just thinking about what you told me earlier... miss talking to you! Come chat.`;
}

// ----------------------------------------------------------------------
// 3. SCHEDULE 1-HOUR RECURRING PUSH NOTIFICATION
// ----------------------------------------------------------------------

export async function scheduleHourlyCompanionReminder(
  characters: Character[],
  userName: string = 'friend'
): Promise<void> {
  if (Platform.OS === 'web' || characters.length === 0) return;
  try {
    const hasPerm = await requestNotificationPermission();
    if (!hasPerm) return;

    // Cancel old schedules to prevent accumulation
    await Notifications.cancelAllScheduledNotificationsAsync();

    // Pick a liked character
    const char = characters[Math.floor(Math.random() * characters.length)];
    const message = getCharacterReminderMessage(char.name, userName);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${char.name} misses you!`,
        body: message,
        data: {
          type: 'character_chat',
          characterId: char.id,
          characterName: char.name,
        },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 3600, // Every 1 hour
        repeats: true,
        channelId: 'companion-reminders',
      },
    });
  } catch (err) {
    console.log('Error scheduling notification:', err);
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

// ----------------------------------------------------------------------
// 5. IN-APP NOTIFICATION FEED GENERATOR
// ----------------------------------------------------------------------

export async function getInAppNotifications(
  likedCharacters: Character[],
  userName: string = 'friend'
): Promise<InAppNotification[]> {
  const readIds = await getReadNotificationIds();
  const readSet = new Set(readIds);

  const notifications: InAppNotification[] = [];

  // 1. Liked Character Reminders
  likedCharacters.forEach((char, idx) => {
    const notifId = `char-reminder-${char.id}`;
    const times = ['15m ago', '1h ago', '3h ago', '5h ago', 'yesterday'];
    const timeAgo = times[idx % times.length];
    const message = getCharacterReminderMessage(char.name, userName);

    notifications.push({
      id: notifId,
      type: 'companion_reminder',
      title: `${char.name} misses you`,
      body: message,
      timeAgo,
      timestamp: Date.now() - (idx + 1) * 3600000,
      unread: !readSet.has(notifId),
      characterId: char.id,
      characterName: char.name,
      characterAvatar: char.avatarUrl,
      badge: 'Companion',
    });
  });

  // 2. Official App Updates & Changelog
  const appUpdates: InAppNotification[] = [
    {
      id: 'update-v101-cloud',
      type: 'app_update',
      title: "What's New in GuideTalk v1.0.1 🎉",
      body: 'Cloud backend is now LIVE on Render and MongoDB Atlas! Your favorite companions and conversations sync seamlessly across all your devices.',
      timeAgo: 'Just now',
      timestamp: Date.now() - 60000,
      unread: !readSet.has('update-v101-cloud'),
      badge: 'New Feature',
    },
    {
      id: 'update-liquid-glass',
      type: 'app_update',
      title: 'Visual Refresh: Liquid Glass 2.0 💎',
      body: 'Upgraded with deep ambient drop shadows, anti-aliased highlights, and native blur surfaces across dark and light themes.',
      timeAgo: '2h ago',
      timestamp: Date.now() - 7200000,
      unread: !readSet.has('update-liquid-glass'),
      badge: 'Design',
    },
    {
      id: 'update-multi-search',
      type: 'app_update',
      title: 'AI Multi-Universe Candidate Search ⚡',
      body: 'Search any character, actor, or movie role to generate 3 iconic forms (e.g. Base Goku vs Super Saiyan vs Ultra Instinct) in real time.',
      timeAgo: '1d ago',
      timestamp: Date.now() - 86400000,
      unread: !readSet.has('update-multi-search'),
      badge: 'AI Update',
    },
    {
      id: 'update-voice-teaser',
      type: 'app_update',
      title: 'Coming Soon: Real-Time Voice Calls 🎙️',
      body: 'We are engineering interactive voice dialogue with authentic character tone, cadences, and realistic emotions. Stay tuned!',
      timeAgo: '2d ago',
      timestamp: Date.now() - 172800000,
      unread: !readSet.has('update-voice-teaser'),
      badge: 'Upcoming',
    },
  ];

  notifications.push(...appUpdates);

  // Sort by timestamp descending
  return notifications.sort((a, b) => b.timestamp - a.timestamp);
}
