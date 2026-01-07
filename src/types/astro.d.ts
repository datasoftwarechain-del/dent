/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    userId: string | null;
    user: import('@/server/db/types').UserProfile | null;
  }
}
