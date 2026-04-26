import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  Project: a
    .model({
      title: a.string().required(),
      description: a.string(),
      bpm: a.integer(),
      keySignature: a.string(),
      genre: a.string(),
      mainBranchId: a.id(),
      tracks: a.hasMany('Track', 'projectId'),
      branches: a.hasMany('Branch', 'projectId'),
      pullRequests: a.hasMany('PullRequest', 'projectId'),
      collaborators: a.hasMany('Collaborator', 'projectId'),
    })
    .authorization((allow) => [allow.owner()]),

  Track: a
    .model({
      name: a.string().required(),
      type: a.enum(['AUDIO', 'MIDI', 'INSTRUMENT', 'MIX']),
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
      durationSeconds: a.float(),
      sampleRate: a.integer(),
      bitDepth: a.integer(),
      channels: a.integer(),
      fileSizeBytes: a.integer(),
      normalizedLufs: a.float(),
      waveformData: a.json(),
      midiMetadata: a.json(),
    })
    .authorization((allow) => [allow.owner()]),

  // A named snapshot: maps each trackId → versionId
  Branch: a
    .model({
      projectId: a.id().required(),
      project: a.belongsTo('Project', 'projectId'),
      name: a.string().required(),
      description: a.string(),
      isMain: a.boolean(),
      // JSON: { [trackId]: versionId }
      snapshot: a.json(),
      pullRequests: a.hasMany('PullRequest', 'fromBranchId'),
    })
    .authorization((allow) => [allow.owner()]),

  // A proposed change to main — snapshot diff from a branch
  PullRequest: a
    .model({
      projectId: a.id().required(),
      project: a.belongsTo('Project', 'projectId'),
      fromBranchId: a.id().required(),
      fromBranch: a.belongsTo('Branch', 'fromBranchId'),
      title: a.string().required(),
      description: a.string(),
      // JSON: { [trackId]: versionId } — proposed stem versions
      proposedSnapshot: a.json(),
      status: a.enum(['OPEN', 'MERGED', 'CLOSED']),
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
