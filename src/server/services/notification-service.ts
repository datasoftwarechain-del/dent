import { z } from 'zod';
import { supabaseAdmin } from '../db/client';
import { realtime } from '../realtime/hub';
import { sendEmail } from '../notifications/email';
import { logger } from '../logger';

const NotificationChannel = {
  EMAIL: 'EMAIL',
  IN_APP: 'IN_APP'
} as const;

const notificationSchema = z.object({
  userId: z.string().min(1),
  channel: z.nativeEnum(NotificationChannel),
  title: z.string().min(1),
  body: z.string().min(1),
  metadata: z.record(z.any()).optional()
});

export const createNotification = async (payload: z.infer<typeof notificationSchema>) => {
  const data = notificationSchema.parse(payload);

  const { data: notification, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      userId: data.userId,
      channel: data.channel,
      title: data.title,
      body: data.body,
      metadata: data.metadata ?? null
    })
    .select('*')
    .single();

  if (error || !notification) {
    throw new Error('No se pudo crear la notificación');
  }

  realtime.publishNotification({
    userId: notification.userId,
    notificationId: notification.id
  });

  if (data.channel === NotificationChannel.EMAIL) {
    try {
      const { data: user } = await supabaseAdmin
        .from('user_profiles')
        .select('email')
        .eq('id', data.userId)
        .maybeSingle();

      if (user?.email) {
        await sendEmail({
          to: user.email,
          subject: data.title,
          text: data.body
        });
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to send notification email');
    }
  }

  return notification;
};

export const listNotifications = async (userId: string) => {
  const { data: notifications, error } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('userId', userId)
    .order('createdAt', { ascending: false })
    .limit(50);

  if (error) {
    throw new Error('No se pudieron listar notificaciones');
  }

  return notifications ?? [];
};

export const markNotificationAsRead = async (notificationId: string) => {
  const { data: updated, error } = await supabaseAdmin
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId)
    .select('*')
    .single();

  if (error) {
    throw new Error('No se pudo actualizar la notificación');
  }

  return updated;
};
