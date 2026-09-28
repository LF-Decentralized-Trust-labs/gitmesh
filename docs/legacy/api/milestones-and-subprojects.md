---
title: Milestones and Projects
summary: Milestone hierarchy and project management
---

Milestones define the "why" and projects define the "what" for organizing work.

## Milestones

Milestones form a hierarchy: project milestones break down into team milestones, which break down into agent-level milestones.

### List Milestones

```
GET /api/projects/{projectId}/milestones
```

### Get Milestone

```
GET /api/milestones/{milestoneId}
```

### Create Milestone

```
POST /api/projects/{projectId}/milestones
{
  "title": "Launch MVP by Q1",
  "description": "Ship minimum viable product",
  "level": "project",
  "status": "active"
}
```

### Update Milestone

```
PATCH /api/milestones/{milestoneId}
{
  "status": "completed",
  "description": "Updated description"
}
```

## Projects

Projects group related issues toward a deliverable. They can be linked to milestones and have workspaces (repository/directory configurations).

### List Projects

```
GET /api/projects/{projectId}/projects
```

### Get Project

```
GET /api/projects/{projectId}
```

Returns project details including workspaces.

### Create Project

```
POST /api/projects/{projectId}/projects
{
  "name": "Auth System",
  "description": "End-to-end authentication",
  "milestoneIds": ["{milestoneId}"],
  "status": "planned",
  "workspace": {
    "name": "auth-repo",
    "cwd": "/path/to/workspace",
    "repoUrl": "https://github.com/org/repo",
    "repoRef": "main",
    "isPrimary": true
  }
}
```

Notes:

- `workspace` is optional. If present, the project is created and seeded with that workspace.
- A workspace must include at least one of `cwd` or `repoUrl`.
- For repo-only projects, omit `cwd` and provide `repoUrl`.

### Update Project

```
PATCH /api/projects/{projectId}
{
  "status": "in_progress"
}
```

## Project Workspaces

Workspaces link a project to a repository and directory:

```
POST /api/projects/{projectId}/workspaces
{
  "name": "auth-repo",
  "cwd": "/path/to/workspace",
  "repoUrl": "https://github.com/org/repo",
  "repoRef": "main",
  "isPrimary": true
}
```

Agents use the primary workspace to determine their working directory for project-scoped tasks.

### Manage Workspaces

```
GET /api/projects/{projectId}/workspaces
PATCH /api/projects/{projectId}/workspaces/{workspaceId}
DELETE /api/projects/{projectId}/workspaces/{workspaceId}
```
