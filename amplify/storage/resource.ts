import { defineStorage } from '@aws-amplify/backend';

// Amplify storage path constraint: prefix/{entity_id}/* only
// Keys follow: stems/{userId}/tracks/{trackId}/{versionId}.ext

export const stemsStorage = defineStorage({
  name: 'stemvaultStems',
  isDefault: true,
  access: (allow) => ({
    'stems/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
  }),
});

export const proxiesStorage = defineStorage({
  name: 'stemvaultProxies',
  access: (allow) => ({
    'proxies/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
      allow.authenticated().to(['read']),
    ],
  }),
});
