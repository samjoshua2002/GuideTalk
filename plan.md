# GuildTalk — Fairy-Tale Anime AI Chat App Plan

> A magical, anime-inspired character chat app built with Expo React Native. The interface is inspired by modern AI companion products, while the visual identity, characters, artwork, prompts, and branding remain original. Do not ship third-party character names, logos, screenshots, or artwork without a license.

## 1. Product goal

Build a polished mobile MVP where users discover fantasy-guild characters, open a character profile, and chat in an immersive magical interface. The first release is a frontend prototype with local mock data and a replaceable AI API adapter.

### MVP success criteria

- App launches on iOS and Android through Expo.
- User can complete onboarding, browse characters, search/filter, open a profile, start a chat, and return to chat history.
- Chat messages persist locally during the session and mock replies feel character-specific.
- The app has loading, empty, offline, and error states.
- No provider API key is shipped in the mobile bundle.
- Original placeholder artwork is used until licensed assets are available.

## 2. Product rules

1. The app must not claim to be affiliated with Fairy Tail, Character.AI, or another rights holder.
2. Use original fantasy-guild characters and generated/licensed artwork in production.
3. The mobile client never contains an AI provider secret, database password, or admin credential.
4. All user-generated text is untrusted input.
5. Every backend endpoint authenticates and authorizes independently; never trust a client user ID.
6. AI output is not presented as a real person or professional advice.
7. Add report, block, delete conversation, and account deletion controls before public launch.
8. Do not log complete private conversations by default.
9. Add age-appropriate content controls and moderation before enabling public character sharing.
10. Do not use scraped images or hotlink assets in production. Use owned, licensed, or original assets stored in controlled object storage.

## 3. UI design rules

These rules are adapted from the MIT-licensed `ceorkm/mobile-app-ui-design` guidance and tailored for GuildTalk. They are implementation requirements, not optional decoration.

### 3.1 Context before decoration

For every screen, document:

- The user’s goal.
- The primary action.
- The emotional outcome: wonder, confidence, safety, or belonging.
- The next screen in the flow.

The character chat is the primary product action. Discovery should reduce the distance to a first meaningful message.

### 3.2 Layout and interaction

- Design for a 375px-wide phone first, then scale up.
- Use the F-pattern: title and primary content first, supporting metadata second.
- Keep primary actions in the bottom thumb zone. The chat composer and character CTA must remain reachable.
- Use a minimum 44x44pt touch target for every interactive control.
- Use safe-area insets for headers, tab bars, and keyboard-facing controls.
- Keep related elements close and separate unrelated groups with at least twice the spacing.
- Prefer visible content over hiding important information behind extra taps.
- Use horizontal scrolling only for secondary collections such as character cards and suggestion chips.
- Avoid gesture-only actions; provide visible alternatives.

### 3.3 Color system

Use the 60/30/10 balance:

- 60%: `colors.background` and other neutral dark surfaces.
- 30%: `colors.surface`, `colors.elevated`, and supporting purple surfaces.
- 10%: accent colors for the featured character, primary CTA, status, and active navigation.

Rules:

- Use one accent for the main action on a screen; character accent colors are secondary.
- Use text opacity/color hierarchy instead of adding more font weights.
- Use accent colors at low opacity for borders and secondary highlights.
- Use tinted shadows that fit the purple background; never use harsh black shadows.
- Reserve orange, red, and pink for meaningful character identity or status—not every card.
- Check contrast for primary text, body text, disabled text, and chat bubbles.

### 3.4 Typography

- Use one primary font family; add a decorative face only for branding if it remains readable.
- Use no more than four sizes per screen: eyebrow, body, section title, hero title.
- Use two primary weights: regular/medium and bold/extra-bold.
- Headings should be short and scannable.
- Body copy should use comfortable line height and never compete with the CTA.
- Do not make labels larger than the information they describe.

### 3.5 Spacing and components

Follow the 8-point grid with allowed values of 4, 8, 12, 16, 24, 32, 48, and 64.

- Screen horizontal padding: 20 or 24.
- Card padding: 16 or 24.
- Section gap: 24 or 32.
- Title-to-supporting-text gap: 8 or 12.
- Card radius: 16, 20, or 24.
- Chat bubble radius: 16 or 20, with a small role-specific corner reduction.
- Minimum button height: 48.
- Avoid unexplained values such as 5, 7, 13, 15, 17, or 19 in new components.

### 3.6 Imagery

- Keep all character artwork in a consistent portrait treatment and color grade.
- Use original, licensed, or generated assets only. Do not scrape or hotlink copyrighted artwork.
- Every remote image needs a loading placeholder, error fallback, and accessible description.
- Use artwork to establish character identity, not as decoration behind readable text.
- Keep image URLs out of security-sensitive logs.

### 3.7 Emotional design

The peak moment is the first character reply. It should include a short typing state, character-specific greeting, subtle motion, and a clear invitation to continue. The ending moment is returning to the guild: show the latest chat, a meaningful preview, and a next-action recommendation.

Use motion sparingly:

