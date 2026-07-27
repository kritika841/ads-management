CREATE TABLE "public"."push_subscriptions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "public"."profiles"("id") ON DELETE CASCADE,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  -- Prevent exact duplicate subscriptions
  UNIQUE("endpoint")
);

-- RLS policies
ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own push subscriptions"
ON "public"."push_subscriptions"
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own push subscriptions"
ON "public"."push_subscriptions"
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own push subscriptions"
ON "public"."push_subscriptions"
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
