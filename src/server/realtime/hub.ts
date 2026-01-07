import { EventEmitter } from 'node:events';
import { logger } from '../logger';

type WorkOrderChannelEvent = {
  workOrderId: string;
  type: string;
  payload: Record<string, unknown>;
};

type NotificationEvent = {
  userId: string;
  notificationId: string;
};

const emitter = new EventEmitter();

export const realtime = {
  publishWorkOrder(event: WorkOrderChannelEvent) {
    logger.debug({ event }, 'Realtime: work order event');
    emitter.emit(`work-order:${event.workOrderId}`, event);
  },
  publishNotification(event: NotificationEvent) {
    logger.debug({ event }, 'Realtime: notification event');
    emitter.emit(`notification:${event.userId}`, event);
  },
  onWorkOrder(workOrderId: string, listener: (event: WorkOrderChannelEvent) => void) {
    emitter.on(`work-order:${workOrderId}`, listener);
    return () => emitter.off(`work-order:${workOrderId}`, listener);
  },
  onNotification(userId: string, listener: (event: NotificationEvent) => void) {
    emitter.on(`notification:${userId}`, listener);
    return () => emitter.off(`notification:${userId}`, listener);
  }
};
