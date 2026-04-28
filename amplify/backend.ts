import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import * as path from 'path';
import { stemsStorage, proxiesStorage } from './storage/resource';
import { audioProcessor } from './functions/audioProcessor/resource';
import { EventType } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { Stack } from 'aws-cdk-lib';
import * as lambdaCdk from 'aws-cdk-lib/aws-lambda';

const backend = defineBackend({
  auth,
  data,
  stemsStorage,
  proxiesStorage,
  audioProcessor,
});

const fn = backend.audioProcessor.resources.lambda as lambdaCdk.Function;
const stemsBucket = backend.stemsStorage.resources.bucket;
const proxiesBucket = backend.proxiesStorage.resources.bucket;

// IAM: Lambda reads originals, writes proxies, updates StemVersion table
stemsBucket.grantRead(fn);
proxiesBucket.grantWrite(fn);
backend.data.resources.tables['StemVersion'].grantWriteData(fn);

// Runtime config injected at deploy time
fn.addEnvironment('PROXIES_BUCKET_NAME', proxiesBucket.bucketName);
fn.addEnvironment('STEM_VERSION_TABLE', backend.data.resources.tables['StemVersion'].tableName);

// S3 → Lambda: trigger on every new object in the stems bucket
stemsBucket.addEventNotification(
  EventType.OBJECT_CREATED,
  new LambdaDestination(fn),
  { prefix: 'stems/' },
);

// ffmpeg Lambda layer — provides /opt/bin/ffmpeg inside the Lambda runtime
const ffmpegLayer = new lambdaCdk.LayerVersion(Stack.of(fn), 'FfmpegLayer', {
  code: lambdaCdk.Code.fromAsset(path.resolve('amplify/layers/ffmpeg-bin')),
  compatibleRuntimes: [lambdaCdk.Runtime.NODEJS_20_X],
  description: 'ffmpeg static binary (johnvansickle.com)',
});
fn.addLayers(ffmpegLayer);

export { backend };
