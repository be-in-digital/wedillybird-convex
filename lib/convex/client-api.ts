import { makeFunctionReference } from 'convex/server';

export type NotificationType =
  | 'rsvp_response'
  | 'rsvp_config_changed'
  | 'planning_task'
  | 'generic';

export interface NotificationItem {
  _id: string;
  type: NotificationType;
  eventId?: string;
  data?: {
    guestName?: string;
    rsvpStatus?: string;
    actorName?: string;
    taskTitle?: string;
    coupleLabel?: string;
    text?: string;
  };
  link?: string;
  readAt?: number;
  createdAt: number;
}

export const clientApi = {
  countGuestsByEvent: makeFunctionReference<
    'query',
    { eventId: string; requesterId: string },
    { total: number; attending: number; declined: number; pending: number; maybe: number }
  >('guests:countByEvent'),
  notificationsForUser: makeFunctionReference<
    'query',
    { userId: string },
    { unread: number; items: NotificationItem[] }
  >('notifications:listForUser'),
  markAllNotificationsRead: makeFunctionReference<
    'mutation',
    { userId: string },
    { ok: true; marked: number }
  >('notifications:markAllRead'),
  markNotificationRead: makeFunctionReference<
    'mutation',
    { notificationId: string; userId: string },
    { ok: true }
  >('notifications:markRead'),
  /** Booléen minuscule : la navigation n'affiche l'espace partenaire qu'à un partenaire. */
  isPartner: makeFunctionReference<'query', { userId: string }, boolean>('affiliate:isPartner'),
};
