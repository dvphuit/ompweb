import { NextRequest, NextResponse } from "next/server";
import { accessDenied } from "@/lib/api-utils";
import { errorMessage } from "@/lib/errors";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { isAbsolutePath } from "@/lib/paths";
import { getGitFileDiff } from "@/lib/git-changes";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const filePath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
    if (!isAbsolutePath(cwd)) {
      return NextResponse.json({ error: "cwd must be an absolute path", code: "cwd_must_be_absolute" }, { status: 400 });
    }
    if (!isAbsolutePath(filePath)) {
      return NextResponse.json({ error: "path must be an absolute path", code: "path_must_be_absolute" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots) || !isFilePathAllowed(filePath, allowedRoots)) {
      return accessDenied();
    }
    if (!isExistingFilePathAllowed(cwd, allowedRoots) || !isExistingFilePathAllowed(filePath, allowedRoots)) {
      return accessDenied();
    }

    return NextResponse.json(await getGitFileDiff(cwd, filePath));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
