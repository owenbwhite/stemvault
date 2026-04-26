import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  Project: a
    .model({
      title: a.string().required(),
      description: a.string(),
      type: a.enum(['SINGLE', 'EP', 'LP']),
      bpm: a.integer(),
      keySignature: a.string(),
      genre: a.string(),
      ownerId: a.string().required(),
      tracks: a.hasMany('Track', 'projectId'),
      collaborators: a.hasMany('Collaborator', 'projectId'),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.authenticated().to(['read']),
    ]),

  // A song within a project
  Track: a
    .model({
      projectId: a.id().required(),
      project: a.belongsTo('Project', 'projectId'),
      title: a.string().required(),
      sortOrder: a.integer(),
      // Canonical snapshot: { stemId → stemVersionId }
      mainSnapshot: a.json(),
      isRemix: a.boolean(),
      originalTrackId: a.id(),
      originalProjectId: a.id(),
      stems: a.hasMany('Stem', 'trackId'),
      editRequests: a.hasMany('EditRequest', 'trackId'),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.authenticated().to(['read']),
    ]),

  // A single audio/MIDI stem within a Track (was Track)
  Stem: a
    .model({
      trackId: a.id().required(),
      track: a.belongsTo('Track', 'trackId'),
      name: a.string().required(),
      type: a.enum(['AUDIO', 'MIDI', 'INSTRUMENT', 'MIX']),
      stemCategory: a.string(),
      sortOrder: a.integer(),
      activeVersionId: a.id(),
      versions: a.hasMany('StemVersion', 'stemId'),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.authenticated().to(['read']),
    ]),

  // A specific uploaded file for a Stem (was Version)
  StemVersion: a
    .model({
      stemId: a.id().required(),
      stem: a.belongsTo('Stem', 'stemId'),
      versionLabel: a.string(),
      notes: a.string(),
      s3Key: a.string().required(),
      proxyS3Key: a.string(),
      // Set on remix — references original StemVersion, no S3 copy
      originalVersionId: a.id(),
      durationSeconds: a.float(),
      sampleRate: a.integer(),
      bitDepth: a.integer(),
      channels: a.integer(),
      fileSizeBytes: a.integer(),
      normalizedLufs: a.float(),
      waveformData: a.json(),
      midiMetadata: a.json(),
    })
    .authorization((allow) => [allow.authenticated()]),

  // A proposed set of changes to a Track's stems (was Branch)
  Edit: a
    .model({
      trackId: a.id().required(),
      track: a.belongsTo('Track', 'trackId'),
      name: a.string().required(),
      description: a.string(),
      createdBy: a.string().required(),
      snapshot: a.json(),
      editRequests: a.hasMany('EditRequest', 'fromEditId'),
    })
    .authorization((allow) => [allow.authenticated()]),

  // A request to merge an Edit into the Track's main (was PullRequest)
  EditRequest: a
    .model({
      trackId: a.id().required(),
      track: a.belongsTo('Track', 'trackId'),
      fromEditId: a.id().required(),
      fromEdit: a.belongsTo('Edit', 'fromEditId'),
      title: a.string().required(),
      description: a.string(),
      proposedSnapshot: a.json(),
      status: a.enum(['OPEN', 'MERGED', 'CLOSED']),
    })
    .authorization((allow) => [allow.authenticated()]),

  Collaborator: a
    .model({
      projectId: a.id().required(),
      project: a.belongsTo('Project', 'projectId'),
      userId: a.string().required(),
      email: a.string().required(),
      displayName: a.string(),
      role: a.enum(['EDITOR', 'VIEWER']),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.authenticated().to(['read']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
