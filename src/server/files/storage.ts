import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config';
import { logger } from '../logger';

const hasCredentials = env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY;

export const s3Client = new S3Client({
  region: env.S3_REGION || undefined,
  endpoint: env.S3_ENDPOINT || undefined,
  forcePathStyle: Boolean(env.S3_ENDPOINT),
  credentials: hasCredentials
    ? {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!
      }
    : undefined
});

export const createUploadUrl = async (key: string, contentType: string) => {
  if (!env.S3_BUCKET) {
    throw new Error('S3_BUCKET no configurado');
  }

  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType
  });

  return getSignedUrl(s3Client, command, { expiresIn: 900 });
};

export const createDownloadUrl = async (key: string) => {
  if (!env.S3_BUCKET) {
    throw new Error('S3_BUCKET no configurado');
  }

  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key
  });

  try {
    return await getSignedUrl(s3Client, command, { expiresIn: 900 });
  } catch (error) {
    logger.error({ error, key }, 'No se pudo generar URL firmada');
    throw error;
  }
};
