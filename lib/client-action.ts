"use client";

import { isStaleApplicationFailure } from "@/lib/chunk-load";

type ActionResponse = { ok: boolean; message?: string };

export async function runServerAction<T extends ActionResponse>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (isStaleApplicationFailure(error)) {
      window.location.reload();
      return new Promise<T>(() => undefined);
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : "The request could not be completed. Please try again."
    } as T;
  }
}

export async function runServerMutation(action: () => Promise<void>) {
  try {
    await action();
    return true;
  } catch (error) {
    if (isStaleApplicationFailure(error)) {
      window.location.reload();
      return new Promise<boolean>(() => undefined);
    }
    return false;
  }
}
