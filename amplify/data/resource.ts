import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  Project: a
    .model({
      title: a.string().required(),
      description: a.string(),
      bpm: a.integer(),
      keySignature: a.string(),
      genre: a.string(),
      tracks: a.hasMany('Track', 'projectId'),
      collaborators: a.hasMany('Collaborator', 'projectId'),
    })
    .authorization((allow) => [allow.owner()]),

  Track: a
    .model({
      name: a.string().required(),
      type: a.enum(['AUDIO', 'MIDI', 'INSTRUMENT']),
      stemCategory: a.string(),
      projectId: a.id().required(),
      project: a.belongsTo('Project', 'projectId'),
      activeVersionId: a.id(),
      versions: a.hasMany('Version', 'trackId'),
      sortOrder: a.integer(),
    })
    .authorization((allow) => [allow.owner()]),

  Version: a
    .model({
      versionLabel: a.string(),
      notes: a.string(),
      s3Key: a.string().required(),
      proxyS3Key: a.string(),
      trackId: a.id().required(),
      track: a.belongsTo('Track', 'trackId'),
      // Audio technical metadata
      durationSeconds: a.float(),
      sampleRate: a.integer(),
      bitDepth: a.integer(),
      channels: a.integer(),
      fileSizeBytes: a.integer(),
      normalizedLufs: a.float(),
      // Waveform peaks for browser rendering (JSON array of floats -1..1)
      waveformData: a.json(),
      // Human-readable MIDI JSON for diffing (null for audio-only versions)
      midiMetadata: a.json(),
    })
    .authorization((allow) => [allow.owner()]),

  Collaborator: a
    .model({
      projectId: a.id().required(),
      project: a.belongsTo('Project', 'projectId'),
      userId: a.string().required(),
      email: a.string().required(),
      role: a.enum(['EDITOR', 'VIEWER']),
    })
    .authorization((allow) => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
