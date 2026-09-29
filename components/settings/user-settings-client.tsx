"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Loader2,
  Lock,
  LockKeyhole,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Avatar } from "@/components/ui/avatar";
import { changePasswordAction } from "@/app/actions/password";
import type { PasswordStatus } from "@/lib/password-security";
import type { Profile } from "@/lib/types";
import { roleLabel } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";

export function UserSettingsClient({
  profile,
  initialStatus
}: {
  profile: Profile;
  initialStatus: PasswordStatus;
}) {
  const [status, setStatus] = useState<PasswordStatus>(initialStatus);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Password lifespan percentage (0% to 100%)
  const daysTotal = 30;
  const daysRemaining = status.daysRemaining;
  const daysUsed = Math.max(0, Math.min(daysTotal, daysTotal - daysRemaining));
  const lifespanPercent = Math.round((daysUsed / daysTotal) * 100);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "New password and confirmation do not match." });
      return;
    }

    if (newPassword.length < 8) {
      setMessage({ type: "error", text: "Password must be at least 8 characters long." });
      return;
    }

    startTransition(async () => {
      const res = await changePasswordAction({
        currentPassword: currentPassword || undefined,
        newPassword,
        confirmPassword
      });

      if (!res.ok) {
        setMessage({ type: "error", text: res.error || "Failed to update password." });
        return;
      }

      setMessage({
        type: "success",
        text: res.message || "Password updated successfully! It will expire in 30 days."
      });

      // Reset form fields
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      // Update local status with fresh 30-day lifecycle
      setStatus({
        isExpired: false,
        daysRemaining: 30,
        lastChangedAt: new Date().toISOString(),
        expiresAt: res.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        hasHistory: true
      });
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 lg:px-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Account Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your personal profile, credentials, and password security policies.
        </p>
      </div>

      {/* Profile Overview Card */}
      <div className="panel p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={profile.name} src={profile.avatar_url} className="size-16 text-lg" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">{profile.name}</h2>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {roleLabel(profile.role)}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{profile.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar className="size-4" />
            <span>Member since {formatDateTime(profile.created_at)}</span>
          </div>
        </div>
      </div>

      {/* Password Security Lifecycle Card */}
      <div className="panel overflow-hidden">
        <div className="border-b border-border bg-muted/40 px-6 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <KeyRound className="size-5 text-primary" />
              <div>
                <h2 className="text-base font-semibold text-foreground">Password & Credentials</h2>
                <p className="text-xs text-muted-foreground">30-day lifecycle and historical security enforcement</p>
              </div>
            </div>

            {/* Status Badge */}
            <div>
              {status.isExpired ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/15 px-3 py-1 text-xs font-semibold text-destructive">
                  <ShieldAlert className="size-3.5" />
                  Expired
                </span>
              ) : status.daysRemaining <= 5 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/15 px-3 py-1 text-xs font-semibold text-warning">
                  <Clock className="size-3.5" />
                  Expiring in {status.daysRemaining} {status.daysRemaining === 1 ? "day" : "days"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/15 px-3 py-1 text-xs font-semibold text-success">
                  <ShieldCheck className="size-3.5" />
                  Active ({status.daysRemaining} days remaining)
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {/* Lifespan Progress Bar */}
          <div className="rounded-xl border border-border bg-card/60 p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">30-Day Password Lifespan</span>
              <span className="font-semibold text-foreground">
                {status.daysRemaining} days remaining
              </span>
            </div>

            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all duration-500 ${
                  status.isExpired
                    ? "bg-destructive w-full"
                    : status.daysRemaining <= 5
                      ? "bg-warning"
                      : "bg-primary"
                }`}
                style={{ width: `${status.isExpired ? 100 : Math.min(100, lifespanPercent)}%` }}
              />
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Set: {formatDateTime(status.lastChangedAt)}</span>
              <span>Expires: {formatDateTime(status.expiresAt)}</span>
            </div>
          </div>

          {/* Security Rules Banner */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <Clock className="mt-0.5 size-4 text-primary shrink-0" />
              <div>
                <p className="font-medium text-foreground">Mandatory 30-Day Rotation</p>
                <p className="mt-0.5 text-muted-foreground">
                  Your password automatically expires after 30 days. You can regenerate a new password at any time.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <History className="mt-0.5 size-4 text-primary shrink-0" />
              <div>
                <p className="font-medium text-foreground">Zero Password Reuse</p>
                <p className="mt-0.5 text-muted-foreground">
                  Passwords you have ever historically used cannot be set again.
                </p>
              </div>
            </div>
          </div>

          {/* Feedback Message */}
          {message ? (
            <div
              role="alert"
              className={`flex items-start gap-2.5 rounded-lg border p-3.5 text-sm ${
                message.type === "success"
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}
            >
              {message.type === "success" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          ) : null}

          {/* Change Password Form */}
          <form className="space-y-4" onSubmit={handleSubmit}>
            <Field label="Current Password" htmlFor="current-password">
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="current-password"
                  className="px-9"
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 select-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setShowCurrent(true);
                  }}
                  onPointerUp={() => setShowCurrent(false)}
                  onPointerLeave={() => setShowCurrent(false)}
                  title="Hold to reveal"
                  aria-label="Hold to reveal current password"
                >
                  {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New Password" htmlFor="new-password">
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="new-password"
                    className="px-9"
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 select-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setShowNew(true);
                    }}
                    onPointerUp={() => setShowNew(false)}
                    onPointerLeave={() => setShowNew(false)}
                    title="Hold to reveal"
                    aria-label="Hold to reveal new password"
                  >
                    {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>

              <Field label="Confirm New Password" htmlFor="confirm-new-password">
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="confirm-new-password"
                    className="px-9"
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    minLength={8}
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 select-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setShowConfirm(true);
                    }}
                    onPointerUp={() => setShowConfirm(false)}
                    onPointerLeave={() => setShowConfirm(false)}
                    title="Hold to reveal"
                    aria-label="Hold to reveal confirm password"
                  >
                    {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Shield className="mr-2 size-4" />}
                Update Password
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
