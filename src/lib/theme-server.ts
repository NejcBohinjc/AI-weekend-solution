import "server-only";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE, type ThemePref } from "./theme";

export async function themePref(): Promise<ThemePref> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
