import { defineStorage } from '@aws-amplify/backend';

// High-resolution stems — owner-only read/write
export const stemsStorage = defineStorage({
  name: 'stemvaultStems',
  access: (allow) => ({
    // Full-res stems: projects/{ownerIdentityId}/stems/{trackId}/{versionId}.*
    'projects/{entity_id}/stems/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
  }),
});

// Low-res proxy audio for browser preview — broader read access
export const proxiesStorage = defineStorage({
  name: 'stemvaultProxies',
  access: (allow) => ({
    // Transcoded proxies readable by any authenticated user (for collaboration)
    'projects/{entity_id}/proxies/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
      allow.authenticated.to(['read']),
    ],
  }),
});
