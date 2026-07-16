"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { addComment, grantAdAccess } from "@/app/actions/ads";
import { runServerAction } from "@/lib/client-action";
import { extractMentions, profileMentionHandles } from "@/lib/mentions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import type { Comment, Profile } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type MentionableUser = Pick<Profile, "id" | "name" | "email" | "avatar_url"> & { hasAccess: boolean };

export function CommentThread({ adId, comments, mentionableUsers = [], canGrantAccess = false }: { adId: string; comments: Comment[]; mentionableUsers?: MentionableUser[]; canGrantAccess?: boolean }) {
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [grantedIds, setGrantedIds] = useState<Set<string>>(new Set());
  const [grantingId, setGrantingId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return mentionableUsers
      .filter((user) => user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query))
      .slice(0, 6);
  }, [mentionQuery, mentionableUsers]);

  const noAccessMentioned = useMemo(() => {
    if (!canGrantAccess) return [];
    const mentions = extractMentions(body);
    if (!mentions.length) return [];
    return mentionableUsers.filter(
      (user) => !user.hasAccess && !grantedIds.has(user.id) && profileMentionHandles(user).some((handle) => mentions.includes(handle))
    );
  }, [body, mentionableUsers, canGrantAccess, grantedIds]);

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    const cursor = event.target.selectionStart;
    setBody(value);
    updateMentionState(value, cursor);
  }

  function updateMentionState(value: string, cursor: number) {
    const upToCursor = value.slice(0, cursor);
    const match = upToCursor.match(/(?:^|\s)@([a-zA-Z0-9._-]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStart(cursor - match[1].length - 1);
      setActiveIndex(0);
    } else {
      setMentionQuery(null);
      setMentionStart(null);
    }
  }

  function selectMention(user: MentionableUser) {
    if (mentionStart === null || mentionQuery === null) return;
    const handle = profileMentionHandles(user)[0] ?? user.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "");
    const before = body.slice(0, mentionStart);
    const after = body.slice(mentionStart + 1 + mentionQuery.length);
    const next = `${before}@${handle} ${after}`;
    setBody(next);
    setMentionQuery(null);
    setMentionStart(null);

    const cursor = before.length + handle.length + 2;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery === null || !suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      selectMention(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      setMentionQuery(null);
      setMentionStart(null);
    }
  }

  function grantAccess(user: MentionableUser) {
    setGrantingId(user.id);
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => grantAdAccess(adId, user.id));
      if (!response.ok) {
        setMessage(response.message ?? "Could not grant access.");
        setGrantingId(null);
        return;
      }
      setGrantedIds((prev) => new Set(prev).add(user.id));
      setGrantingId(null);
    });
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const response = await runServerAction(() => addComment(adId, body));
      if (!response.ok) {
        setMessage(response.message ?? "Unable to comment.");
        return;
      }
      setBody("");
    });
  }

  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between"><h2 className="section-heading">Discussion</h2><span className="text-xs text-muted-foreground">{comments.length}</span></div>
      <div className="mt-4 space-y-4">
        {comments.map((comment) => (
          <div key={comment.id} className="flex gap-3">
            <Avatar name={comment.author?.name ?? "User"} src={comment.author?.avatar_url} className="size-8" />
            <div className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{comment.author?.name ?? "Unknown"}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(comment.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{renderCommentBody(comment.body)}</p>
            </div>
          </div>
        ))}
        {!comments.length ? <p className="py-3 text-center text-sm text-muted-foreground">No comments yet.</p> : null}
      </div>
      <div className="relative mt-4 space-y-2">
        <Textarea
          ref={textareaRef}
          className="min-h-20"
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => window.setTimeout(() => setMentionQuery(null), 120)}
          placeholder="Write a comment or @mention a teammate"
        />
        {mentionQuery !== null && suggestions.length ? (
          <div className="absolute bottom-full left-0 z-10 mb-1 w-full max-w-72 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-float">
            {suggestions.map((user, index) => (
              <button
                key={user.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                )}
                onMouseDown={(event) => { event.preventDefault(); selectMention(user); }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <Avatar name={user.name} src={user.avatar_url} className="size-6" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{user.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">@{profileMentionHandles(user)[0]}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {noAccessMentioned.map((user) => (
          <div key={user.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-warning-foreground">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0"><strong className="font-medium">{user.name}</strong> doesn&apos;t have access to this creative.</span>
            </span>
            <Button size="sm" variant="secondary" disabled={grantingId === user.id} onClick={() => grantAccess(user)}>
              {grantingId === user.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              Grant access
            </Button>
          </div>
        ))}
        {message ? <p className="text-sm text-destructive">{message}</p> : null}
        <Button className="w-full" disabled={isPending || !body.trim()} onClick={submit}>
          {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
          Send comment
        </Button>
      </div>
    </section>
  );
}

function renderCommentBody(body: string) {
  const parts = body.split(/(@[a-zA-Z0-9._-]+)/g);
  return parts.map((part, index) =>
    part.startsWith("@") ? (
      <span key={index} className="font-medium text-primary">{part}</span>
    ) : (
      <span key={index}>{part}</span>
    )
  );
}
