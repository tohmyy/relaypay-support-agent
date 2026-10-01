-- Ties escalation records to the call they came from (set from the MCP request's conversation id).

alter table escalations add column conversation_id text references conversations (conversation_id);

create index escalations_conversation_id_idx on escalations (conversation_id);
