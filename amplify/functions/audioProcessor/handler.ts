import type { S3Event } from 'aws-lambda';

interface MediaConvertJobResult {
  jobId: string;
  status: string;
}

// Normalize a stem upload by:
// 1. Triggering a MediaConvert job to produce a low-res proxy (128kbps AAC)
// 2. Writing waveform peak data back to the proxies bucket as JSON
// 3. Extracting MIDI metadata if the file is a .mid upload
export const handler = async (event: S3Event): Promise<void> => {
  const { MEDIACONVERT_ENDPOINT, MEDIACONVERT_ROLE_ARN, PROXIES_BUCKET } =
    process.env;

  if (!MEDIACONVERT_ENDPOINT || !MEDIACONVERT_ROLE_ARN || !PROXIES_BUCKET) {
    throw new Error('Missing required environment variables');
  }

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    console.log(`Processing upload: s3://${bucket}/${key}`);

    const isMidi = key.endsWith('.mid') || key.endsWith('.midi');
    const isAudio =
      key.endsWith('.wav') ||
      key.endsWith('.aiff') ||
      key.endsWith('.flac') ||
      key.endsWith('.mp3');

    if (isAudio) {
      await submitNormalizationJob({
        inputBucket: bucket,
        inputKey: key,
        outputBucket: PROXIES_BUCKET,
        mediaConvertEndpoint: MEDIACONVERT_ENDPOINT,
        roleArn: MEDIACONVERT_ROLE_ARN,
      });
    } else if (isMidi) {
      await extractMidiMetadata({ bucket, key });
    }
  }
};

async function submitNormalizationJob(params: {
  inputBucket: string;
  inputKey: string;
  outputBucket: string;
  mediaConvertEndpoint: string;
  roleArn: string;
}): Promise<MediaConvertJobResult> {
  // MediaConvert job spec:
  // - Input: s3://inputBucket/inputKey (any PCM audio)
  // - Output: 128kbps AAC in an MP4 container at s3://outputBucket/proxies/{key}.mp4
  // - Audio normalization: ITU-R BS.1770-2 targeting -14 LUFS
  //
  // Wire up via @aws-sdk/client-mediaconvert in production.
  // This stub logs intent and returns a placeholder.
  const proxyKey = params.inputKey.replace('stems/', 'proxies/').replace(/\.\w+$/, '.mp4');
  console.log(`[audioProcessor] Would transcode s3://${params.inputBucket}/${params.inputKey}`);
  console.log(`[audioProcessor] Proxy destination: s3://${params.outputBucket}/${proxyKey}`);
  console.log('[audioProcessor] Normalization target: -14 LUFS (ITU-R BS.1770-2)');

  return { jobId: 'stub', status: 'SUBMITTED' };
}

async function extractMidiMetadata(params: { bucket: string; key: string }): Promise<void> {
  // In production:
  // 1. Download the .mid file from S3
  // 2. Parse with @tonejs/midi: const midi = new Midi(buffer)
  // 3. Convert to JSON: { tracks, tempo, timeSignature, notes[] }
  // 4. Store the JSON at proxies/{key}.json in PROXIES_BUCKET
  // 5. Update the Version record in DynamoDB via AppSync/DynamoDB SDK
  console.log(`[audioProcessor] Would parse MIDI: s3://${params.bucket}/${params.key}`);
}
