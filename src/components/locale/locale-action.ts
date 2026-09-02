"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE } from "@/i18n/request";

/** Persist the language choice for a year; the whole tree re-renders in it. */
export async function setLocale(locale: string) {
  const value = locale === "de" ? "de" : "en";
  const store = await cookies();
  store.set(LOCALE_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
