import outputs from '../../amplify_outputs.json';

type BucketEntry = { name: string; bucket_name: string; aws_region: string };

function getBucketOption(name: string) {
  const bucket = (outputs.storage.buckets as BucketEntry[]).find((b) => b.name === name);
  if (!bucket) throw new Error(`Bucket "${name}" not found in amplify_outputs`);
  return { bucketName: bucket.bucket_name, region: bucket.aws_region };
}

export const proxiesBucketOption = getBucketOption('stemvaultProxies');
