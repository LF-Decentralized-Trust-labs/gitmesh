import os
import yaml
import requests
import shutil
from datetime import datetime, timedelta, timezone

# --- CONFIGURATION ---
# IST Offset (UTC+5:30)
IST = timezone(timedelta(hours=5, minutes=30))

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
REPO = os.getenv("GITHUB_REPOSITORY")  # Format: "owner/repo"
CANONICAL_REPO = "LF-Decentralized-Trust-labs/gitmesh" # Fork protection target

REGISTRY_PATH = "governance/contributors.yaml"
HISTORY_DIR = "governance/history/users/"
LEDGER_PATH = "governance/history/ledger.yaml"

headers = {
    "Authorization": f"token {GITHUB_TOKEN}",
    "Accept": "application/vnd.github.v3+json"
}

def get_now_ist_str():
    """Returns current IST time in ISO format."""
    return datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S+05:30")

def get_merged_prs(since_date=None, per_page=100):
    """Fetches merged PRs. If since_date is provided, fetches only PRs merged after that date."""
    all_prs = []
    page = 1
    
    since_dt = None
    if since_date:
        try:
            since_dt = datetime.fromisoformat(since_date)
        except ValueError:
            print(f"Warning: Could not parse since_date '{since_date}'. Fetching all.")
            since_dt = None

    print(f"Fetching merged PRs{' since ' + since_date if since_date else ' (ALL)'}...")

    while True:
        # Fetch closed PRs, sorted by updated desc to get recent ones first
        url = f"https://api.github.com/repos/{REPO}/pulls?state=closed&sort=updated&direction=desc&per_page={per_page}&page={page}"
        try:
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            pulls = response.json()
            
            if not pulls:
                break
                
            relevant_prs_in_batch = 0
            
            for pr in pulls:
                if not pr.get('merged_at'):
                    continue
                
                merged_at_str = pr['merged_at']
                merged_at_dt = datetime.fromisoformat(merged_at_str.replace('Z', '+00:00'))
                
                # Filter by date
                if since_dt and merged_at_dt <= since_dt:
                    continue
                
                all_prs.append({
                    'username': pr['user']['login'],
                    'merged_at': pr['merged_at'],
                    'url': pr['html_url'],
                    'title': pr['title'],
                    'number': pr['number']
                })
                relevant_prs_in_batch += 1
            
            print(f"Fetched page {page}: Found {relevant_prs_in_batch} new merged PRs")
            
            if not pulls:
                break
                
            page += 1
            # Limit pages for safety if needed, but for clean start we want all.
            if page > 50 and since_dt: # If incremental, 50 pages (5000 PRs) is plenty to look back
                 print("Reached page limit for incremental sync.")
                 break
            
        except Exception as e:
            print(f"Error fetching PRs page {page}: {e}")
            break
            
    return all_prs

def get_last_activity_date(username):
    """Queries GitHub Events API to find the user's latest public action."""
    url = f"https://api.github.com/users/{username}/events/public"
    try:
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            events = response.json()
            if events and isinstance(events, list):
                return events[0]['created_at'].split('T')[0]
    except Exception as e:
        print(f"Error fetching activity for {username}: {e}")
    return None

def update_user_history(username, event_type, details):
    """Maintains an append-only audit log for each contributor."""
    os.makedirs(HISTORY_DIR, exist_ok=True)
    # Use lowercase filename to avoid case-sensitivity issues on some filesystems
    path = os.path.join(HISTORY_DIR, f"{username.lower()}.yaml")
    
    data = {"username": username, "events": []}
    if os.path.exists(path):
        with open(path, 'r') as f:
            existing_data = yaml.safe_load(f)
            if existing_data:
                data = existing_data

    # Avoid duplicate events if possible (simple check)
    # Construct new event
    new_event = {
        "timestamp": get_now_ist_str(),
        "type": event_type,
        "details": details
    }
    
    data['events'].append(new_event)

    with open(path, 'w') as f:
        yaml.dump(data, f, sort_keys=False, default_flow_style=False)

