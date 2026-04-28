import { defineFunction } from '@aws-amplify/backend';

export const audioProcessor = defineFunction({
  name: 'audioProcessor',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 300,
  memoryMB: 1024,
  resourceGroupName: 'storage',
});
