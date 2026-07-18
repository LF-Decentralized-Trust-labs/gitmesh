export function shouldLoadWorkspaceEnv(
  env: Record<string, string | undefined>,
): boolean {
  return env.GITMESH_DISABLE_WORKSPACE_ENV !== "true";
}