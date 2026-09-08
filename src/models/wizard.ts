export interface SetupTestResult {
  success: boolean
  message: string
  user?: unknown
  models?: string[]
  warning?: boolean
  loginUrl?: string
  requiresUserAuth?: boolean
  redirectUri?: string
}