- Fade/slide for navigation.
- Small scale feedback for presses.
- Typing animation while waiting for a reply.
- Glow or sparkle only for successful milestones.
- Respect reduced-motion settings.

### 3.8 Required states

Every screen and async action must define:

- Loading state with stable layout skeleton.
- Empty state with explanation and one clear CTA.
- Error state with recovery action.
- Offline state that does not imply a message was delivered.
- Disabled state with sufficient contrast.
- Success state for actions such as saved character or sent message.

### 3.9 Screen-specific rules

- Home: feature one primary character, then provide an immediate list of alternatives. Do not let the banner occupy the whole first viewport.
- Search: never show a blank initial state; show recent/popular characters or categories.
- Character details: keep `Start chatting` fixed or reachable in the lower thumb zone; starters must be tappable.
- Chat: prioritize message readability, keep the composer above the keyboard, and do not cover messages with decorative effects.
- Chats: show character avatar, latest message, time, and unread state; provide a useful first-chat CTA.
- Profile: use progressive disclosure; settings should not compete with the user’s identity or activity.

### 3.10 UI review checklist

Before merging a screen, verify:

- Can a new user identify the primary action within three seconds?
- Are all controls reachable and at least 44x44pt?
- Are spacing values on the 8-point grid?
- Is the 60/30/10 color balance preserved?
- Is the hierarchy understandable without color alone?
- Does the screen work with long names, large fonts, no network, and no data?
- Does every important action have pressed, loading, success, and failure behavior?
- Does the design feel magical through restraint rather than excessive gradients?

## 4. Initial characters

Use original characters for development:

- Astra Flameheart — bold, protective fire mage.
- Selene Starveil — elegant celestial mage.
- Kael Frostbane — calm, sarcastic ice mage.
- Reina Ironrose — disciplined guild captain.
- Nyx Nightwhisper — mysterious shadow mage.
- Piko — chaotic flying magical companion.

Every character has an ID, display name, description, greeting, traits, color theme, artwork URL, and starter prompts. Character configuration must be server-owned once AI is connected.

## 4. Screen map

- Onboarding: splash, value proposition, interest selection, guest entry.
- Home: greeting, featured character, category chips, popular characters, scenarios.
- Search: debounced search, category filters, no-results state.
- Character details: hero art, personality, response speed, starters, start-chat CTA.
- Chat: messages, typing state, suggested replies, composer, retry, message actions.
- Chats: recent conversations, pinned state, unread state, search.
- Profile: account, saved characters, usage, settings.
- Settings: theme, notifications, privacy, logout, delete account.
- Future: character creator, voice, subscriptions, public guild directory.

## 5. Technical architecture

### Mobile

- Expo + React Native + TypeScript.
- Expo Router for navigation.
- Zustand for local conversation and preference state.
- AsyncStorage only for non-sensitive preferences and local demo messages.
- expo-secure-store for access/refresh tokens when authentication is added.
- Reanimated for transitions and micro-interactions.
- FlashList for large chat and character lists when the backend is introduced.

### Backend target

- NestJS API.
- PostgreSQL with migrations.
- Redis for rate limits, queues, and short-lived streaming state.
- Object storage with signed upload URLs for artwork.
- AI provider adapter on the server; provider can be swapped without changing the app.
- SSE or WebSocket streaming for production chat responses.

### Feature boundaries

- `src/data`: temporary local catalog only.
- `src/store`: client state and persistence.
- `src/components`: reusable presentation components.
- `src/theme`: design tokens.
- `src/types`: shared domain types.
- `app`: route-level screens.
- `src/lib/api`: future API client and AI adapter boundary.

## 6. Data model target

- User: id, email, displayName, avatarUrl, ageConsent, createdAt.
- Character: id, ownerId, name, description, personality, greeting, visibility, moderationStatus, theme.
- Conversation: id, userId, characterId, title, pinned, createdAt, updatedAt.
- Message: id, conversationId, role, content, providerMessageId, createdAt, moderationStatus.
- Report: id, reporterId, targetType, targetId, reason, status, reviewerId, createdAt.
- Block: blockerId, blockedCharacterId or blockedUserId, createdAt.
- UsageRecord: userId, dateBucket, promptTokens, completionTokens, requestCount.
- AuditEvent: actorId, action, targetId, metadata, createdAt.

## 7. API contract target

- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`.
- `GET /me`, `PATCH /me`, `DELETE /me`.
- `GET /characters`, `GET /characters/:id`, `POST /characters`, `PATCH /characters/:id`.
- `GET /conversations`, `POST /conversations`, `GET /conversations/:id/messages`.
- `POST /conversations/:id/messages` with streaming response.
- `POST /messages/:id/regenerate`, `POST /messages/:id/report`.
- `POST /characters/:id/favorite`, `DELETE /characters/:id/favorite`.
- `POST /blocks`, `DELETE /blocks/:id`.

All DTOs use strict validation, whitelist unknown fields, bounded pagination, request size limits, and consistent error envelopes. Use cursor pagination for messages and characters. Use idempotency keys for message submission.

## 8. Security requirements

### Secrets and authentication

- AI keys exist only in backend environment variables or a managed secret vault.
- Never put secrets in `EXPO_PUBLIC_*`, source code, app config, logs, or analytics.
- Use short-lived access tokens and rotating refresh tokens.
- Store tokens in SecureStore; never AsyncStorage.
- Revoke sessions on logout, password reset, and suspicious activity.
- Do not put private message content or tokens in navigation parameters.

### Authorization and API protection

- Enforce ownership and role checks in NestJS guards and service methods.
- Prevent IDOR by querying resources with both resource ID and authenticated user ID.
- Validate UUIDs, strings, enums, lengths, and nested objects.
- Apply per-user/IP rate limits, AI quotas, concurrency limits, and timeouts.
- Return generic errors to clients; keep diagnostic details server-side.
- Use TLS, secure headers, strict CORS, dependency scanning, and database least privilege.

### AI safety

- Provider calls happen only from the backend.
- Keep system prompts separate from user content and never reveal them.
- Treat retrieved character data and user messages as untrusted.
- Moderate input and output, especially sexual, exploitative, self-harm, violent, hateful, and illegal content.
- Add age gating and a crisis response policy before launch.
- Set token, timeout, and cost limits. Never allow arbitrary provider model or system prompt selection from the client.

### Media and privacy

- Use signed uploads, MIME sniffing, file size/dimension limits, virus scanning, re-encoding, and metadata stripping.
- Store private media in private buckets and serve through short-lived signed URLs.
- Minimize telemetry; redact emails, tokens, prompts, and message content.
- Support export and permanent deletion. Define retention periods and publish a privacy policy.

## 9. Testing strategy

### Automated checks

- TypeScript strict check.
- ESLint and formatting check.
- Unit tests for stores, filters, message grouping, validation, and permission helpers.
- Component tests for cards, composer, bubbles, loading/error/empty states.
- Integration tests for onboarding, discovery, starting chats, persistence, retry, report, and logout.
- E2E tests on iOS and Android for onboarding, search, chat, app restart, keyboard behavior, and offline mode.

### Security testing

- Authentication bypass and session revocation.
- IDOR and broken access control.
- Rate-limit and replay tests.
- Injection and malformed JSON tests.
- Prompt injection and system prompt exfiltration tests.
- XSS/unsafe markdown rendering tests.
- File upload abuse and decompression bomb tests.
- Deep-link and external URL validation.
- Secret scanning and dependency audit.
- Production bundle inspection for leaked keys.
- Annual independent penetration test before a large public launch.

### Performance and accessibility

- Cold start, screen rendering, memory, battery, image loading, and long-chat scrolling.
- Slow network, request timeout, retry, and airplane-mode behavior.
- Screen reader labels, contrast, dynamic font sizes, touch targets, reduced motion, focus, and keyboard avoidance.

## 10. CI/CD and release gates

Pull requests must pass typecheck, lint, tests, dependency audit, secret scan, and a development build. Staging uses separate credentials, database, storage, and AI quota. Production releases require review, migration review, smoke tests, crash-free threshold, rollback plan, privacy/terms links, and store compliance review.

## 11. Observability

Track crash-free sessions, API latency, AI latency, failed requests, rate-limit events, moderation decisions, and upload failures. Redact sensitive fields. Use correlation IDs rather than message content. Alert on error-rate spikes, unusual token spend, authentication anomalies, and queue backlogs.

## 12. Delivery phases

### Phase 0 — Foundation

Confirm branding, original art policy, content policy, repo standards, environments, and design tokens.

### Phase 1 — Mobile prototype

Build navigation, onboarding, discovery, character details, chat UI, chat history, profile, local mock data, animations, and responsive states.

### Phase 2 — Backend foundation

Add NestJS, PostgreSQL, migrations, auth, characters, conversations, messages, object storage, DTO validation, and authorization.

### Phase 3 — AI integration

Add server-side provider adapter, prompt builder, streaming, retries, moderation, quotas, usage accounting, and observability.

### Phase 4 — Trust and safety

Add reports, blocks, account deletion, content filters, admin review, audit events, privacy controls, and security review.

### Phase 5 — Release

Run QA matrix, accessibility audit, performance testing, penetration testing, staging pilot, app store preparation, and controlled rollout.

## 13. Definition of done

A feature is complete only when it is typed, documented, responsive, accessible, tested, observable, secure, and has loading/empty/error/offline states. It must work on iOS and Android, contain no hardcoded secrets, and pass the release checklist.

## 14. Immediate implementation order

1. Create Expo TypeScript app and install only required dependencies.
2. Add theme tokens and reusable UI primitives.
3. Add original local character catalog with remote placeholder artwork.
4. Implement onboarding and tab navigation.
5. Implement Home, Search, Character Details, Chat, Chats, and Profile.
6. Add local demo chat store and character-specific replies.
7. Add accessibility, error states, and tests.
8. Replace local adapters with NestJS API only after the UI contract is stable.
9. Add backend AI integration with the provider key kept exclusively server-side.
10. Run security, performance, accessibility, and release checks before publishing.
