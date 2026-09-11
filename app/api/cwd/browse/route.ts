import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { stat } from "fs/promises";
import {
  getBrowseStartDirectory,
  getParentDirectory,
  listDirectories,
  listWindowsDrives,
  partitionHiddenDirectories,
  parseShowHiddenParam,
  resolveDirectory,
  shouldShowWindowsDrivePicker,
} from "@/lib/directory-browser";

// GET /api/cwd/browse?path=... — lists readable subdirectories in the filesystem.
// `?hidden=1|true|yes` additionally returns dot-prefixed folders; without it
// they are left out of `directories` but reported as `hiddenCount`, so the
// caller can tell the user that more exists behind the toggle.
export async function GET(request: NextRequest) {
  try {
    const requested = request.nextUrl.searchParams.get("path")?.trim();
    const includeHidden = parseShowHiddenParam(request.nextUrl.searchParams.get("hidden"));
    if (shouldShowWindowsDrivePicker(requested)) {
      return NextResponse.json({ path: "", parentPath: null, drives: await listWindowsDrives(), directories: [], hiddenCount: 0 });
    }
    const candidate = getBrowseStartDirectory(requested);

    let resolved: string;
    try {
      resolved = await resolveDirectory(candidate);
    } catch {
      return NextResponse.json({ error: "Directory does not exist", code: "directory_not_found" }, { status: 404 });
    }


    const directoryStat = await stat(resolved);
    if (!directoryStat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory", code: "not_a_directory" }, { status: 400 });
    }

    const directories = await listDirectories(resolved);
    const listing = partitionHiddenDirectories(directories, includeHidden);

    return NextResponse.json({
      path: resolved,
      parentPath: getParentDirectory(resolved),
      directories: listing.directories,
      hiddenCount: listing.hiddenCount,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
