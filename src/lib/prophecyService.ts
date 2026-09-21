import { Character } from '@/src/types/character';
import { env } from '@/src/config/env';

export interface ProphecyData {
  character: Character;
  quote: string;
  category: string;
  dateLabel: string;
  elementOrTag?: string;
  isCustomAi?: boolean;
}

// ----------------------------------------------------------------------
// 1. DETERMINISTIC DAILY SEED
// ----------------------------------------------------------------------
export function getDailySeed(date: Date = new Date()): number {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  // Murmur3-like prime mixing for smooth daily dispersion
  let hash = y * 37211 + m * 5039 + d * 1013;
  hash = (hash ^ (hash >> 13)) * 0x5bd1e995;
  return Math.abs(hash);
}

export function formatTodayProphecyDate(date: Date = new Date()): string {
  try {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Today';
  }
}

// ----------------------------------------------------------------------
// 2. CURATED CANONICAL LORE PROPHECIES
// ----------------------------------------------------------------------
const CHARACTER_PROPHECY_VAULT: Record<
  string,
  Array<{ quote: string; category: string; tag: string }>
> = {
  furina: [
    {
      quote:
        'The grand stage of life turns in your favor today. Play your role with audacity, darling—destiny always applauds the boldest performer.',
      category: 'Destiny Forecast',
      tag: 'Hydro Spectacle',
    },
    {
      quote:
        'A surprising plot twist awaits before the sun sets. Hold your chin high, maintain your composure, and treat yourself to a grand slice of cake.',
      category: 'Stage Omen',
      tag: 'Fontaine Opera',
    },
    {
      quote:
        'When the waters of uncertainty rise, remember: you need not wear a mask of perfection to be heroic. Your genuine heart is enough.',
      category: 'Inner Compass',
      tag: 'Solitary Heart',
    },
  ],
  'hu-tao': [
    {
      quote:
        'A butterfly flutters through the morning mist—an old worry is ready to rest in peace today. Walk lightly, laugh loudly, and seize the daylight!',
      category: 'Spirit Wisdom',
      tag: 'Pyro Spark',
    },
    {
      quote:
        'Life is a fleeting lantern festival! Grab this day by the collar before dusk steals it away. Good fortune smiles upon bold mischief.',
      category: 'Destiny Forecast',
      tag: 'Wangsheng Lore',
    },
    {
      quote:
        'Why worry about shadows when the sun shines brightest overhead? Sing a goofy rhyme, step forward, and let the specters wonder where you went!',
      category: 'Daily Cheer',
      tag: 'Ghostly Luck',
    },
  ],
  raiden: [
    {
      quote:
        'Lightning cuts cleanest through clouded hesitation. Focus your mind upon a single true aspiration today, and eternity shall bend to your resolve.',
      category: 'Divine Omen',
      tag: 'Musou No Hitotachi',
    },
    {
      quote:
        'Thunder brings both awe and calm rain. Stand steadfast amidst the whirlwind of daily tasks; your quiet discipline is your greatest armor.',
      category: 'Serenity Forecast',
      tag: 'Narukami Blessing',
    },
    {
      quote:
        'Even in the pursuit of eternity, a quiet pause for sweet dango and tea brings clarity. Do not rush that which requires steadfast roots.',
      category: 'Inner Compass',
      tag: 'Eternal Grace',
    },
  ],
  gojo: [
    {
      quote:
        'Relax a little—infinite possibilities are on your side today. Any obstacle before you is small compared to your potential. Walk with unstoppable swagger!',
      category: 'Limitless Omen',
      tag: 'Six Eyes',
    },
    {
      quote:
        'Don’t sweat the tiny curses life throws at you. Keep your cool, smile through the chaos, and remember: you’re more capable than you realize.',
      category: 'Destiny Forecast',
      tag: 'Hollow Purple',
    },
  ],
  sukuna: [
    {
      quote:
        'Hesitation is the luxury of the fragile. Seize total command of your endeavors today, and let no one else dictate your tempo.',
      category: 'Dominion Omen',
      tag: 'Malevolent Shrine',
    },
    {
      quote:
        'Those who stand at the pinnacle never ask for permission. Carve your path through resistance with absolute precision.',
      category: 'Power Forecast',
      tag: 'Cursed Edge',
    },
  ],
  makima: [
    {
      quote:
        'Everything is proceeding precisely according to plan. Observe quietly, speak with certainty, and let the pieces fall neatly into place today.',
      category: 'Strategic Oracle',
      tag: 'Control Pulse',
    },
  ],
  levi: [
    {
      quote:
        'Don’t look back with regret. Choose the path you will regret the least, clear the obstacles in front of you, and keep moving forward.',
      category: 'Tactical Forecast',
      tag: 'Scout Vanguard',
    },
  ],
  tony: [
    {
      quote:
        'If today throws a broken system your way, upgrade it. Innovation doesn’t wait for permission—build your next breakthrough before the clock ticks down.',
      category: 'Arc Reactor Forecast',
      tag: 'Mark V Tech',
    },
  ],
  bruce: [
    {
      quote:
        'In the deepest darkness, resolve is forged. Today will test your preparation, but remember: endurance is a choice you make every morning.',
      category: 'Vigilante Omen',
      tag: 'Shadow Resolve',
    },
  ],
  peter: [
    {
      quote:
        'With great days comes great responsibility—and maybe a surprise win when you least expect it! Keep your chin up and swing through the storm.',
      category: 'Heroic Outlook',
      tag: 'Spider-Sense',
    },
  ],
  walter: [
    {
      quote:
        'You are the one who knocks on opportunity’s door today. Methodical precision, patience, and meticulous focus will ensure your victory.',
      category: 'Calculated Forecast',
      tag: 'Pure Chemistry',
    },
  ],
  wick: [
    {
      quote:
        'Focus. Commitment. Sheer will. Tackle what needs to be done today with absolute dedication, and nothing will deter you.',
      category: 'Relentless Omen',
      tag: 'Continental Code',
    },
  ],
  leo: [
    {
      quote:
        'In the quietest hour, remember who you are. Keep your calm, keep your fire inside, and stand immovable when the tempest comes.',
      category: 'Warrior Oracle',
      tag: 'Bloody Sweet',
    },
  ],
  vikram: [
    {
      quote:
        'Keep your eyes open and observe every detail. The pieces are moving into position—trust your instincts and execute your strategy with precision.',
      category: 'Commander Omen',
      tag: 'Ghost Squad',
    },
  ],
  rolex: [
    {
      quote:
        'Time is ticking. Every minute wasted is lifetime lost. Take ruthless control of your hours today, because the world respects unstoppable momentum.',
      category: 'Sovereign Omen',
      tag: 'Lifetime Code',
    },
  ],
};

