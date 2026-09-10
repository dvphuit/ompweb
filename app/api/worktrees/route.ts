import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { existsSync } from "fs";
import { accessDenied, apiErrorResponse } from "@/lib/api-utils";
import { join } from "path";
import { addWorktree, findCurrentWorktreePath, listWorktrees, removeWorktree, resolveProject } from "@/lib/worktree";
import { allowFileRoot, getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { projectIdentityKey } from "@/lib/paths";
import { invalidateSessionListCache } from "@/lib/session-reader";

const MAX_WORKTREE_REQUEST_BYTES = 16 * 1024;
async function checkCwdAllowed(cwd: string): Promise<NextResponse | null> {
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots) || !isExistingFilePathAllowed(cwd, allowedRoots)) {
    return accessDenied();
  }
  return null;
}

/** Map the known English messages thrown by lib/worktree.ts onto stable codes
 * so the client can localize them; unrecognized git errors stay code-less. */
function worktreeErrorCode(message: string): string | undefined {
  if (message.startsWith("Branch name is required")) return "branch_required";
  if (message.startsWith("Invalid branch name")) return "invalid_branch_name";
  if (message.startsWith("Directory already exists")) return "worktree_directory_exists";
  if (message.startsWith("Not a worktree of this repository")) return "not_a_worktree";
  if (message.startsWith("Cannot remove the main worktree")) return "cannot_remove_main_worktree";
  return undefined;
}

// GET /api/worktrees?cwd=  →  { projectRoot, isGit, isTopLevel, worktrees }
export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd");
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required", code: "cwd_required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(cwd);
    if (denied) return denied;

    const project = await resolveProject(cwd);
    let worktrees: Awaited<ReturnType<typeof listWorktrees>> = [];
    let currentWorktreePath: string | null = null;
    let isGit = true;
    try {
      // For a removed-worktree cwd (session of a deleted worktree), fall back
      // to the inferred project root so the switcher still shows the project.
      const hasGit = existsSync(join(cwd, ".git"));
      const queryRoot = hasGit ? cwd : project.projectRoot;
      worktrees = await listWorktrees(queryRoot);
      currentWorktreePath = findCurrentWorktreePath(worktrees, cwd);
    } catch {
      isGit = false;
    }
    // Every listed path is a git-verified worktree of this project; allow the
    // file explorer to browse them even before they have any session (the
    // in-memory allowlist from addWorktree does not survive server restarts).
    for (const w of worktrees) allowFileRoot(w.path);
    return NextResponse.json({
      projectRoot: project.projectRoot,
      projectKey: projectIdentityKey(project.projectRoot),
      isGit,
      isTopLevel: project.isTopLevel,
      currentWorktreePath,
      worktrees,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// POST /api/worktrees  body: { cwd, branch }  →  { path, branch }
export async function POST(req: Request) {
  try {
    const body = await parseJsonWithinLimit<{ cwd?: unknown; branch?: unknown }>(req, MAX_WORKTREE_REQUEST_BYTES);
    if (typeof body.cwd !== "string" || !body.cwd) return NextResponse.json({ error: "cwd is required", code: "cwd_required" }, { status: 400 });
    if (typeof body.branch !== "string" || !body.branch) return NextResponse.json({ error: "branch is required", code: "branch_required" }, { status: 400 });
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) return denied;
    if (!existsSync(body.cwd)) return NextResponse.json({ error: `Directory does not exist: ${body.cwd}`, code: "directory_not_found" }, { status: 400 });
    const result = await addWorktree(body.cwd, body.branch);
    invalidateSessionListCache();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Worktree request is too large", code: "request_too_large" }, { status: 413 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON request body", code: "invalid_json" }, { status: 400 });
    const message = errorMessage(error);
    return NextResponse.json({ error: message, code: worktreeErrorCode(message) }, { status: 400 });
  }
}

// DELETE /api/worktrees  body: { cwd, path, force? }
export async function DELETE(req: Request) {
  try {
    const body = await parseJsonWithinLimit<{ cwd?: unknown; path?: unknown; force?: unknown }>(req, MAX_WORKTREE_REQUEST_BYTES);
    if (typeof body.cwd !== "string" || !body.cwd) return NextResponse.json({ error: "cwd is required", code: "cwd_required" }, { status: 400 });
    if (typeof body.path !== "string" || !body.path) return NextResponse.json({ error: "path is required", code: "path_required" }, { status: 400 });
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) return denied;
    await removeWorktree(body.cwd, body.path, body.force === true);
    invalidateSessionListCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Worktree request is too large", code: "request_too_large" }, { status: 413 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON request body", code: "invalid_json" }, { status: 400 });
    const message = errorMessage(error);
    const dirty = /contains modified or untracked files|is dirty/i.test(message);
    const code = dirty ? "worktree_dirty" : worktreeErrorCode(message);
    return NextResponse.json({ error: message, code, dirty }, { status: dirty ? 409 : 400 });
  }
}
