export type CharacterCategory = 'all' | 'cinema' | 'anime' | 'gaming' | 'fire' | 'celestial' | 'ice' | 'warrior' | 'custom';

export interface Character {
  id: string;
  name: string;
  series?: string;
  role: string;
  shortDescription: string;
  description: string;
  category: CharacterCategory;
  personality: string[];
  roleplayRules?: string;
  greeting: string;
  avatarUrl: string;
  coverUrl: string;
  accent: string;
  isOnline: boolean;
  starters: string[];
  isCustom?: boolean;
  userId?: string;
  recommendationReason?: string;
  isRecommended?: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  name: string;
  email?: string;
  age?: number | string;
  language?: string;
  workspaceCharacterIds?: string[];
  favorites?: string[];
  avatarUrl?: string;
}
