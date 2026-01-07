# Knowledge Graphs for Conversation Memory

## What is a Knowledge Graph?

A knowledge graph stores information as **entities** (nodes) and **relationships** (edges) — a connected web of facts rather than a flat list.

```
┌─────────────┐         uses          ┌─────────────┐
│ AuthService │ ──────────────────▶   │     JWT     │
└─────────────┘                       └─────────────┘
       │                                    │
       │ validates                          │ expires_in
       ▼                                    ▼
┌─────────────┐                       ┌─────────────┐
│    User     │ ◀─────────────────── │   Session   │
└─────────────┘      belongs_to       └─────────────┘
```

vs **Flat memory**:

```
Memory 1: "AuthService uses JWT for tokens"
Memory 2: "User sessions expire after 24h"
Memory 3: "JWT validates user identity"
```

## Why Knowledge Graphs Matter for Agents

### 1. Relationship Queries

| Query | Flat Memory | Knowledge Graph |
|-------|-------------|-----------------|
| "What uses JWT?" | Search all for "JWT" | `AuthService → uses → JWT` |
| "How does auth relate to sessions?" | Manual reading | `Auth → validates → User → has → Session` |
| "What depends on User?" | 😵 | All edges pointing to User node |

### 2. Impact Analysis

```
Agent: "I'm changing the User model, what breaks?"

Knowledge Graph:
  User ← validated_by ← AuthService
  User ← belongs_to ← Session
  User ← owns ← Order
  User ← has_many ← Notifications

  → Impact: 4 entities need review
```

Flat memory: "Found 47 memories mentioning 'user'..." 😵

### 3. Entity Extraction

When you save: "We implemented OAuth2 using Passport.js for the Express backend"

Knowledge graph auto-creates:

```
OAuth2 ──implements_with──▶ Passport.js
Passport.js ──runs_on──▶ Express
Express ──type──▶ Backend
```

### 4. Decision Reasoning

```
Decision: "Chose PostgreSQL over MongoDB"
  └─ Reason: "Need ACID transactions for payments"
      └─ Context: "Payment feature added in sprint 3"
          └─ Related: Order, User, Stripe
```

Agent can later ask: "Why did we pick PostgreSQL?" → traverses graph

## Knowledge Graph vs Flat Memory

| Capability | Flat Memory | Knowledge Graph |
|------------|-------------|-----------------|
| Store facts | ✅ | ✅ |
| Semantic search | ✅ | ✅ |
| Find relationships | ❌ Manual | ✅ Native |
| Impact analysis | ❌ | ✅ |
| Decision reasoning | ❌ | ✅ |
| Entity deduplication | ❌ | ✅ |
| Context inheritance | ❌ | ✅ |

## When You Need Knowledge Graphs

| Scenario | Need KG? |
|----------|----------|
| Simple "remember this" | ❌ Flat is fine |
| "Find similar memories" | ❌ Vector search is better |
| "How does X relate to Y" | ✅ |
| Multi-step reasoning | ✅ |
| Codebase understanding | ✅ |
| Decision documentation | ✅ |
| Impact analysis | ✅ |

## Application to Conversation History

Conversations already contain implicit relationships:

```
Conversation ──mentions──▶ File
Conversation ──linked_to──▶ Git Commit
File ──modified_by──▶ Commit
```

With knowledge graph extraction:

```
Conversation "Auth refactor"
  └─ mentions: AuthService, JWT, User
  └─ linked_to: commit abc123
  └─ discussed: "moved to refresh tokens"
      └─ reason: "security audit requirement"
```

### Enabled Queries

- "What conversations led to the JWT changes?"
- "Show all discussions about the User model"
- "Why did we change the auth flow?"
- "What files are related to the payment feature?"

## Implementation Approaches

### Entity Extraction

1. **NLP-based** - Extract named entities (libraries, classes, functions)
2. **LLM-based** - Use AI to identify concepts and relationships
3. **Code-aware** - Parse code blocks for imports, function calls

### Storage Options

| Backend | Pros | Cons |
|---------|------|------|
| **SQLite + JSON** | Simple, portable | Limited graph queries |
| **Neo4j** | Full graph queries | Heavier setup |
| **In-memory** | Fast, no setup | No persistence |

### Query Patterns

```typescript
// Find all entities related to auth
graph.query({ related_to: "auth", depth: 2 })

// Get decision chain
graph.traverse({ from: "PostgreSQL", edge: "reason" })

// Impact analysis
graph.incoming({ to: "User", depth: 1 })
```

## Status

🚧 **Planned feature** - See [roadmap](../README.md#roadmap)

Potential scope:
- Extract entities from conversation text
- Build relationships from file/commit links
- Enable graph-based queries via MCP tools
- Store in SQLite with JSON for portability
