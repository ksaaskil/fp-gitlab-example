import debug from "debug";
import { Gitlab } from "gitlab";
import {
  GitLabDiscussionTextPosition,
  GitLabInlineNote,
  GitLabMR,
  GitLabMRChange,
  GitLabMRChanges,
  GitLabMRCommit,
  GitLabNote,
  GitLabUserProfile,
  RepoMetaData,
} from "./GitLabDSL";

export type GitLabAPIToken = string;

export interface GitLabAPICredentials {
  host: string;
  token: GitLabAPIToken;
}

// K.S. Simplify with mock credentials instead of reading from env
export const getGitLabAPICredentials = (): GitLabAPICredentials => ({
  host: "https://gitlab.com",
  token: "SOMETHING_REALLY_SECRET",
});

/* export function getGitLabAPICredentialsFromEnv(env: Env): GitLabAPICredentials {
  let host = "https://gitlab.com"
  const envHost = env["DANGER_GITLAB_HOST"]
  if (envHost) {
    // We used to support DANGER_GITLAB_HOST being just the host e.g. "gitlab.com"
    // however it is possible to have a custom host without SSL, ensure we only add the protocol if one is not provided
    const protocolRegex = /^http(s)*?:\/\//i
    host = protocolRegex.test(envHost) ? envHost : `https://${envHost}`
  }

  return {
    host,
    token: env["DANGER_GITLAB_API_TOKEN"],
  }
} */

const debugLog = debug("GitLabAPI");

type Gitlab = InstanceType<typeof Gitlab>;

class GitLabAPI {
  private readonly api: Gitlab;
  private readonly hostURL: string;

  constructor(
    public readonly repoMetadata: RepoMetaData,
    public readonly repoCredentials: GitLabAPICredentials
  ) {
    this.api = new Gitlab(repoCredentials);
    this.hostURL = repoCredentials.host;
  }

  get projectURL(): string {
    return `${this.hostURL}/${this.repoMetadata.repoSlug}`;
  }

  get mergeRequestURL(): string {
    return `${this.projectURL}/merge_requests/${
      this.repoMetadata.pullRequestID
    }`;
  }

  getUser = async (): Promise<GitLabUserProfile> => {
    debugLog("getUser");
    const user: GitLabUserProfile = (await this.api.Users.current()) as GitLabUserProfile;
    debugLog("getUser", user);
    return user;
  };

  getMergeRequestInfo = async (): Promise<GitLabMR> => {
    debugLog(
      `getMergeRequestInfo for repo: ${this.repoMetadata.repoSlug} pr: ${
        this.repoMetadata.pullRequestID
      }`
    );
    const mr: GitLabMR = (await this.api.MergeRequests.show(
      this.repoMetadata.repoSlug,
      parseInt(this.repoMetadata.pullRequestID, 10)
    )) as GitLabMR;
    debugLog("getMergeRequestInfo", mr);
    return mr;
  };

  getMergeRequestChanges = async (): Promise<GitLabMRChange[]> => {
    debugLog(
      `getMergeRequestChanges for repo: ${this.repoMetadata.repoSlug} pr: ${
        this.repoMetadata.pullRequestID
      }`
    );
    const mr = (await this.api.MergeRequests.changes(
      this.repoMetadata.repoSlug,
      parseInt(this.repoMetadata.pullRequestID, 10)
    )) as GitLabMRChanges;

    debugLog("getMergeRequestChanges", mr.changes);
    return mr.changes;
  };

  getMergeRequestCommits = async (): Promise<GitLabMRCommit[]> => {
    debugLog(
      "getMergeRequestCommits",
      this.repoMetadata.repoSlug,
      this.repoMetadata.pullRequestID
    );
    const commits: GitLabMRCommit[] = (await this.api.MergeRequests.commits(
      this.repoMetadata.repoSlug,
      parseInt(this.repoMetadata.pullRequestID, 10)
    )) as GitLabMRCommit[];
    debugLog("getMergeRequestCommits", commits);
    return commits;
  };

  getMergeRequestNotes = async (): Promise<GitLabNote[]> => {
    debugLog(
      "getMergeRequestNotes",
      this.repoMetadata.repoSlug,
      this.repoMetadata.pullRequestID
    );
    const api = this.api.MergeRequestNotes;
    const notes: GitLabNote[] = (await api.all(
      this.repoMetadata.repoSlug,
      this.repoMetadata.pullRequestID
    )) as GitLabNote[];
    debugLog("getMergeRequestNotes", notes);
    return notes;
  };

