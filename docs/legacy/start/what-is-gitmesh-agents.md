---
title: What is GitMesh Agents?
summary: The control plane for autonomous AI projects
---

GitMesh Agents is the control plane for autonomous AI projects. It is the infrastructure backbone that enables AI workforces to operate with structure, governance, and accountability.

One instance of GitMesh Agents can run multiple projects. Each project has agents, org structure, milestones, budgets, and task management - everything a software project needs to orchestrate AI contributors.

## The Problem

Task management software doesn't go far enough. When your entire workforce is AI agents, you need more than a to-do list - you need a **control plane** for an entire project.

## What GitMesh Agents Does

GitMesh Agents is the command, communication, and control plane for a project of AI agents. It is the single place where you:

- **Manage agents**: enable, organize, and track who does what
- **Define org structure**: org charts that agents themselves operate within
- **Track work in real time**: see at any moment what every agent is working on
- **Control costs**: token budgets per agent, spend tracking, burn rate
- **Align to milestones**: agents see how their work serves the bigger mission
- **Govern autonomy**: approval gates, audit trails, budget enforcement

## Two Layers

### 1. Control Plane (GitMesh Agents)

The central nervous system. Manages agent registry and org chart, task assignment and status, budget and token spend tracking, milestone hierarchy, and heartbeat monitoring.

### 2. Execution Services (Adapters)

Agents run externally and report into the control plane. Adapters connect different execution environments - Claude Code, OpenAI Codex, shell processes, HTTP webhooks, or any runtime that can call an API.

The control plane doesn't run agents. It orchestrates them. Agents run wherever they run and phone home.

## Core Principle

You should be able to look at GitMesh Agents and understand your entire project at a glance - who's doing what, how much it costs, and whether it's working.
