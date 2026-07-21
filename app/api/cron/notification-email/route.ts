import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60; // Extend duration if many emails

// Vercel Cron handler for emailing unread notifications after 1 hour.
export async function GET(request: Request) {
  // Basic auth check for cron
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const resend = new Resend(process.env.RESEND_API_KEY || "re_mock_key"); // Use real key if set
  
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  try {
    // 1. Fetch unread notifications older than 1 hour that haven't been emailed yet
    const { data: notifications, error } = await admin
      .from("notifications")
      .select("id, title, body, created_at, user:profiles!notifications_user_id_fkey(id, email, name)")
      .is("read_at", null)
      .is("emailed_at", null)
      .lte("created_at", oneHourAgo);

    if (error) {
      console.error("Cron Error fetching notifications:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!notifications || notifications.length === 0) {
      return NextResponse.json({ message: "No notifications to email" });
    }

    // Group by user so we don't spam them with 10 separate emails at once if they have many
    const groupedByUser = notifications.reduce((acc, note) => {
      // Ignore if user has no email or profile somehow
      if (!note.user || Array.isArray(note.user)) return acc;
      
      const email = (note.user as any).email;
      if (!acc[email]) acc[email] = { name: (note.user as any).name, notes: [] };
      acc[email].notes.push(note);
      return acc;
    }, {} as Record<string, { name: string; notes: typeof notifications }>);

    let sentCount = 0;
    const sentNoteIds: string[] = [];

    // Send emails
    for (const [email, { name, notes }] of Object.entries(groupedByUser)) {
      if (!email) continue;

      const htmlContent = `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6366f1;">Hi ${name},</h2>
          <p>You have ${notes.length} unread notification${notes.length > 1 ? "s" : ""} waiting for you in AdFlow.</p>
          <ul style="padding-left: 20px;">
            ${notes.map(n => `
              <li style="margin-bottom: 15px;">
                <strong style="display: block;">${n.title}</strong>
                <span style="color: #666; font-size: 14px;">${n.body}</span>
              </li>
            `).join("")}
          </ul>
          <div style="margin-top: 30px;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://adflow.local"}/dashboard" style="background-color: #6366f1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Open AdFlow
            </a>
          </div>
        </div>
      `;

      try {
        if (process.env.RESEND_API_KEY) {
          await resend.emails.send({
            from: "AdFlow Notifications <notifications@adflow.app>",
            to: email,
            subject: `You have ${notes.length} unread notification${notes.length > 1 ? "s" : ""}`,
            html: htmlContent
          });
        } else {
          // Mock sending for local dev
          console.log(`[MOCK EMAIL SENT to ${email}]: ${notes.length} notifications`);
        }
        sentCount++;
        sentNoteIds.push(...notes.map(n => n.id));
      } catch (err) {
        console.error(`Failed to send email to ${email}:`, err);
      }
    }

    // Mark as emailed
    if (sentNoteIds.length > 0) {
      await admin
        .from("notifications")
        .update({ emailed_at: new Date().toISOString() })
        .in("id", sentNoteIds);
    }

    return NextResponse.json({ 
      message: `Processed ${notifications.length} notifications into ${sentCount} emails.`,
      emailsSent: sentCount
    });

  } catch (error) {
    console.error("Cron unexpected error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
