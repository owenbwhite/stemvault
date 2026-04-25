import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { stemsStorage, proxiesStorage } from './storage/resource';
// import { audioProcessor } from './functions/audioProcessor/resource';
// import { EventType } from 'aws-cdk-lib/aws-s3';
// import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';

const backend = defineBackend({
  auth,
  data,
  stemsStorage,
  proxiesStorage,
  // audioProcessor,
});

// To wire the S3 → Lambda processing pipeline, uncomment the block below
// and install: aws-cdk-lib, constructs
//
// backend.stemsStorage.resources.bucket.addEventNotification(
//   EventType.OBJECT_CREATED,
//   new LambdaDestination(backend.audioProcessor.resources.lambda),
//   { prefix: 'projects/' }
// );

export { backend };
