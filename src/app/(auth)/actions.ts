"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { isGoogleConfigured, signIn, signOut } from "@/lib/auth";
import { childLogger } from "@/lib/log";

const log = childLogger("auth");

async function startGoogle(authorizationParams?: Record<string, string>) {
  if (!isGoogleConfigured()) {
    log.error(
      "Google sign-in is not configured: set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET (see .env.example)",
    );
    redirect("/login?error=Configuration");
  }
  try {
    // Full-page redirect to Google (no popup), so it works in iOS standalone mode.
    await signIn("google", { redirectTo: "/home" }, authorizationParams);
  } catch (err) {
    // signIn() signals success by throwing Next's redirect; only handle Auth.js errors.
    if (err instanceof AuthError) {
      log.error({ err: { name: err.name, type: err.type, message: err.message } }, "sign-in failed to start");
      redirect(`/login?error=${encodeURIComponent(err.type)}`);
    }
    throw err;
  }
}

export async function signInWithGoogle() {
  await startGoogle();
}

/** From /denied: force Google's account chooser so a different account can be picked. */
export async function switchAccount() {
  await startGoogle({ prompt: "select_account" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
