"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  History,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminSendUserResetEmailAction } from "@/app/actions/password";
import { roleLabel } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";

export type PasswordStatusItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  lastChangedAt: string;
  expiresAt: string;
  daysRemaining: number;
  isExpired: boolean;
};

export function SecuritySettingsPanel({
  initialStatuses = []
}: {
  initialStatuses?: PasswordStatusItem[];
}) {
  const [statuses, setStatuses] = useState<PasswordStatusItem[]>(initialStatuses);
  const [sendingUserId, setSendingUserId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    id: string;
    success: boolean;
    text: string;
    actionLink?: string;
    emailDelivered?: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSendReset(user: PasswordStatusItem) {
    setActionFeedback(null);
    setSendingUserId(user.id);
    startTransition(async () => {
      try {
        const res = await adminSendUserResetEmailAction(user.id);
        if (res.ok) {
          setActionFeedback({
            id: user.id,
            success: true,
            actionLink: res.actionLink,
            emailDelivered: Boolean(res.emailDelivered),
            text: res.emailDelivered
              ? `Reset link successfully emailed to ${user.email}.`
              : `Reset link generated for ${user.email}. You can copy the direct link below to share with the user:`
          });
        } else {
          setActionFeedback({
            id: user.id,
            success: false,
            text: res.message || "Failed to send reset email."
          });
        }
      } catch (err) {
        setActionFeedback({
          id: user.id,
          success: false,
          text: err instanceof Error ? err.message : "Error sending email."
        });
      } finally {
        setSendingUserId(null);
      }
    });
  }

  const expiredCount = statuses.filter((s) => s.isExpired).length;
  const expiringSoonCount = statuses.filter((s) => !s.isExpired && s.daysRemaining <= 5).length;
  const activeCount = statuses.filter((s) => !s.isExpired && s.daysRemaining > 5).length;

  return (
    <div className="space-y-6">
      {/* Policy Highlights */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="panel p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Clock className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Password Lifespan</p>
              <h3 className="text-base font-semibold text-foreground">30-Day Rotation</h3>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            All roles (admin, manager, editor, creator) must regenerate credentials within 30 days.
          </p>
        </div>

        <div className="panel p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-success/10 text-success">
              <History className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">History Enforcement</p>
              <h3 className="text-base font-semibold text-foreground">Zero Reuse Policy</h3>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Historically used passwords can never be reused by the user, verified via salted hashes.
          </p>
        </div>

        <div className="panel p-4 sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <ShieldAlert className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Team Health</p>
              <h3 className="text-base font-semibold text-foreground">
                {expiredCount > 0 ? `${expiredCount} Expired` : "All Credentials Active"}
              </h3>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {activeCount} active • {expiringSoonCount} expiring soon • {expiredCount} locked out
          </p>
        </div>
      </div>

      {/* Admin Own Password Quick Action */}
      <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <KeyRound className="size-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">Manage Your Personal Password</p>
            <p className="text-xs text-muted-foreground">
              Update your administrator credentials or check your countdown timer.
            </p>
          </div>
        </div>
        <Link href="/settings">
          <Button size="sm" variant="secondary">
            Open Account Settings
          </Button>
        </Link>
      </div>

      {/* Global Feedback Banner */}
      {actionFeedback ? (
        <div
          className={`flex flex-col gap-2 rounded-lg border p-3.5 text-xs font-medium sm:flex-row sm:items-center sm:justify-between ${
            actionFeedback.success
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          <div className="flex items-center gap-2">
            {actionFeedback.success ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : (
              <AlertCircle className="size-4 shrink-0" />
            )}
            <span>{actionFeedback.text}</span>
          </div>

          {actionFeedback.actionLink ? (
            <div className="flex items-center gap-2 pt-1 sm:pt-0">
              <Button
                size="sm"
                variant="secondary"
                type="button"
                className="h-7 text-[11px]"
                onClick={() => {
                  navigator.clipboard.writeText(actionFeedback.actionLink!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                <Copy className="mr-1.5 size-3" />
                {copied ? "Copied Link!" : "Copy Link"}
              </Button>
              <a href={actionFeedback.actionLink} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="secondary" className="h-7 text-[11px]" type="button">
                  <ExternalLink className="mr-1.5 size-3" />
                  Open Link
                </Button>
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Team Security Table */}
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="section-heading">Team Password Status</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Monitor credential status across all roles and trigger password reset links when needed.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-border bg-muted/80 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Last Changed</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {statuses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No team members found.
                  </td>
                </tr>
              ) : (
                statuses.map((user) => {
                  const isSendingThisUser = sendingUserId === user.id;

                  return (
                    <tr key={user.id} className="transition hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{user.name}</div>
                        <div className="text-xs text-muted-foreground">{user.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                          {roleLabel(user.role as any)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {user.lastChangedAt ? formatDateTime(user.lastChangedAt) : "Initial"}
                      </td>
                      <td className="px-4 py-3">
                        {user.isExpired ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/15 px-2.5 py-0.5 text-xs font-semibold text-destructive">
                            <ShieldAlert className="size-3" />
                            Expired (Locked)
                          </span>
                        ) : user.daysRemaining <= 5 ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
                            <Clock className="size-3" />
                            Expires in {user.daysRemaining}d
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
                            <ShieldCheck className="size-3" />
                            Active ({user.daysRemaining}d left)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isSendingThisUser || isPending}
                          onClick={() => handleSendReset(user)}
                          title={`Email reset link to ${user.email}`}
                        >
                          {isSendingThisUser ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          ) : (
                            <Send className="mr-1.5 size-3.5" />
                          )}
                          Send Reset Link
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
