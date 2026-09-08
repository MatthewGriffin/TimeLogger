/** A Jira issue returned by the assigned-ticket search. */
export interface JiraIssueResult {
  key: string
  summary: string
  status: string | null
}
