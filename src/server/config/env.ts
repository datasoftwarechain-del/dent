import "dotenv/config";
import { z } from "zod";

const optionalString = () =>
  z
    .string()
    .optional()
    .transform((value) => value?.trim())
    .pipe(
      z
        .string()
        .optional()
        .transform((value) => (value && value.length > 0 ? value : undefined))
    );

const optionalStringWithDefault = (defaultValue = "") =>
  optionalString().transform((value) => value ?? defaultValue);

const requiredString = (label: string) =>
  z.string().min(1, `${label} is required`);

const optionalNumber = (defaultValue?: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) {
        return defaultValue;
      }

      if (typeof value === "number") {
        return value;
      }

      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return defaultValue;
      }

      const numeric = Number(trimmed);
      if (Number.isNaN(numeric)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Expected a numeric value",
        });
        return z.NEVER;
      }

      return numeric;
    });

export const EnvSchema = z.object({
  SESSION_SECRET: optionalStringWithDefault(""),
  ASTRO_SITE: optionalString(),
  NODE_ENV: optionalString(),
  SUPABASE_URL: requiredString("SUPABASE_URL"),
  SUPABASE_ANON_KEY: requiredString("SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: requiredString("SUPABASE_SERVICE_ROLE_KEY"),
  PUBLIC_SUPABASE_URL: optionalString(),
  PUBLIC_SUPABASE_ANON_KEY: optionalString(),
  REDIS_URL: optionalStringWithDefault(""),
  DEFAULT_ALERT_DAYS: optionalNumber(2),
  STRIPE_SECRET_KEY: optionalStringWithDefault(""),
  STRIPE_WEBHOOK_SECRET: optionalStringWithDefault(""),
  S3_ENDPOINT: optionalStringWithDefault(""),
  S3_ACCESS_KEY_ID: optionalStringWithDefault(""),
  S3_SECRET_ACCESS_KEY: optionalStringWithDefault(""),
  S3_REGION: optionalStringWithDefault(""),
  S3_BUCKET: optionalStringWithDefault(""),
  SMTP_HOST: optionalStringWithDefault(""),
  SMTP_PORT: optionalNumber(),
  SMTP_USER: optionalStringWithDefault(""),
  SMTP_PASS: optionalStringWithDefault(""),
  TWILIO_ACCOUNT_SID: optionalStringWithDefault(""),
  TWILIO_AUTH_TOKEN: optionalStringWithDefault(""),
  TWILIO_WHATSAPP_FROM: optionalStringWithDefault(""),
  PORT: optionalNumber(4321),
});

const parsed = EnvSchema.safeParse({
  SESSION_SECRET: process.env.SESSION_SECRET,
  ASTRO_SITE: process.env.ASTRO_SITE,
  NODE_ENV: process.env.NODE_ENV,
  SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? process.env.PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY: process.env.PUBLIC_SUPABASE_ANON_KEY,
  REDIS_URL: process.env.REDIS_URL,
  DEFAULT_ALERT_DAYS: process.env.DEFAULT_ALERT_DAYS,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? process.env.AWS_S3_ENDPOINT,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_S3_SECRET_ACCESS_KEY,
  S3_REGION: process.env.S3_REGION ?? process.env.AWS_S3_REGION,
  S3_BUCKET: process.env.S3_BUCKET ?? process.env.AWS_S3_BUCKET,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM,
  PORT: process.env.PORT,
});

if (!parsed.success) {
  console.error("❌ Invalid environment variables", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

const { DEFAULT_ALERT_DAYS, PORT, ...rest } = parsed.data;

export const env = {
  ...rest,
  DEFAULT_ALERT_DAYS: DEFAULT_ALERT_DAYS ?? 2,
  PORT: PORT ?? 4321,
};
