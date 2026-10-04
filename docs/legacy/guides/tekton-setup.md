# Tekton CI Integration Guide

GitMesh integrates with [Tekton](https://tekton.dev/) pipelines for CI/CD policy enforcement. When a Tekton PipelineRun completes, GitMesh evaluates your project's governance policies and can block merges or require approval on failure.

## Prerequisites

- A running GitMesh instance (`http://localhost:3100` or your deployed URL)
- A GitMesh project with forge webhook configured
- Tekton Pipelines v0.50+ installed in your Kubernetes cluster

## Setup

### 1. Register a Tekton Webhook in GitMesh

```bash
curl -X POST http://localhost:3100/api/projects/$PROJECT_ID/forge/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "forgeProvider": "tekton",
    "forgeOwner": "my-org",
    "forgeRepo": "my-repo",
    "events": ["pipeline_completed", "pipeline_failed"]
  }'
```

### 2. Configure Tekton EventListener

Create a Tekton EventListener that forwards CloudEvents to GitMesh:

```yaml
apiVersion: triggers.tekton.dev/v1beta1
kind: EventListener
metadata:
  name: gitmesh-listener
spec:
  triggers:
    - name: gitmesh-policy-gate
      interceptors:
        - ref:
            name: cel
          params:
            - name: filter
              value: >-
                header.match('ce-type', 'dev.tekton.event.pipelinerun.*')
      bindings:
        - ref: gitmesh-binding
      template:
        ref: gitmesh-trigger-template
```

### 3. Add Tekton TriggerBinding

```yaml
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerBinding
metadata:
  name: gitmesh-binding
spec:
  params:
    - name: pipeline-name
      value: $(body.pipelineRun.metadata.name)
    - name: pipeline-status
      value: $(body.pipelineRun.status.conditions[0].status)
```

### 4. Create CloudEvent Sink

Configure Tekton to send CloudEvents to your GitMesh webhook endpoint:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: config-defaults
  namespace: tekton-pipelines
data:
  default-cloud-events-sink: "http://gitmesh.your-domain.com/api/forge/webhook/tekton"
```

### 5. Label Your PipelineRuns

Add GitMesh project ID as a label on your PipelineRun resources:

```yaml
apiVersion: tekton.dev/v1beta1
kind: PipelineRun
metadata:
  name: my-pr-build
  labels:
    gitmesh.io/project-id: "your-project-uuid"
  annotations:
    tekton.dev/git-url: "https://github.com/my-org/my-repo"
    tekton.dev/log-url: "https://tekton-dashboard.example.com/runs/my-pr-build"
spec:
  pipelineRef:
    name: my-pipeline
```

## How It Works

```
Tekton PipelineRun Completes
        │
        ▼
CloudEvent sent to GitMesh
 POST /api/forge/webhook/tekton
        │
        ▼
GitMesh resolves project ID
  (from labels/annotations)
        │
        ▼
Activity logged: ci_result
  { pipeline, status, logs_url }
        │
        ▼
If FAILED → Policy evaluation
  policyEngine.evaluate({
    action: "ci_failed",
    context: { pipeline, status }
  })
        │
   ┌────┴────┐
   │         │
 allow     block
   │         │
   ▼         ▼
 (noop)   ci_merge_blocked
          logged + approval
          required for PRs
```

## Policy Rules for Tekton

Add policies to block merges when CI fails:

```yaml
- name: Block merge on CI failure
  actionPattern: ci_failed
  effect: block
  priority: 5

- name: Require approval after CI retry
  actionPattern: ci_failed
  conditions:
    retryCount: ["2", "3"]
  effect: require_approval
  priority: 15
```

## Tekton Task: GitMesh Policy Gate

Use this Tekton Task to evaluate GitMesh policies before proceeding with pipeline steps:

```yaml
apiVersion: tekton.dev/v1beta1
kind: Task
metadata:
  name: gitmesh-policy-gate
  labels:
    app.kubernetes.io/version: "0.1"
spec:
  description: >-
    Evaluate GitMesh governance policies before pipeline execution.
    Fails the task if policy returns "block".
  params:
    - name: gitmesh-url
      type: string
      default: "http://gitmesh:3100"
    - name: project-id
      type: string
    - name: action
      type: string
      default: "merge_pr"
    - name: agent-id
      type: string
      default: "tekton-ci"
  steps:
    - name: evaluate-policy
      image: curlimages/curl:latest
      script: |
        #!/bin/sh
        set -e

        RESPONSE=$(curl -sf -X POST \
          "$(params.gitmesh-url)/api/projects/$(params.project-id)/policies/evaluate" \
          -H "Content-Type: application/json" \
          -d "{
            \"agentId\": \"$(params.agent-id)\",
            \"action\": \"$(params.action)\",
            \"context\": {}
          }")

        EFFECT=$(echo "$RESPONSE" | grep -o '"effect":"[^"]*"' | cut -d'"' -f4)

        echo "GitMesh Policy Effect: $EFFECT"

        if [ "$EFFECT" = "block" ]; then
          REASON=$(echo "$RESPONSE" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4)
          echo "ERROR: Policy blocked - $REASON"
          exit 1
        fi

        if [ "$EFFECT" = "require_approval" ]; then
          echo "WARNING: Policy requires approval - proceeding with caution"
        fi

        echo "Policy evaluation passed: $EFFECT"
```

### Using the Gate in a Pipeline

```yaml
apiVersion: tekton.dev/v1beta1
kind: Pipeline
metadata:
  name: my-pipeline
spec:
  tasks:
    - name: policy-check
      taskRef:
        name: gitmesh-policy-gate
      params:
        - name: project-id
          value: "$(params.project-id)"
        - name: action
          value: "merge_pr"

    - name: build
      runAfter: [policy-check]
      taskRef:
        name: my-build-task

    - name: deploy
      runAfter: [build]
      taskRef:
        name: my-deploy-task
```

## Troubleshooting

### Webhook Not Received

1. Verify CloudEvents sink is configured in Tekton ConfigMap
2. Check network connectivity between Tekton and GitMesh
3. Verify the `gitmesh.io/project-id` label is set on PipelineRun
4. Check GitMesh server logs for incoming webhook payloads

### Project Not Resolved

GitMesh resolves the project from:

1. `gitmesh.io/project-id` label (preferred)
2. `gitmesh.io/project-id` annotation
3. `tekton.dev/git-url` annotation matched against registered projects

Ensure at least one of these is set on your PipelineRun.

### Policy Not Evaluated

- Verify policies exist for your project: `GET /api/projects/$PROJECT_ID/policies`
- Test evaluation manually: `POST /api/projects/$PROJECT_ID/policies/evaluate`
- Check the audit log for policy evaluation results
