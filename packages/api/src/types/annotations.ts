export interface Annotation {
  id: string;
  doc_path: string;
  section: string;
  content: string;
  parent_id?: string;
  status: 'open' | 'resolved';
  created_at: string;
  updated_at: string;
}