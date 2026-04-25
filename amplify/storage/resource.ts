import { defineStorage } from '@aws-amplify/backend';

// {entity_id} must be the last path segment before the wildcard (Amplify constraint)
// Keys within each bucket follow: {userId}/stems/{trackId}/{versionId}.ext

export const stemsStorage = defineStorage({
  name: 'stemvaultStems',
  access: (allow) => ({
    '{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
  }),
});

export const proxiesStorage = defineStorage({
  name: 'stemvaultProxies',
  access: (allow) => ({
    '{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
      allow.authenticated.to(['read']),
    ],
  }),
});
