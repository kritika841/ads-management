import type { AdStatus } from "@/lib/types";

export type ResubmissionFeedbackItem = {
  id: string;
  body: string;
  context: string;
  authorName: string;
  createdAt: string;
};

export function isResubmissionStatus(status: AdStatus) {
  return status === "changes_requested" || status === "rejected";
}

export function validateResubmissionConfirmation(status: AdStatus, confirmed: boolean) {
  if (isResubmissionStatus(status) && !confirmed) {
    return "Confirm that you have made the necessary changes before resubmitting.";
  }

  return null;
}
