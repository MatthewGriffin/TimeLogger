/**
 * Raised when Tempo could not be read to check for existing worklogs.
 *
 * Distinct from a submission failure: nothing was sent and nothing changed,
 * so the caller should keep the user's selection and invite a retry rather
 * than reporting a partial submission.
 */
export class TempoVerificationError extends Error {
  readonly date: string

  constructor(message: string, date: string) {
    super(message)
    this.name = 'TempoVerificationError'
    this.date = date
  }
}
