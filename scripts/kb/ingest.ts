import pg from 'pg';
import { chunkDoc, loadKnowledge } from './lib';

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('Missing or invalid environment variables: SUPABASE_DB_URL');
  process.exit(1);
}

const chunks = loadKnowledge('knowledge').flatMap((d) => chunkDoc(d));

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  for (const c of chunks) {
    await client.query(
      `insert into kb_chunks (document_id, chunk_index, title, section, category, source_type, version, content)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (document_id, chunk_index) do update set
         title = excluded.title, section = excluded.section, category = excluded.category,
         source_type = excluded.source_type, version = excluded.version, content = excluded.content`,
      [c.documentId, c.chunkIndex, c.title, c.section, c.category, c.sourceType, c.version, c.content],
    );
  }
  // Remove chunks whose source files no longer exist.
  const keys = chunks.map((c) => `${c.documentId}#${c.chunkIndex}`);
  const removed = await client.query(
    `delete from kb_chunks where (document_id || '#' || chunk_index) <> all($1::text[])`,
    [keys],
  );
  await client.query('commit');
  console.log(`ingested ${chunks.length} chunks, removed ${removed.rowCount}`);
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}
