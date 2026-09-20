# Environment configuration

## Security

The Azure credential shared in the conversation must be treated as compromised. Rotate/revoke it in Azure before using the integration. Never commit the replacement key and never put it in an Expo variable.

## Mobile app

Create a local `.env` file manually with client-safe values only:

```text
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_APP_ENV=development
```

Expo embeds `EXPO_PUBLIC_*` values into the application bundle. They are not secret.

## Backend

Create `server/.env` manually on the backend machine, never in the mobile repository:

```text
AZURE_OPENAI_API_KEY=replace_with_rotated_key
AZURE_OPENAI_ENDPOINT=https://qbssazureopenai.openai.azure.com/
AZURE_OPENAI_API_VERSION=2025-01-01-preview
AZURE_OPENAI_DEPLOYMENT=gpt-5.6-luna
PORT=3000
NODE_ENV=development
CORS_ORIGINS=http://localhost:8081
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DATABASE=guildtalk
```

The local Node backend loads these values at startup, connects to MongoDB, and calls Azure. The Expo app should call only `EXPO_PUBLIC_API_URL`.

## Verification

```shell
npx expo start --clear
npm run typecheck
npx expo-doctor
```

Never test whether a secret is valid by adding it to the mobile code or `app.json`.