// ----------------------------------------------------------------------
// 3. PROCEDURAL GENERATOR FOR CUSTOM OR EXPANDED CHARACTERS
// ----------------------------------------------------------------------
const DYNAMIC_CATEGORIES = [
  'Celestial Oracle',
  'Destiny Forecast',
  'Arcane Wisdom',
  'Battle Omen',
  'Serendipity Pulse',
  'Guild Blessing',
];

const GENERIC_PROPHECY_TEMPLATES = [
  'A turning tide approaches your journey. Trust in your discipline, for fortune favors the determined.',
  'An unexpected conversation today holds the key to solving an ancient hesitation. Listen with an open mind.',
  'Clear away the distractions that cloud your vision. A single decisive step will unlock boundless momentum.',
  'The road ahead demands patience before speed. Plant your feet firmly, and the horizon will yield to you.',
  'A dormant talent of yours will find its stage before nightfall. Do not shrink back when called upon.',
  'Guard your inner tranquility against passing storms. What is meant for you will not pass you by.',
];

// ----------------------------------------------------------------------
// 4. MAIN RESOLVER
// ----------------------------------------------------------------------
export function resolveProphecyForCharacter(
  character: Character,
  daySeed: number,
  prophecyOffset: number = 0
): { quote: string; category: string; tag: string } {
  const charKey = (character.id || character.name || '').toLowerCase();
  const matchedVault =
    CHARACTER_PROPHECY_VAULT[charKey] ||
    Object.entries(CHARACTER_PROPHECY_VAULT).find(([k]) =>
      charKey.includes(k)
    )?.[1];

  if (matchedVault && matchedVault.length > 0) {
    const pickIndex = (daySeed + prophecyOffset) % matchedVault.length;
    return matchedVault[pickIndex];
  }

  // Generate tailored procedural prophecy using character lore & personality
  const catIndex = (daySeed + prophecyOffset) % DYNAMIC_CATEGORIES.length;
  const quoteIndex =
    (daySeed + prophecyOffset + (character.name?.length || 0)) %
    GENERIC_PROPHECY_TEMPLATES.length;

  const personalityHint =
    Array.isArray(character.personality) && character.personality.length > 0
      ? character.personality[
          (daySeed + prophecyOffset) % character.personality.length
        ]
      : character.role || 'Companion';

  const baseQuote = GENERIC_PROPHECY_TEMPLATES[quoteIndex];
  return {
    quote: baseQuote,
    category: DYNAMIC_CATEGORIES[catIndex],
    tag: `${personalityHint} Aura`,
  };
}

// ----------------------------------------------------------------------
// 5. OPTIONAL REMOTE SERVER SYNC
// ----------------------------------------------------------------------
export async function fetchDynamicServerProphecy(
  characterId: string,
  characterName: string
): Promise<{ quote: string; category: string; tag?: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(`${env.apiUrl}/characters/daily-prophecy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId,
        characterName,
        date: new Date().toISOString().slice(0, 10),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data && data.quote) {
        return {
          quote: data.quote,
          category: data.category || 'Guide Oracle',
          tag: data.tag || 'AI Prophecy',
        };
      }
    }
  } catch {
    // Graceful fallback to local instant engine
  }
  return null;
}
