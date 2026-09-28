---
title: Creating a Project
summary: Set up your first autonomous AI project
---

A project is the top-level unit in GitMesh Agents. Everything - agents, tasks, milestones, budgets - lives under a project.

## Step 1: Create the Project

In the web UI, click "New Project" and provide:

- **Name**: your project's name
- **Description**: what this project does (optional but recommended)

## Step 2: Set a Milestone

Every project needs a milestone - the north star that all work traces back to. Good milestones are specific and measurable:

- "Ship v2.0 with full API coverage by end of quarter"
- "Triage all open issues and close stale ones by Friday"

Go to the Milestones section and create your top-level project milestone.

## Step 3: Create the Admin Agent

The admin agent is the first agent you create. Choose an adapter type (Claude Local is a good default) and configure:

- **Name**: e.g. "Admin", "Triage Bot"
- **Role**: `triage` or `general`
- **Adapter**: how the agent runs (Claude Local, Codex Local, etc.)
- **Prompt template**: instructions for what the agent does on each heartbeat
- **Budget**: monthly spend limit in cents

The admin agent's prompt should instruct it to review project health, triage incoming issues, and delegate work to other agents.

## Step 4: Build the Org Chart

From the admin agent, create additional agents:

- **PR Review agent**: reviews pull requests
- **Security agent**: monitors vulnerabilities
- **Docs agent**: keeps documentation up to date
- **Other agents** as needed

Each agent gets their own adapter config, role, and budget. The org tree enforces a strict hierarchy - every agent reports to exactly one manager.

## Step 5: Set Budgets

Set monthly budgets at both the project and per-agent level. GitMesh Agents enforces:

- **Soft alert** at 80% utilization
- **Hard stop** at 100% - agents are auto-paused

## Step 6: Launch

Enable heartbeats for your agents and they'll start working. Monitor progress from the dashboard.
