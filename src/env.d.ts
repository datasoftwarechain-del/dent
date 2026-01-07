/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SESSION_SECRET?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_ANON_KEY?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly REDIS_URL?: string;
  readonly DEFAULT_ALERT_DAYS?: string;
  readonly STRIPE_SECRET_KEY?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly S3_ENDPOINT?: string;
  readonly S3_ACCESS_KEY_ID?: string;
  readonly S3_SECRET_ACCESS_KEY?: string;
  readonly S3_REGION?: string;
  readonly S3_BUCKET?: string;
  readonly SMTP_HOST?: string;
  readonly SMTP_PORT?: string;
  readonly SMTP_USER?: string;
  readonly SMTP_PASS?: string;
  readonly PORT?: string;
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace NodeJS {
  interface ProcessEnv {
    SESSION_SECRET?: string;
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    REDIS_URL?: string;
    DEFAULT_ALERT_DAYS?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    S3_ENDPOINT?: string;
    S3_ACCESS_KEY_ID?: string;
    S3_SECRET_ACCESS_KEY?: string;
    S3_REGION?: string;
    S3_BUCKET?: string;
    SMTP_HOST?: string;
    SMTP_PORT?: string;
    SMTP_USER?: string;
    SMTP_PASS?: string;
    PORT?: string;
    AWS_S3_ENDPOINT?: string;
    AWS_S3_ACCESS_KEY_ID?: string;
    AWS_S3_SECRET_ACCESS_KEY?: string;
    AWS_S3_REGION?: string;
    AWS_S3_BUCKET?: string;
    PUBLIC_SUPABASE_URL?: string;
    PUBLIC_SUPABASE_ANON_KEY?: string;
  }
}
