export function shouldLoadWorkspaceEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.GITMESH_DISABLE_WORKSPACE_ENV !== "true";
}