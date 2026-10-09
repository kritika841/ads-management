-- Add missing UPDATE policy for push_subscriptions so upsert operations don't violate RLS
CREATE POLICY "Users can update their own push subscriptions"
ON "public"."push_subscriptions"
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
