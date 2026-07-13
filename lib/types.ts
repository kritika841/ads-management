export type UserRole = "admin" | "manager" | "editor" | "content_creator";

export type AdStatus =
  | "draft"
  | "pending_review"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "published";

export type AdType = "video" | "image" | "carousel" | "story" | "reel";

export type Platform =
  | "Meta Ads"
  | "Youtube Ads"
  | "Taboola Ads"
  | "Social Media";

export type ApprovalStage = "manager_review" | "admin_final" | "complete";

export type ProductionStage =
  | "script_writing"
  | "ready_to_shoot"
  | "shoot_complete"
  | "ready_for_edit"
  | "editing"
  | "creator_review"
  | "final_review"
  | "changes_requested"
  | "approved";

export type Profile = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar_url: string | null;
  active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Campaign = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Ad = {
  id: string;
  name: string;
  campaign_id: string;
  product_id: string | null;
  creator_id: string | null;
  editor_id: string | null;
  status: AdStatus;
  approval_stage: ApprovalStage;
  drive_url: string | null;
  drive_file_id: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  script_html: string | null;
  script_text: string | null;
  ad_type: AdType | null;
  platforms: Platform[];
  deadline: string | null;
  notes: string | null;
  live_url: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  published_at: string | null;
  production_stage: ProductionStage;
  raw_footage_url: string | null;
  script_ready_at: string | null;
  shoot_completed_at: string | null;
  raw_footage_shared_at: string | null;
  editing_started_at: string | null;
  creator_reviewed_at: string | null;
  final_approved_at: string | null;
  workflow_status_changed_at: string;
  editor_notes: string | null;
  updated_at: string;
  created_at: string;
};

export type AdWithRelations = Ad & {
  creator: Pick<Profile, "id" | "name" | "email" | "avatar_url" | "role"> | null;
  editor: Pick<Profile, "id" | "name" | "email" | "avatar_url" | "role"> | null;
  campaign: Pick<Campaign, "id" | "name"> | null;
  product: Pick<Product, "id" | "name" | "sku" | "image_url"> | null;
  tags: { id: string; name: string }[];
  version_count?: number;
};

export type AdVersion = {
  id: string;
  ad_id: string;
  version_number: number;
  drive_url: string | null;
  drive_file_id: string | null;
  preview_url: string | null;
  script_html: string | null;
  script_text: string | null;
  feedback_snapshot: string | null;
  created_by: string;
  created_at: string;
};

export type Comment = {
  id: string;
  ad_id: string;
  author_id: string;
  body: string;
  mentions: string[];
  created_at: string;
  author?: Pick<Profile, "id" | "name" | "avatar_url" | "role">;
};

export type ReviewAction = {
  id: string;
  ad_id: string;
  reviewer_id: string;
  decision: "approve" | "request_changes" | "reject" | "publish";
  note: string | null;
  created_at: string;
  reviewer?: Pick<Profile, "id" | "name" | "avatar_url" | "role">;
};

export type Annotation = {
  id: string;
  ad_id: string;
  version_id: string | null;
  author_id: string;
  kind: "video_timestamp" | "script_inline";
  timestamp_seconds: number | null;
  script_anchor: string | null;
  body: string;
  resolved_at: string | null;
  created_at: string;
  author?: Pick<Profile, "id" | "name" | "avatar_url" | "role">;
};

export type ActivityLog = {
  id: string;
  ad_id: string | null;
  actor_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: Pick<Profile, "id" | "name" | "avatar_url" | "role"> | null;
};

export type AuditLog = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: Pick<Profile, "id" | "name" | "avatar_url" | "role"> | null;
};

export type Assignment = {
  id: string;
  ad_id: string;
  assigned_to: string;
  assigned_by: string;
  created_at: string;
};

export type Tag = {
  id: string;
  name: string;
};

export type AdTag = {
  ad_id: string;
  tag_id: string;
};

