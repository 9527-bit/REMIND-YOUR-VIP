export type DeliveryState = "pending" | "sent" | "failed" | "uncertain";

export type NotificationRecent = {
  kind: "test" | "reminder";
  name: string;
  status: DeliveryState;
  updatedAt: number;
  error: string | null;
};

export type EmailStatus = {
  enabled: boolean;
  configured: boolean;
  recipient: string;
  timeZone: string;
  reminderHour: number;
  reminderMinute: number;
  testAvailableAt: number;
  recent: NotificationRecent[];
};

export type BarkStatus = {
  enabled: boolean;
  configured: boolean;
  server: string;
  maskedKey: string;
  sound: string;
  group: string;
  timeZone: string;
  reminderHour: number;
  reminderMinute: number;
  testAvailableAt: number;
  recent: NotificationRecent[];
};

export type NotificationStatus = EmailStatus & {
  email: EmailStatus;
  bark: BarkStatus;
};
