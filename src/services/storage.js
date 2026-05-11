import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import config from '../config.js';

let s3;

function getS3() {
  if (!s3) {
    s3 = new S3Client({
      endpoint: config.storage.endpoint || undefined,
      region: config.storage.region || 'us-east-1',
      credentials: {
        accessKeyId: config.storage.accessKey,
        secretAccessKey: config.storage.secretKey,
      },
      forcePathStyle: true,
    });
  }
  return s3;
}

function useS3() {
  return !!(config.storage.endpoint && config.storage.accessKey && config.storage.secretKey);
}

export async function saveFile(filename, buffer) {
  if (useS3()) {
    const client = getS3();
    await client.send(
      new PutObjectCommand({
        Bucket: config.storage.bucket,
        Key: filename,
        Body: buffer,
      }),
    );
    return filename;
  }

  const dir = config.storage.localDir;
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function readFile(filePath) {
  if (useS3()) {
    const client = getS3();
    const result = await client.send(
      new GetObjectCommand({
        Bucket: config.storage.bucket,
        Key: filePath,
      }),
    );
    return result.Body.transformToByteArray();
  }

  return fs.readFile(filePath);
}

export async function deleteFile(filePath) {
  if (useS3()) {
    const client = getS3();
    await client
      .send(
        new DeleteObjectCommand({
          Bucket: config.storage.bucket,
          Key: filePath,
        }),
      )
      .catch(() => {});
    return;
  }

  await fs.unlink(filePath).catch(() => {});
}
