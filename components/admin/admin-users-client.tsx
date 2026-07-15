"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Pencil, Power, PowerOff, RefreshCw, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import { activateUser, deactivateUser, deleteUser, saveUser } from "@/app/actions/admin";
import { runServerAction } from "@/lib/client-action";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { averageApprovalHours, approvalRate } from "@/lib/analytics";
import { userRoles } from "@/lib/constants";
import type { AdWithRelations, Profile, UserRole } from "@/lib/types";
import { cn, formatDurationHours } from "@/lib/utils";

export function AdminUsersClient({ profiles, ads, currentProfileId }: { profiles: Profile[]; ads: AdWithRelations[]; currentProfileId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("content_creator");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [isPending, startTransition] = useTransition();

  const stats = useMemo(() => new Map(profiles.map((profile) => {
    const userAds = adsForProfile(profile, ads);
    const approved = userAds.filter((ad) => ad.status === "approved" || ad.status === "published").length;
    const rejected = userAds.filter((ad) => ad.status === "rejected").length;
    return [profile.id, { submitted: userAds.length, approved, rejected, approvalRate: approvalRate(approved, userAds.length), avgApproval: averageApprovalHours(userAds) }];
  })), [ads, profiles]);

  const filteredProfiles = useMemo(() => {
    const text = query.trim().toLowerCase();
    return profiles.filter((profile) => roleFilter === "all" || profile.role === roleFilter).filter((profile) => !text || `${profile.name} ${profile.email} ${profile.role}`.toLowerCase().includes(text));
  }, [profiles, query, roleFilter]);

  function open(profile?: Profile) {
    setEditing(profile ?? null);
    setName(profile?.name ?? "");
    setEmail(profile?.email ?? "");
    setRole(profile?.role ?? "content_creator");
    setAvatarUrl(profile?.avatar_url ?? "");
    setNewPassword(profile ? "" : generatePassword());
    setCopied(false);
    setMessage(null);
    setModalOpen(true);
  }

  function close() {
    setModalOpen(false);
    setEditing(null);
    setMessage(null);
  }

  function persist() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => saveUser({ id: editing?.id, name, email, role, avatarUrl, password: newPassword }));
      if (response.ok) close();
      else setMessage(response.message ?? "Unable to save user.");
    });
  }

  function deactivate(profile: Profile) {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => deactivateUser(profile.id));
      setMessage(response.ok ? `${profile.name} was deactivated.` : response.message ?? "Action failed.");
      if (response.ok) router.refresh();
    });
  }

  function activate(profile: Profile) {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => activateUser(profile.id));
      if (!response.ok) {
        toast({ title: "User not activated", description: response.message ?? "Action failed.", tone: "error" });
        return;
      }
      toast({ title: "User activated", description: `${profile.name} can access AdFlow again.`, tone: "success" });
      router.refresh();
    });
  }

  function removeUser() {
    if (!deleting) return;
    const profile = deleting;
    startTransition(async () => {
      const response = await runServerAction(() => deleteUser(profile.id));
      if (!response.ok) {
        toast({ title: "User not deleted", description: response.message ?? "Action failed.", tone: "error" });
        return;
      }
      setDeleting(null);
      toast({ title: "User deleted", description: `${profile.name} can no longer sign in. Historical work is preserved.`, tone: "success" });
      router.refresh();
    });
  }

  async function copyPassword() {
    await navigator.clipboard.writeText(newPassword);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const activeCount = profiles.filter((profile) => profile.active).length;

  return (
    <main className="page-container">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-2xl font-semibold text-foreground">People</h1><p className="mt-1 text-sm text-muted-foreground">Manage access, roles, passwords, and team performance.</p></div>
        <Button onClick={() => open()} className="w-full sm:w-auto"><UserPlus className="size-4" aria-hidden />Add approved user</Button>
      </div>

      <section className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        <Metric label="Total people" value={profiles.length} />
        <Metric label="Active" value={activeCount} tone="emerald" />
        <Metric label="Content creators" value={profiles.filter((item) => item.role === "content_creator").length} />
        <Metric label="Editors" value={profiles.filter((item) => item.role === "editor").length} />
      </section>

      <section className="panel mt-4 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" /></div>
          <Select className="w-full sm:w-48" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="Filter by role"><option value="all">All roles</option>{userRoles.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}</Select>
        </div>
        {message && !modalOpen ? <div className="border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground">{message}</div> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-border bg-muted/80 text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Person</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Ads</th><th className="px-4 py-3">Approved</th><th className="px-4 py-3">Approval rate</th><th className="px-4 py-3">Avg approval</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-border">
              {filteredProfiles.map((profile) => {
                const userStats = stats.get(profile.id);
                return (
                  <tr key={profile.id} className={cn("transition hover:bg-muted/80", !profile.active && "bg-muted/60")}>
                    <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar name={profile.name} src={profile.avatar_url} /><div className="min-w-0"><div className="font-medium text-foreground">{profile.name}</div><div className="text-xs text-muted-foreground">{profile.email}</div></div></div></td>
                    <td className="px-4 py-3"><span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{roleLabel(profile.role)}</span></td>
                    <td className="px-4 py-3"><span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", profile.active ? "text-success" : "text-muted-foreground")}><span className={cn("size-1.5 rounded-full", profile.active ? "bg-success" : "bg-border")} />{profile.active ? "Active" : "Inactive"}</span></td>
                    <td className="px-4 py-3 text-muted-foreground">{userStats?.submitted ?? 0}</td>
                    <td className="px-4 py-3 text-muted-foreground">{userStats?.approved ?? 0}</td>
                    <td className="px-4 py-3"><span className="font-medium text-foreground">{userStats?.approvalRate ?? 0}%</span></td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDurationHours(userStats?.avgApproval ?? null)}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" className="size-9" title="Edit user" onClick={() => open(profile)}><Pencil className="size-4" aria-hidden /></Button>{profile.active ? <Button size="icon" variant="ghost" className="size-9" title={profile.id === currentProfileId ? "You cannot deactivate yourself" : "Deactivate user"} disabled={profile.id === currentProfileId || isPending} onClick={() => deactivate(profile)}><PowerOff className="size-4" aria-hidden /></Button> : <Button size="icon" variant="ghost" className="size-9 text-success hover:bg-success/10 hover:text-success" title="Activate user" disabled={isPending} onClick={() => activate(profile)}><Power className="size-4" aria-hidden /></Button>}<Button size="icon" variant="ghost" className="size-9 text-destructive hover:bg-destructive/10 hover:text-destructive" title={profile.id === currentProfileId ? "You cannot delete yourself" : "Delete user"} disabled={profile.id === currentProfileId || isPending} onClick={() => setDeleting(profile)}><Trash2 className="size-4" aria-hidden /></Button></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!filteredProfiles.length ? <div className="flex min-h-48 flex-col items-center justify-center text-center"><Users className="size-6 text-border" aria-hidden /><p className="mt-3 text-sm font-medium text-muted-foreground">No people found</p><p className="mt-1 text-xs text-muted-foreground">Try another search or role.</p></div> : null}
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-neutral-950/45 p-0 backdrop-blur-[2px] sm:p-6" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
          <section className="mx-auto min-h-full w-full bg-card shadow-float sm:min-h-0 sm:max-w-xl sm:rounded-xl">
            <div className="flex h-16 items-center justify-between border-b border-border px-5"><div><h2 id="user-modal-title" className="text-lg font-semibold text-foreground">{editing ? "Edit user" : "Add approved user"}</h2><p className="text-xs text-muted-foreground">{editing ? "Update access and profile details" : "Create login credentials manually"}</p></div><Button size="icon" variant="ghost" title="Close" onClick={close}><X className="size-5" aria-hidden /></Button></div>
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></Field><Field label="Role"><Select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>{userRoles.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}</Select></Field></div>
              <Field label="Email"><Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" /></Field>
              <Field label="Profile photo URL" hint="Optional"><Input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://..." /></Field>
              <div className="rounded-md border border-border bg-muted p-3"><Field label={editing ? "New password" : "Initial password"} hint={editing ? "Optional. Leave blank to keep the current password." : undefined}><div className="flex gap-2"><Input value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setCopied(false); }} type="text" autoComplete="new-password" placeholder="Minimum 8 characters" /><Button size="icon" variant="secondary" title="Copy password" disabled={!newPassword} onClick={copyPassword}>{copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}</Button><Button size="icon" variant="secondary" title="Generate password" onClick={() => { setNewPassword(generatePassword()); setCopied(false); }}><RefreshCw className="size-4" aria-hidden /></Button></div></Field></div>
              {message ? <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={close}>Cancel</Button><Button disabled={isPending || !name.trim() || !email.trim() || (!editing && newPassword.length < 8) || Boolean(newPassword && newPassword.length < 8)} onClick={persist}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{editing && newPassword ? "Save profile & password" : editing ? "Save changes" : "Add user"}</Button></div>
          </section>
        </div>
      ) : null}

      {deleting ? <Modal open labelledBy="delete-user-title" onClose={() => { if (!isPending) setDeleting(null); }} className="flex items-center justify-center p-4"><section className="w-full max-w-md rounded-xl border border-border bg-card shadow-float dark:shadow-none"><div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4"><div><h2 id="delete-user-title" className="text-lg font-semibold text-foreground">Delete {deleting.name}?</h2><p className="mt-1 text-sm text-muted-foreground">This permanently removes their login access.</p></div><Button size="icon" variant="ghost" className="size-9" title="Close" disabled={isPending} onClick={() => setDeleting(null)}><X className="size-5" aria-hidden /></Button></div><div className="space-y-3 p-5"><p className="text-sm leading-6 text-muted-foreground">Their profile will be marked inactive, but past creatives, reviews, comments, and audit records will continue to show their name.</p><div className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">This user will not be able to sign in again with this account.</div></div><div className="flex justify-end gap-2 border-t border-border px-5 py-4"><Button variant="secondary" disabled={isPending} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" disabled={isPending} onClick={removeUser}>{isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}Delete user</Button></div></section></Modal> : null}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "emerald" }) {
  return <div className="bg-card px-4 py-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className={cn("mt-1 text-2xl font-semibold text-foreground", tone === "emerald" && "text-success")}>{value}</p></div>;
}

function adsForProfile(profile: Profile, ads: AdWithRelations[]) {
  if (profile.role === "content_creator") return ads.filter((ad) => ad.creator_id === profile.id);
  if (profile.role === "editor") return ads.filter((ad) => ad.editor_id === profile.id);
  return ads.filter((ad) => ad.creator_id === profile.id || ad.editor_id === profile.id);
}

function roleLabel(role: UserRole) {
  return role.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const values = new Uint32Array(16);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}
