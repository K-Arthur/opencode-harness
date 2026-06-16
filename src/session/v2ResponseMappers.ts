import type {
  Session,
  Message,
  Part,
  SnapshotFileDiff,
} from "@opencode-ai/sdk/v2"

/**
 * v2→domain adapter/mapper.
 *
 * The v2 SDK client returns raw `Record<string, unknown>` from HTTP calls.
 * These mappers validate and cast to the typed v2 SDK domain types.
 */
export function mapV2Session(v2: Record<string, unknown>): Session {
  const summaryRaw = v2.summary as Record<string, unknown> | undefined
  return {
    id: v2.id as string,
    slug: v2.slug as string,
    projectID: v2.projectID as string,
    directory: v2.directory as string,
    parentID: v2.parentID as string | undefined,
    summary: summaryRaw
      ? {
          additions: summaryRaw.additions as number,
          deletions: summaryRaw.deletions as number,
          files: summaryRaw.files as number,
          diffs: summaryRaw.diffs
            ? (summaryRaw.diffs as Array<Record<string, unknown>>).map(mapV2SnapshotFileDiff)
            : undefined,
        }
      : undefined,
    share: v2.share ? { url: (v2.share as Record<string, unknown>).url as string } : undefined,
    title: v2.title as string,
    version: v2.version as string,
    time: {
      created: (v2.time as Record<string, unknown>).created as number,
      updated: (v2.time as Record<string, unknown>).updated as number,
      compacting: (v2.time as Record<string, unknown>).compacting as number | undefined,
    },
    revert: v2.revert
      ? {
          messageID: (v2.revert as Record<string, unknown>).messageID as string,
          partID: (v2.revert as Record<string, unknown>).partID as string | undefined,
          snapshot: (v2.revert as Record<string, unknown>).snapshot as string | undefined,
          diff: (v2.revert as Record<string, unknown>).diff as string | undefined,
        }
      : undefined,
  }
}

export function mapV2SessionArray(v2Array: Array<Record<string, unknown>>): Session[] {
  return v2Array.map(mapV2Session)
}

export function mapV2Message(v2: Record<string, unknown>): Message {
  return v2 as unknown as Message
}

export function mapV2Part(v2: Record<string, unknown>): Part {
  return v2 as unknown as Part
}

export function mapV2MessageWithParts(
  v2: Record<string, unknown>,
): { info: Message; parts: Part[] } {
  return {
    info: mapV2Message(v2.info as Record<string, unknown>),
    parts: (v2.parts as Array<Record<string, unknown>>).map(mapV2Part),
  }
}

export function mapV2MessageWithPartsArray(
  v2Array: Array<Record<string, unknown>>,
): Array<{ info: Message; parts: Part[] }> {
  return v2Array.map(mapV2MessageWithParts)
}

function mapV2SnapshotFileDiff(v2: Record<string, unknown>): SnapshotFileDiff {
  return {
    file: v2.file as string | undefined,
    patch: v2.patch as string | undefined,
    additions: v2.additions as number,
    deletions: v2.deletions as number,
    status: v2.status as "added" | "deleted" | "modified" | undefined,
  }
}

export function mapV2Agent(v2: Record<string, unknown>): { name: string; description?: string; mode: string; builtIn: boolean } {
  return {
    name: v2.name as string,
    description: v2.description as string | undefined,
    mode: v2.mode as string,
    builtIn: (v2.native as boolean) ?? false,
  }
}
