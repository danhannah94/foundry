export type AnnotationStatus = "draft" | "submitted" | "replied" | "resolved" | "orphaned";
export type AuthorType = "human" | "ai";
export type ReviewStatus = "draft" | "submitted" | "complete";

export interface Annotation {
  id: string;
  doc_path: string;
  heading_path: string;
  content_hash: string;
  quoted_text: string | null;
  content: string;
  parent_id: string | null;
  review_id: string | null;
  user_id: string;
  author_type: AuthorType;
  status: AnnotationStatus;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: string;
  doc_path: string;
  user_id: string;
  status: ReviewStatus;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAnnotationBody {
  doc_path: string;
  heading_path: string;
  content_hash: string;
  quoted_text?: string;
  content: string;
  parent_id?: string;
  review_id?: string;
  author_type?: AuthorType;
  user_id?: string;
}

export interface CreateReviewBody {
  doc_path: string;
  user_id?: string;
}