  getMergeRequestInlineNotes = async (): Promise<GitLabInlineNote[]> => {
    debugLog("getMergeRequestInlineNotes");
    const notes: GitLabNote[] = await this.getMergeRequestNotes();
    const inlineNotes = notes.filter(
      (note: GitLabNote) => note.type == "DiffNote"
    ) as GitLabInlineNote[];
    debugLog("getMergeRequestInlineNotes", inlineNotes);
    return inlineNotes;
  };

  createMergeRequestDiscussion = async (
    content: string,
    position: GitLabDiscussionTextPosition
  ): Promise<string> => {
    debugLog(
      "createMergeRequestDiscussion",
      this.repoMetadata.repoSlug,
      this.repoMetadata.pullRequestID,
      content,
      position
    );
    const api = this.api.MergeRequestDiscussions;

    try {
      const result = await api.create(
        this.repoMetadata.repoSlug,
        this.repoMetadata.pullRequestID,
        content,
        {
          position: position,
        }
      );
      debugLog("createMergeRequestDiscussion", result);
      return result.toString();
    } catch (e) {
      debugLog("createMergeRequestDiscussion", e);
      throw e;
    }
  };

  createMergeRequestNote = async (body: string): Promise<GitLabNote> => {
    debugLog(
      "createMergeRequestNote",
      this.repoMetadata.repoSlug,
      this.repoMetadata.pullRequestID,
      body
    );
    const api = this.api.MergeRequestNotes;

    try {
      debugLog("createMergeRequestNote");
      const note: GitLabNote = (await api.create(
        this.repoMetadata.repoSlug,
        this.repoMetadata.pullRequestID,
        body
      )) as GitLabNote;
      debugLog("createMergeRequestNote", note);
      return note;
    } catch (e) {
      debugLog("createMergeRequestNote", e);
    }

    return Promise.reject();
  };

  updateMergeRequestNote = async (
    id: number,
    body: string
  ): Promise<GitLabNote> => {
    debugLog(
      "updateMergeRequestNote",
      this.repoMetadata.repoSlug,
      this.repoMetadata.pullRequestID,
      id,
      body
    );
    const api = this.api.MergeRequestNotes;
    try {
      const note: GitLabNote = (await api.edit(
        this.repoMetadata.repoSlug,
        this.repoMetadata.pullRequestID,
        id,
        body
      )) as GitLabNote;
      debugLog("updateMergeRequestNote", note);
      return note;
    } catch (e) {
      debugLog("updateMergeRequestNote", e);
    }

    return Promise.reject();
  };

  // note: deleting the _only_ note in a discussion also deletes the discussion \o/
  deleteMergeRequestNote = async (id: number): Promise<boolean> => {
    debugLog(
      "deleteMergeRequestNote",
      this.repoMetadata.repoSlug,
      this.repoMetadata.pullRequestID,
      id
    );
    const api = this.api.MergeRequestNotes;

    try {
      await api.remove(
        this.repoMetadata.repoSlug,
        this.repoMetadata.pullRequestID,
        id
      );
      debugLog("deleteMergeRequestNote", true);
      return true;
    } catch (e) {
      debugLog("deleteMergeRequestNote", e);
      return false;
    }
  };

  getFileContents = async (
    path: string,
    slug?: string,
    ref?: string
  ): Promise<string> => {
    debugLog(
      `getFileContents requested for path:${path}, slug:${slug}, ref:${ref}`
    );
    const api = this.api.RepositoryFiles;
    const projectId = slug || this.repoMetadata.repoSlug;
    // Use the current state of PR if no ref is passed
    if (!ref) {
      const mr: GitLabMR = await this.getMergeRequestInfo();
      ref = mr.diff_refs.head_sha;
    }

    try {
      debugLog("getFileContents", projectId, path, ref);
      const response = (await api.show(projectId, path, ref)) as {
        content: string;
      };
      const result: string = Buffer.from(response.content, "base64").toString();
      debugLog("getFileContents", result);
      return result;
    } catch (e) {
      debugLog("getFileContents", e);
      // GitHubAPI.fileContents returns "" when the file does not exist, keep it consistent across providers
      if (e.response.status === 404) {
        return "";
      }
      throw e;
    }
  };
}

export default GitLabAPI;
