"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { addComment } from "@/app/actions/ads";
import { runServerAction } from "@/lib/client-action";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import type { Comment } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function CommentThread({ adId, comments }: { adId: string; comments: Comment[] }) {
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{comment.body}</p>
            </div>
          </div>
        ))}
        {!comments.length ? <p className="py-3 text-center text-sm text-muted-foreground">No comments yet.</p> : null}
      </div>
      <div className="mt-4 space-y-2">
        <Textarea className="min-h-20" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a comment or @mention a teammate" />
        {message ? <p className="text-sm text-destructive">{message}</p> : null}
        <Button className="w-full" disabled={isPending || !body.trim()} onClick={submit}>
          {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
          Send comment
        </Button>
      </div>
    </section>
  );
}
