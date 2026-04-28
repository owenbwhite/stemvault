import type { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createWriteStream, createReadStream, statSync, unlinkSync } from 'fs';
import { finished } from 'stream/promises';
import { spawn } from 'child_process';
import type { Readable } from 'stream';

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// S3 key format: stems/{entityId}/stems/{stemId}/{versionId}.ext
// Proxy key:     proxies/{entityId}/stems/{stemId}/{versionId}.mp3
export const handler = async (event: S3Event): Promise<void> => {
  const { PROXIES_BUCKET_NAME, STEM_VERSION_TABLE } = process.env;
  if (!PROXIES_BUCKET_NAME || !STEM_VERSION_TABLE) {
    throw new Error('Missing PROXIES_BUCKET_NAME or STEM_VERSION_TABLE');
  }

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    if (!/\.(wav|aiff?|flac|mp3)$/i.test(key)) {
      console.log(`Skipping non-audio key: ${key}`);
      continue;
    }

    const parts = key.split('/');
    if (parts.length < 5) {
      console.log(`Unexpected key format (need 5 segments): ${key}`);
      continue;
    }

    const entityId = parts[1];
    const stemId = parts[3];
    const versionId = parts[4].split('.')[0];
    const ext = parts[4].split('.').pop() ?? 'wav';

    const inputPath = `/tmp/${versionId}.${ext}`;
    const outputPath = `/tmp/${versionId}.mp3`;
    const proxyKey = `proxies/${entityId}/stems/${stemId}/${versionId}.mp3`;

    try {
      if (/\.mp3$/i.test(key)) {
        // Already MP3 — server-side copy to proxies bucket, no transcoding needed
        console.log(`Copying MP3 directly: ${key} → ${proxyKey}`);
        await s3.send(new CopyObjectCommand({
          Bucket: PROXIES_BUCKET_NAME,
          CopySource: `${bucket}/${encodeURIComponent(key)}`,
          Key: proxyKey,
          ContentType: 'audio/mpeg',
        }));
      } else {
        // WAV / AIFF / FLAC — download, transcode to 256kbps MP3, upload
        console.log(`Downloading s3://${bucket}/${key}`);
        const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!Body) throw new Error('Empty S3 response body');
        const fileStream = createWriteStream(inputPath);
        await finished((Body as Readable).pipe(fileStream));

        console.log(`Transcoding to 256kbps MP3: ${outputPath}`);
        await runFfmpeg(inputPath, outputPath);

        const { size } = statSync(outputPath);
        console.log(`Uploading proxy (${(size / 1024 / 1024).toFixed(1)} MB) to s3://${PROXIES_BUCKET_NAME}/${proxyKey}`);
        await s3.send(new PutObjectCommand({
          Bucket: PROXIES_BUCKET_NAME,
          Key: proxyKey,
          Body: createReadStream(outputPath),
          ContentType: 'audio/mpeg',
          ContentLength: size,
        }));
      }

      // Update StemVersion.proxyS3Key directly in DynamoDB.
      // Note: this bypasses AppSync subscriptions — the new key is visible
      // on the next fresh load, not in real-time for already-open sessions.
      await dynamo.send(new UpdateCommand({
        TableName: STEM_VERSION_TABLE,
        Key: { id: versionId },
        UpdateExpression: 'SET proxyS3Key = :k',
        ExpressionAttributeValues: { ':k': proxyKey },
      }));

      console.log(`Done: ${key} → ${proxyKey}`);
    } finally {
      for (const p of [inputPath, outputPath]) {
        try { unlinkSync(p); } catch { /* already gone */ }
      }
    }
  }
};

function runFfmpeg(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('/opt/bin/ffmpeg', [
      '-y',
      '-i', input,
      '-vn',          // strip any embedded video/artwork
      '-b:a', '256k',
      '-f', 'mp3',
      output,
    ]);
    proc.stderr.on('data', (d: Buffer) => process.stdout.write(d));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}
