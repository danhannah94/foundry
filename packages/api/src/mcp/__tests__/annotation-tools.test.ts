import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDb, closeDb } from '../../db.js';
import { 
  listAnnotations, 
  createAnnotation, 
  resolveAnnotation, 
  submitReview 
} from '../tools/annotations.js';

// Mock the db module to use a test database
let testDbPath: string;

beforeEach(() => {
  // Create a temporary directory for test database
  const tempDir = mkdtempSync(join(tmpdir(), 'foundry-test-'));
  testDbPath = join(tempDir, 'test.db');
  process.env.FOUNDRY_DB_PATH = testDbPath;
  
  // Initialize the test database
  const db = getDb();
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      doc_path TEXT NOT NULL,
      heading_path TEXT,
      content_hash TEXT,
      quoted_text TEXT,
      content TEXT NOT NULL,
      parent_id TEXT,
      review_id TEXT,
      user_id TEXT NOT NULL,
      author_type TEXT NOT NULL CHECK (author_type IN ('human', 'ai')),
      status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'replied', 'resolved', 'orphaned')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      doc_path TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
      submitted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
});

afterEach(() => {
  // Clean up test database
  closeDb();
  if (testDbPath) {
    try {
      rmSync(testDbPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }
  delete process.env.FOUNDRY_DB_PATH;
});

describe('listAnnotations', () => {
  it('should list annotations for a doc_path', () => {
    const annotation = createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'Test annotation'
    });

    const results = listAnnotations('test-doc.md');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(annotation.id);
    expect(results[0].content).toBe('Test annotation');
  });

  it('should filter by section', () => {
    createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'Intro annotation'
    });
    createAnnotation({
      doc_path: 'test-doc.md',
      section: 'conclusion',
      content: 'Conclusion annotation'
    });

    const results = listAnnotations('test-doc.md', 'intro');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Intro annotation');
  });

  it('should filter by status', () => {
    createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'Draft annotation'
    });
    const resolved = createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'Resolved annotation'
    });
    resolveAnnotation(resolved.id);

    const submittedResults = listAnnotations('test-doc.md', undefined, 'submitted');
    expect(submittedResults).toHaveLength(1);
    expect(submittedResults[0].content).toBe('Draft annotation');

    const resolvedResults = listAnnotations('test-doc.md', undefined, 'resolved');
    expect(resolvedResults).toHaveLength(1);
    expect(resolvedResults[0].content).toBe('Resolved annotation');
  });
});

describe('createAnnotation', () => {
  it('should create annotation with default values', () => {
    const annotation = createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'Test annotation'
    });

    expect(annotation.id).toBeTruthy();
    expect(annotation.doc_path).toBe('test-doc.md');
    expect(annotation.heading_path).toBe('intro');
    expect(annotation.content).toBe('Test annotation');
    expect(annotation.user_id).toBe('clay');
    expect(annotation.author_type).toBe('ai');
    expect(annotation.status).toBe('submitted');
    expect(annotation.parent_id).toBeNull();
    expect(annotation.created_at).toBeTruthy();
    expect(annotation.updated_at).toBeTruthy();
  });

  it('should create reply annotation when parent_id provided', () => {
    const parent = createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'Parent annotation'
    });

    const reply = createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'Reply annotation',
      parent_id: parent.id
    });

    expect(reply.parent_id).toBe(parent.id);
    expect(reply.status).toBe('replied');
  });

  it('should use custom author_type when provided', () => {
    const annotation = createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'Human annotation',
      author_type: 'human'
    });

    expect(annotation.author_type).toBe('human');
  });
});

describe('resolveAnnotation', () => {
  it('should resolve existing annotation', () => {
    const annotation = createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'Test annotation'
    });

    const result = resolveAnnotation(annotation.id);

    expect(result.status).toBe('resolved');
    expect(result.annotation_id).toBe(annotation.id);

    // Verify annotation is actually resolved in database
    const resolved = listAnnotations('test-doc.md', undefined, 'resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe(annotation.id);
  });

  it('should return error for non-existent annotation', () => {
    const result = resolveAnnotation('non-existent-id');

    expect(result.status).toBe('error');
    expect(result.message).toBe('Annotation not found');
  });
});

describe('submitReview', () => {
  it('should create review with specified annotation IDs', () => {
    const annotation1 = createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'First annotation'
    });
    const annotation2 = createAnnotation({
      doc_path: 'test-doc.md',
      section: 'conclusion',
      content: 'Second annotation'
    });

    const result = submitReview('test-doc.md', [annotation1.id, annotation2.id]);

    expect(result).toMatchObject({
      status: 'review_submitted',
      doc_path: 'test-doc.md',
      comment_count: 2
    });

    expect((result as any).review_id).toBeTruthy();
    expect((result as any).submitted_at).toBeTruthy();
    expect((result as any).comments).toHaveLength(2);
  });

  it('should include all draft/submitted annotations when no IDs specified', () => {
    createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'First annotation'
    });
    createAnnotation({
      doc_path: 'test-doc.md',
      section: 'conclusion',
      content: 'Second annotation'
    });

    const result = submitReview('test-doc.md');

    expect((result as any).comment_count).toBe(2);
  });

  it('should update annotation statuses to submitted', () => {
    const annotation = createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'Test annotation'
    });

    submitReview('test-doc.md', [annotation.id]);

    // Verify annotation status was updated
    const updated = listAnnotations('test-doc.md', undefined, 'submitted');
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe(annotation.id);
  });
});