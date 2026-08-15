export const SEALED_DISABLED_FEATURES = [
  "shell_tool", "shell_snapshot", "apps", "browser_use", "browser_use_external", "browser_use_full_cdp_access",
  "in_app_browser", "computer_use", "image_generation", "view_image", "multi_agent", "multi_agent_v2", "plugins",
  "recommended_plugins", "skill_search", "workspace_dependencies", "hooks", "enable_mcp_apps",
  "network_proxy", "standalone_web_search", "unified_exec",
];

export function buildLaboratoryCodexCommand(experiment, observerWorkspace, instrumentWorkingDirectory, platform = process.platform, options = {}) {
  const labArgs = JSON.stringify(["run", "lab:mcp", "--", "--experiment", experiment.id, "--phase", options.phase ?? "blind"]);
  return {
    command: platform === "win32" ? "codex.exe" : "codex",
    args: ["--ask-for-approval", "never", "--sandbox", "read-only", ...SEALED_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
      "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--skip-git-repo-check",
      "--color", "never", "--cd", observerWorkspace,
      "--config", "mcp_servers.protouniverse-lab.command=\"npm.cmd\"",
      "--config", `mcp_servers.protouniverse-lab.args=${labArgs}`,
      "--config", `mcp_servers.protouniverse-lab.cwd=${JSON.stringify(instrumentWorkingDirectory)}`,
      ...(options.outputSchemaFile ? ["--output-schema", options.outputSchemaFile] : []),
      ...(options.lastMessageFile ? ["--output-last-message", options.lastMessageFile] : []), "-"],
  };
}