export type Notification = {
  id: string;
  user_id: string;
  ad_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type AppSettings = {
  id: number;
  two_step_approval: boolean;
  email_notifications: boolean;
  deadline_reminder_days: number;
  max_concurrent_edits: number;
  assignment_start_sla_hours: number;
  editing_sla_hours: number;
  creator_review_sla_hours: number;
  final_review_sla_hours: number;
  revision_sla_hours: number;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & Pick<Profile, "id" | "name" | "email" | "role">;
        Update: Partial<Profile>;
      };
      campaigns: {
        Row: Campaign;
        Insert: Partial<Campaign> & Pick<Campaign, "name">;
        Update: Partial<Campaign>;
      };
      products: {
        Row: Product;
        Insert: Partial<Product> & Pick<Product, "name">;
        Update: Partial<Product>;
      };
      ads: {
        Row: Ad;
        Insert: Partial<Ad> & Pick<Ad, "name" | "campaign_id">;
        Update: Partial<Ad>;
      };
      ad_versions: {
        Row: AdVersion;
        Insert: Partial<AdVersion> & Pick<AdVersion, "ad_id" | "version_number" | "created_by">;
        Update: Partial<AdVersion>;
      };
      review_actions: {
        Row: ReviewAction;
        Insert: Partial<ReviewAction> &
          Pick<ReviewAction, "ad_id" | "reviewer_id" | "decision">;
        Update: Partial<ReviewAction>;
      };
      annotations: {
        Row: Annotation;
        Insert: Partial<Annotation> & Pick<Annotation, "ad_id" | "author_id" | "kind" | "body">;
        Update: Partial<Annotation>;
      };
      comments: {
        Row: Comment;
        Insert: Partial<Comment> & Pick<Comment, "ad_id" | "author_id" | "body">;
        Update: Partial<Comment>;
      };
      notifications: {
        Row: Notification;
        Insert: Partial<Notification> & Pick<Notification, "user_id" | "title" | "body">;
        Update: Partial<Notification>;
      };
      activity_logs: {
        Row: ActivityLog;
        Insert: Partial<ActivityLog> & Pick<ActivityLog, "action">;
        Update: Partial<ActivityLog>;
      };
      audit_logs: {
        Row: AuditLog;
        Insert: Partial<AuditLog> & Pick<AuditLog, "action" | "target_type">;
        Update: Partial<AuditLog>;
      };
      assignments: {
        Row: Assignment;
        Insert: Partial<Assignment> & Pick<Assignment, "ad_id" | "assigned_to" | "assigned_by">;
        Update: Partial<Assignment>;
      };
      tags: {
        Row: Tag;
        Insert: Partial<Tag> & Pick<Tag, "name">;
        Update: Partial<Tag>;
      };
      ad_tags: {
        Row: AdTag;
        Insert: AdTag;
        Update: Partial<AdTag>;
      };
      app_settings: {
        Row: AppSettings;
        Insert: Partial<AppSettings>;
        Update: Partial<AppSettings>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      snapshot_ad_version: {
        Args: { p_ad_id: string; p_created_by: string };
        Returns: number;
      };
      creator_review_ad_atomic: {
        Args: { p_ad_id: string; p_actor_id: string; p_decision: string; p_note: string | null };
        Returns: Ad;
      };
      final_review_ad_atomic: {
        Args: { p_ad_id: string; p_actor_id: string; p_decision: string; p_note: string | null };
        Returns: Ad;
      };
      sync_ad_tags_atomic: {
        Args: { p_ad_id: string; p_tags: string[] };
        Returns: undefined;
      };
      submit_edited_video_atomic: {
        Args: { p_ad_id: string; p_actor_id: string; p_drive_url: string; p_drive_file_id: string; p_preview_url: string; p_thumbnail_url: string; p_editor_notes: string };
        Returns: Ad;
      };
      transition_editor_work_atomic: {
        Args: { p_ad_id: string; p_actor_id: string; p_action: string; p_editor_id: string | null; p_deadline: string | null; p_reason: string | null };
        Returns: Ad;
      };
    };
    Enums: {
      user_role: UserRole;
      ad_status: AdStatus;
      ad_type: AdType;
      approval_stage: ApprovalStage;
    };
    CompositeTypes: Record<string, never>;
  };
};
