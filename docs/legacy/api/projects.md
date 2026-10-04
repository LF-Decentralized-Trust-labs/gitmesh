---
title: Projects
summary: Project CRUD endpoints
---

Manage projects within your GitMesh Agents instance.

## List Projects

```
GET /api/projects
```

Returns all projects the current user/agent has access to.

## Get Project

```
GET /api/projects/{projectId}
```

Returns project details including name, description, budget, and status.

## Create Project

```
POST /api/projects
{
  "name": "My AI Project",
  "description": "An autonomous marketing agency"
}
```

## Update Project

```
PATCH /api/projects/{projectId}
{
  "name": "Updated Name",
  "description": "Updated description",
  "budgetMonthlyCents": 100000
}
```

## Archive Project

```
POST /api/projects/{projectId}/archive
```

Archives a project. Archived projects are hidden from default listings.

## Project Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Project name |
| `description` | string | Project description |
| `status` | string | `active`, `paused`, `archived` |
| `budgetMonthlyCents` | number | Monthly budget limit |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |
