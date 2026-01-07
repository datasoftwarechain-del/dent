import { Queue, Worker, type JobsOptions } from 'bullmq';
import Redis from 'ioredis';
import { differenceInMilliseconds } from 'date-fns';
import { env } from '../config';
import { logger } from '../logger';

type ReminderJob = {
  workOrderId: string;
  dueDate: string;
  dentistId: string;
  labId?: string | null;
};

let connection: Redis | null = null;
let queue: Queue<ReminderJob> | null = null;
let worker: Worker<ReminderJob> | null = null;
let redisDisabledLogged = false;

const queueName = 'work-order-alerts';

const ensureConnection = () => {
  if (connection) return connection;

  if (!env.REDIS_URL) {
    if (!redisDisabledLogged) {
      logger.warn('Redis URL not configured. Alert queue disabled.');
      redisDisabledLogged = true;
    }
    connection = null;
    return null;
  }

  try {
    connection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true
    });

    connection.on('error', (error) => {
      logger.error({ error }, 'Redis connection error');
    });

    return connection;
  } catch (error) {
    logger.warn({ error }, 'Unable to connect to Redis. Alert queue disabled.');
    connection = null;
    return null;
  }
};

const ensureQueue = () => {
  if (queue) return queue;

  const redis = ensureConnection();
  if (!redis) return null;

  queue = new Queue<ReminderJob>(queueName, { connection: redis });

  return queue;
};

const ensureWorker = () => {
  if (worker) return worker;

  const redis = ensureConnection();
  if (!redis) return null;

  worker = new Worker<ReminderJob>(
    queueName,
    async (job) => {
      logger.info({ jobId: job.id, data: job.data }, 'Processing work order reminder');
      // TODO: Integrate with notifications service once ready
    },
    {
      connection: redis
    }
  );

  return worker;
};

export const startAlertQueue = () => {
  ensureQueue();
  ensureWorker();
};

export const scheduleWorkOrderReminder = async (
  payload: ReminderJob,
  options?: JobsOptions
) => {
  const q = ensureQueue();
  ensureWorker();

  if (!q) {
    logger.warn({ payload }, 'Alert queue not available. Skipping reminder scheduling.');
    return;
  }

  const delay = Math.max(
    differenceInMilliseconds(new Date(payload.dueDate), new Date()) - env.DEFAULT_ALERT_DAYS * 86400000,
    0
  );

  await q.add(
    'work-order-reminder',
    payload,
    {
      delay,
      removeOnComplete: true,
      removeOnFail: true,
      ...options
    }
  );

  logger.info({ payload, delay }, 'Work order reminder scheduled');
};

process.on('exit', () => {
  connection?.quit();
  worker?.close();
});