def update_ledger(event_type, username, details):
    """Maintains a global ledger of all governance events."""
    os.makedirs(os.path.dirname(LEDGER_PATH), exist_ok=True)
    
    data = {"events": []}
    if os.path.exists(LEDGER_PATH) and os.path.getsize(LEDGER_PATH) > 0:
        with open(LEDGER_PATH, 'r') as f:
            existing_data = yaml.safe_load(f)
            if existing_data and 'events' in existing_data:
                data = existing_data
    
    data['events'].append({
        "timestamp": get_now_ist_str(),
        "type": event_type,
        "username": username,
        "details": details
    })
    
    with open(LEDGER_PATH, 'w') as f:
        yaml.dump(data, f, sort_keys=False, default_flow_style=False)

def main():
    # --- FORK PROTECTION CHECK ---
    if REPO != CANONICAL_REPO:
        print(f"Skipping governance sync: Current repo '{REPO}' is a fork or doesn't match '{CANONICAL_REPO}'.")
        return

    if not os.path.exists(REGISTRY_PATH):
        print(f"Registry not found at {REGISTRY_PATH}")
        return

    with open(REGISTRY_PATH, 'r') as f:
        registry = yaml.safe_load(f)

    contributors = registry.get('contributors', [])
    # Normalize usernames to lowercase for case-insensitive comparison
    existing_usernames = {c['username'].lower() for c in contributors}
    
    # Check Metadata for Last Sync
    if 'metadata' not in registry:
        registry['metadata'] = {}
    
    last_sync = registry['metadata'].get('last_sync')
    
    # Determine Mode
    clean_start = False
    if not last_sync:
        clean_start = True
        print("No last_sync found. Performing CLEAN START.")
    elif not os.path.exists(HISTORY_DIR) or not os.listdir(HISTORY_DIR):
        clean_start = True
        print("History directory empty or missing despite last_sync. Forcing CLEAN START.")
    
    # Execute Clean Start Logic
    if clean_start:
        print("Clearing history directories...")
        if os.path.exists(HISTORY_DIR):
            shutil.rmtree(HISTORY_DIR)
        os.makedirs(HISTORY_DIR, exist_ok=True)
        
        if os.path.exists(LEDGER_PATH):
            os.remove(LEDGER_PATH)
            
        # Fetch ALL merged PRs
        prs_to_process = get_merged_prs(since_date=None)
        
        # Re-initialize history for existing contributors
        for contributor in contributors:
            username = contributor['username']
            update_user_history(
                username, 
                "ROLE_ASSIGNMENT",
                f"Assigned role: {contributor['role']} by {contributor.get('assigned_by', 'unknown')}"
            )
            update_ledger(
                "ROLE_ASSIGNMENT",
                username,
                f"Role: {contributor['role']}, Assigned by: {contributor.get('assigned_by', 'unknown')}"
            )

    else:
        print(f"Performing INCREMENTAL SYNC since {last_sync}")
        prs_to_process = get_merged_prs(since_date=last_sync)

    # Process PRs
    print(f"Processing {len(prs_to_process)} PRs...")
    # Sort PRs by merged_at ascending to maintain history order
    prs_to_process.sort(key=lambda x: x['merged_at'])

    for pr in prs_to_process:
        username = pr['username']
        merged_at = pr['merged_at']
        pr_url = pr['url']
        
        # 1. New Contributor Detection
        if username.lower() not in existing_usernames:
            print(f"New contributor detected: {username}")
            new_contributor = {
                "username": username, # Keep original casing for display
                "role": "Newbie Contributor",
                "team": "CE",
                "status": "active",
                "assigned_by": "GitMesh-Steward-bot",
                "assigned_at": merged_at,
                "last_activity": merged_at.split('T')[0],
                "notes": "Automatically onboarded after first merged PR."
            }
            contributors.append(new_contributor)
            existing_usernames.add(username.lower())
            
            update_user_history(username, "ONBOARDING", f"Achieved Newbie status via merged PR: {pr_url}")
            update_ledger("ONBOARDING", username, f"First merged PR: {pr_url}")
        
        # 2. Log PR to History
        update_user_history(username, "PR_MERGED", f"Merged PR #{pr['number']}: {pr['title']} ({pr['url']})")
        update_ledger("PR_MERGED", username, f"PR #{pr['number']}: {pr['title']}")

    # 3. Update Activity Status (for all contributors)
    print("\nUpdating activity status...")
    for entry in contributors:
        username = entry['username']
        last_act = get_last_activity_date(username)
        
        if last_act:
            old_activity = entry.get('last_activity')
            entry['last_activity'] = last_act
            
            if old_activity != last_act:
                update_user_history(username, "ACTIVITY_UPDATE", f"Last activity updated to {last_act}")
            
            # Inactivity Check (90 days)
            last_act_dt = datetime.strptime(last_act, "%Y-%m-%d")
            now_naive = datetime.now()
            diff = now_naive - last_act_dt
            
            if diff > timedelta(days=90):
                if entry.get('status') != "inactive":
                    entry['status'] = "inactive"
                    update_user_history(username, "STATUS_CHANGE", "Flagged as inactive due to 90 days of no activity.")
                    update_ledger("STATUS_CHANGE", username, "Marked as inactive (90+ days)")
            else:
                if entry.get('status') == "inactive":
                    entry['status'] = "active"
                    update_user_history(username, "STATUS_CHANGE", "Reactivated status due to new activity.")
                    update_ledger("STATUS_CHANGE", username, "Reactivated due to new activity")
    
    # 4. Process Role Change Requests from PR Body
    # Look for PRs merged since last sync that have special commands
    # This is a simplified implementation. Ideally we'd parse the PR body of the PRs we just processed.
    # But we already iterated them. Let's do it inside the loop or a separate pass?
    # Let's do a separate pass on the same list of PRs to keep logic clean.
    
    print("\nProcessing Governance Commands in PRs...")
    for pr in prs_to_process:
        # We need to fetch the full PR body to check for commands
        # The list endpoint might not have the full body if it's huge, but usually it does.
        # Let's assume we need to fetch it if we want to be sure, or just use what we have if available.
        # The 'get_merged_prs' function didn't return the body. Let's update it or fetch individually.
        # Fetching individually is safer but slower. Let's try to be efficient.
        # Actually, for role changes, we probably want to check *all* merged PRs in this batch.
        
        # Command format: /gov promote @username to Role Name
        # Command format: /gov demote @username to Role Name
        
        # We need to fetch the PR details to get the body
        try:
            pr_details_url = f"https://api.github.com/repos/{REPO}/pulls/{pr['number']}"
            pr_resp = requests.get(pr_details_url, headers=headers)
            if pr_resp.status_code == 200:
                pr_data = pr_resp.json()
                body = pr_data.get('body', '')
                
                if body and '/gov ' in body:
                    lines = body.split('\n')
                    for line in lines:
                        if line.strip().startswith('/gov '):
                            parts = line.strip().split()
                            # Expected: /gov promote @user to Role
                            if len(parts) >= 5 and (parts[1] == 'promote' or parts[1] == 'demote'):
                                action = parts[1]
                                target_user = parts[2].lstrip('@')
                                target_role = ' '.join(parts[4:])
                                
                                # Verify permissions? 
                                # The PR is merged, so a maintainer approved it. 
                                # We can assume if it's merged, it's approved.
                                
                                # Find the user in registry
                                target_entry = next((c for c in contributors if c['username'].lower() == target_user.lower()), None)
                                
                                if target_entry:
                                    old_role = target_entry['role']
                                    target_entry['role'] = target_role
                                    target_entry['assigned_at'] = get_now_ist_str()
                                    target_entry['assigned_by'] = f"PR #{pr['number']} (merged)"
                                    
                                    log_msg = f"Role changed from '{old_role}' to '{target_role}' via PR #{pr['number']}"
                                    update_user_history(target_user, "ROLE_CHANGE", log_msg)
                                    update_ledger("ROLE_CHANGE", target_user, log_msg)
                                    print(f"Processed governance command: {log_msg}")
                                else:
                                    print(f"Governance command failed: User {target_user} not found.")

        except Exception as e:
            print(f"Error processing PR #{pr['number']} for commands: {e}")

    # Update Metadata
    registry['metadata']['last_sync'] = get_now_ist_str()
    registry['metadata']['total_contributors'] = len(contributors)
    registry['metadata']['active_contributors'] = sum(1 for c in contributors if c.get('status') == 'active')

    # Save Registry
    with open(REGISTRY_PATH, 'w') as f:
        yaml.dump(registry, f, sort_keys=False, default_flow_style=False)
    
    print("\nGovernance sync completed successfully.")
    print(f"Total contributors: {len(contributors)}")
    print(f"Active contributors: {registry['metadata']['active_contributors']}")

if __name__ == "__main__":
    main()
