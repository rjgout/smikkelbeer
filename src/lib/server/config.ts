import { z } from 'zod';
import { one, run, audit } from './db';
import { encrypt, decrypt } from './crypto';
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const mailbox = z.union([z.literal(''), z.email().max(254)]);
export const settingsSchema = z
  .object({
    publicUrl: z
      .url()
      .refine(
        (v) =>
          new URL(v).protocol === 'https:' &&
          new URL(v).pathname === '/' &&
          !new URL(v).username &&
          !new URL(v).password &&
          !new URL(v).search &&
          !new URL(v).hash,
        'Gebruik een HTTPS-origin zonder pad',
      ),
    timezone: z.literal('Europe/Amsterdam'),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7),
    exceptions: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
    inviteTime: clock,
    closeTime: clock,
    sendTime: clock,
    arrivalTime: clock,
    minPreparation: z.number().int().min(10).max(180),
    reminderMinutes: z.number().int().min(5).max(120),
    secondReminder: z.boolean(),
    confirmationMinutes: z.number().int().min(5).max(120),
    tokenMinutes: z.number().int().min(5).max(30),
    retentionDays: z.number().int().min(30).max(730),
    paymentMode: z.enum(['individual', 'advance']),
    paymentLink: z.union([
      z.literal(''),
      z
        .url()
        .refine(
          (s) => new URL(s).protocol === 'https:' && !new URL(s).username && !new URL(s).password,
        ),
    ]),
    smtp: z.object({
      host: z.string().max(253),
      port: z
        .number()
        .int()
        .refine((p) => p === 465 || p === 587),
      user: z.string().max(254),
      password: z.string().max(2048),
      from: mailbox,
    }),
    imap: z.object({
      enabled: z.boolean(),
      host: z.string().max(253),
      port: z.literal(993),
      user: z.string().max(254),
      password: z.string().max(2048),
    }),
    cafeteria: mailbox,
    coordinator: mailbox,
    testMode: z.boolean(),
    testRecipients: z.array(z.email()).max(10),
    scrapingApproved: z.boolean(),
    syncIntervalMs: z.number().int().min(1000).max(10000),
    templates: z.object({
      invitation: z.string().min(1).max(500),
      confirmation: z.string().min(1).max(500),
    }),
  })
  .superRefine((s, c) => {
    if (!(s.inviteTime < s.closeTime && s.closeTime <= s.sendTime && s.sendTime < s.arrivalTime))
      c.addIssue({ code: 'custom', message: 'Uitnodiging < sluiting ≤ verzending < aankomst' });
    const minutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
    if (minutes(s.arrivalTime) - minutes(s.sendTime) < s.minPreparation)
      c.addIssue({ code: 'custom', message: 'Onvoldoende voorbereidingstijd' });
    if (s.cafeteria && s.testRecipients.some((e) => e.toLowerCase() === s.cafeteria.toLowerCase()))
      c.addIssue({ code: 'custom', message: 'Cafetaria mag nooit een testontvanger zijn' });
    if (!s.testMode && (!s.cafeteria || !s.coordinator || !s.smtp.host || !s.scrapingApproved))
      c.addIssue({
        code: 'custom',
        message: 'Productiemodus vereist bronbeoordeling, SMTP, cafetaria en coördinator',
      });
  });
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  publicUrl: 'https://smikkelbeer.example',
  timezone: 'Europe/Amsterdam',
  weekdays: [5],
  exceptions: [],
  inviteTime: '11:45',
  closeTime: '12:00',
  sendTime: '12:05',
  arrivalTime: '12:30',
  minPreparation: 20,
  reminderMinutes: 10,
  secondReminder: true,
  confirmationMinutes: 15,
  tokenMinutes: 15,
  retentionDays: 90,
  paymentMode: 'individual',
  paymentLink: '',
  smtp: { host: '', port: 465, user: '', password: '', from: '' },
  imap: { enabled: false, host: '', port: 993, user: '', password: '' },
  cafeteria: '',
  coordinator: '',
  testMode: true,
  testRecipients: [],
  scrapingApproved: false,
  syncIntervalMs: 1000,
  templates: {
    invitation: 'Tijd voor iets lekkers! Bevestig je eenmalige link om te bestellen.',
    confirmation: 'Je bestelling is opgeslagen. Wijzigen kan tot de sluitingstijd.',
  },
};
export function settings(): Settings {
  const row = one('SELECT value FROM settings WHERE id=1');
  return row ? JSON.parse(decrypt(row.value)) : structuredClone(defaults);
}
export function publicSettings() {
  const s = settings();
  s.smtp.password = '';
  s.imap.password = '';
  return {
    ...s,
    smtpPasswordSet: !!settings().smtp.password,
    imapPasswordSet: !!settings().imap.password,
  };
}
export function saveSettings(input: unknown, actor: string) {
  const old = settings(),
    next = settingsSchema.parse(input);
  next.smtp.password ||= old.smtp.password;
  next.imap.password ||= old.imap.password;
  run(
    'INSERT INTO settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
    encrypt(JSON.stringify(next)),
  );
  audit(actor, 'settings.update');
}
