import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/server/config';

let cachedClient: S3Client | null = null;

const getS3Client = () => {
  if (cachedClient) return cachedClient;

  if (!env.S3_BUCKET) {
    throw new Error('S3_BUCKET is not configured');
  }

  cachedClient = new S3Client({
    region: env.S3_REGION || 'us-east-1',
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle:
      !!env.S3_ENDPOINT && !/amazonaws\.com/i.test(env.S3_ENDPOINT),
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY
          }
        : undefined
  });

  return cachedClient;
};

export const ensureS3Ready = () => {
  if (!env.S3_BUCKET) {
    throw new Error('S3 configuration missing: S3_BUCKET');
  }
};

export const createPresignedUpload = async (
  key: string,
  contentType: string,
  expiresIn = 300
) => {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType
  });

  return getSignedUrl(client, command, { expiresIn });
};

export const buildS3ObjectUrl = (key: string) => {
  if (!env.S3_BUCKET) {
    throw new Error('S3_BUCKET is not configured');
  }

  const sanitizedEndpoint = env.S3_ENDPOINT?.replace(/\/+$/, '');

  if (sanitizedEndpoint) {
    if (/amazonaws\.com/.test(sanitizedEndpoint)) {
      return `${sanitizedEndpoint}/${env.S3_BUCKET}/${key}`;
    }
    return `${sanitizedEndpoint}/${env.S3_BUCKET}/${key}`;
  }

  if (env.S3_REGION) {
    return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${key}`;
  }

  return `https://${env.S3_BUCKET}.s3.amazonaws.com/${key}`;
};
