/**
 * The rules for app version numbers, separate from check-version.mjs so that
 * they can be tested. A beta is MAJOR.MINOR.PATCH-beta.N, and sorts below the
 * full release of the same number.
 */
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

export const isValidVersion = (version) => VERSION.test(version);
export const isBetaVersion = (version) => VERSION.exec(version)?.[4] !== undefined;

export function compareVersions(a, b) {
  const parse = (version) => {
    const [, major, minor, patch, beta] = VERSION.exec(version);
    // With no beta number, this is the full release, which sorts after any beta.
    return [major, minor, patch, beta ?? Infinity].map(Number);
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Returns what is wrong with releasing `version` from `branch`, or null.
 * A beta comes from the beta branch and a full release from main.
 */
export function branchVersionProblem(version, branch) {
  if (branch === "beta" && !isBetaVersion(version)) {
    return `The beta branch needs a beta tag such as v0.8.0-beta.1, but this is v${version}.`;
  }
  if (branch === "main" && isBetaVersion(version)) {
    return `The main branch can't have a beta tag, but this is v${version}.`;
  }
  return null;
}
