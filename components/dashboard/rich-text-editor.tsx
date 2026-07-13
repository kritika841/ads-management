"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RichTextEditor({
  value,
  onChange
}: {
  value: string;
  onChange: (html: string, text: string) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Script, copy, shot notes, hooks..."
      })
    ],
    content: value,
    onUpdate({ editor }) {
      onChange(editor.getHTML(), editor.getText());
    }
  });

  return (
    <div className="overflow-hidden rounded-md border border-input bg-card transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
      <div className="flex items-center gap-1 border-b border-border bg-muted/80 p-2">
        <Button
          size="icon"
          variant="ghost"
          className={cn("size-8", editor?.isActive("bold") && "bg-muted text-foreground")}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <Bold className="size-4" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={cn("size-8", editor?.isActive("italic") && "bg-muted text-foreground")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="Italic"
        >
          <Italic className="size-4" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={cn("size-8", editor?.isActive("bulletList") && "bg-muted text-foreground")}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          title="Bulleted list"
        >
          <List className="size-4" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={cn("size-8", editor?.isActive("orderedList") && "bg-muted text-foreground")}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          title="Numbered list"
        >
          <ListOrdered className="size-4" aria-hidden />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button size="icon" variant="ghost" className="size-8" onClick={() => editor?.chain().focus().undo().run()} disabled={!editor?.can().undo()} title="Undo">
          <Undo2 className="size-4" aria-hidden />
        </Button>
        <Button size="icon" variant="ghost" className="size-8" onClick={() => editor?.chain().focus().redo().run()} disabled={!editor?.can().redo()} title="Redo">
          <Redo2 className="size-4" aria-hidden />
        </Button>
      </div>
      <EditorContent editor={editor} className="prose-script px-3 py-3 text-sm" />
    </div>
  );
}
